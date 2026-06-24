import { streamMessage, completeJSON } from "./llm.mjs";
import { runVerus } from "./verus.mjs";
import {
  SPEC_SYSTEM,
  CODE_SYSTEM,
  repairSystem,
  repairUserMessage,
  AUDIT_SYSTEM,
  auditUserMessage,
  realignSystem,
  realignUserMessage,
} from "./prompts.mjs";

const MAX_REPAIRS = Number(process.env.MAX_REPAIRS || 4);

// JSON schema the spec-faithfulness auditor must return.
const AUDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    faithful: { type: "boolean" },
    summary: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            enum: [
              "weakened_postcondition",
              "extra_precondition",
              "missing_case",
              "signature_mismatch",
              "other",
            ],
          },
          detail: { type: "string" },
        },
        required: ["kind", "detail"],
      },
    },
  },
  required: ["faithful", "summary", "issues"],
};

// Extract the contents of the first fenced code block from a (possibly
// partial) markdown string. Used to stream "just the code" into the editor
// pane while the model is still talking around it.
export function extractCode(text) {
  const fenceStart = text.match(/```(?:rust|rs)?\s*\n/);
  if (!fenceStart) return null;
  const start = fenceStart.index + fenceStart[0].length;
  const rest = text.slice(start);
  const end = rest.indexOf("```");
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Stage 1 only: generate the formal specification, then stop. The spec is a
 * human approval gate — the caller reviews/edits it and then calls
 * buildFromSpec with the approved text. Verification only certifies that code
 * matches the spec, never that the spec matches intent, so a human signs off
 * on the spec before any code is generated.
 */
export async function generateSpec(prompt, emit, opts = {}) {
  const { model, effort } = opts;
  emit("phase", { phase: "spec", label: "Generating formal specification" });
  emit("activity", { kind: "info", text: "Translating the request into a formal specification…" });

  const spec = await streamMessage({
    system: SPEC_SYSTEM,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 6000,
    model,
    effort,
    onText: (delta) => emit("spec_delta", { text: delta }),
    onThinking: (delta) => emit("thinking", { stage: "spec", text: delta }),
  });

  emit("phase", { phase: "review", label: "Awaiting spec approval" });
  emit("activity", {
    kind: "success",
    text: "Specification ready — review and edit it, then approve to generate code.",
  });
  emit("spec_done", { spec });
  return spec;
}

/**
 * Stages 2-3: given an approved spec, generate code, verify it, audit that the
 * contract didn't drift, and repair/realign until it verifies-and-matches (or
 * the repair budget runs out). Emits events through `emit(event, data)`.
 */
export async function buildFromSpec(prompt, spec, emit, opts = {}) {
  const { model, effort } = opts;
  // ---- Stage 2: initial implementation -----------------------------------
  emit("phase", { phase: "code", label: "Generating Verus implementation" });
  emit("activity", { kind: "info", text: "Writing an annotated Verus implementation…" });

  let raw = "";
  let lastCode = "";
  const codeFrom = (text) => {
    const c = extractCode(text);
    if (c != null && c !== lastCode) {
      lastCode = c;
      emit("code", { code: c });
    }
  };

  raw = await streamMessage({
    system: CODE_SYSTEM,
    messages: [{ role: "user", content: `Formal specification:\n\n${spec}` }],
    maxTokens: 16000,
    model,
    effort,
    onText: (delta) => {
      raw += delta;
      codeFrom(raw);
    },
    onThinking: (delta) => emit("thinking", { stage: "code", text: delta }),
  });

  let code = extractCode(raw) ?? raw;
  emit("code", { code });
  emit("activity", { kind: "success", text: "Implementation generated." });

  // ---- Stage 3: verify, and repair the proof until it checks -------------
  emit("phase", { phase: "verify", label: "Verifying with Verus" });

  let attempt = 0;
  let verified = false;
  let faithful = null; // null = not yet checked, true/false = audit result
  let verusUnavailable = false;

  while (true) {
    attempt += 1;
    emit("activity", { kind: "verus", text: `Running Verus (attempt ${attempt})…` });

    const result = await runVerus(code);

    if (!result.available) {
      verusUnavailable = true;
      emit("verus", { status: "unavailable" });
      emit("activity", {
        kind: "error",
        text: "Verus binary not found — skipping verification. Set VERUS_BIN to enable it.",
      });
      break;
    }

    if (result.verified) {
      verified = true;
      emit("verus", {
        status: "verified",
        output: result.output,
        summary: result.summary,
      });
      emit("activity", {
        kind: "success",
        text: `Verus verified the proof${
          result.summary ? ` (${result.summary.verified} verified, ${result.summary.errors} errors)` : ""
        }.`,
      });

      // ---- Stage 3c: audit that the contract didn't drift from the spec ----
      // A passing proof is meaningless if the code quietly weakened the
      // postconditions or added preconditions that exclude the hard cases.
      emit("phase", { phase: "audit", label: "Checking spec faithfulness" });
      emit("activity", { kind: "info", text: "Auditing the contract against the specification…" });

      let audit;
      try {
        audit = await completeJSON({
          system: AUDIT_SYSTEM,
          messages: [{ role: "user", content: auditUserMessage(spec, code) }],
          schema: AUDIT_SCHEMA,
          model,
          effort,
          maxTokens: 3000,
        });
      } catch (e) {
        emit("activity", { kind: "info", text: "Spec-faithfulness check skipped (auditor error)." });
        faithful = null;
        break;
      }

      emit("drift", { faithful: audit.faithful, summary: audit.summary, issues: audit.issues || [] });

      if (audit.faithful) {
        faithful = true;
        emit("activity", {
          kind: "success",
          text: "Spec match confirmed — the contract faithfully captures the specification.",
        });
        break;
      }

      // Drift detected: the proof passes but the contract doesn't match the spec.
      faithful = false;
      emit("activity", { kind: "error", text: `Spec drift: ${audit.summary}` });

      if (attempt > MAX_REPAIRS) {
        emit("activity", {
          kind: "error",
          text: `Reached the limit (${MAX_REPAIRS}); spec drift remains — the proof verifies but does not match the spec.`,
        });
        break;
      }

      // ---- Realign the contract to the spec, then re-verify ---------------
      emit("phase", { phase: "repair", label: `Realigning contract to spec (attempt ${attempt})` });
      emit("activity", {
        kind: "info",
        text: "Rewriting the contract to match the spec, then re-verifying…",
      });

      let realignRaw = "";
      lastCode = "";
      realignRaw = await streamMessage({
        system: realignSystem(),
        messages: [{ role: "user", content: realignUserMessage(spec, code, audit.issues) }],
        maxTokens: 16000,
        model,
        effort,
        onText: (delta) => {
          realignRaw += delta;
          codeFrom(realignRaw);
        },
        onThinking: (delta) => emit("thinking", { stage: "realign", text: delta }),
      });

      code = extractCode(realignRaw) ?? realignRaw;
      emit("code", { code });
      // Re-verify the realigned (faithful) contract on the next loop turn.
      faithful = null;
      emit("phase", { phase: "verify", label: "Verifying with Verus" });
      continue;
    }

    // Failed verification.
    emit("verus", {
      status: "failed",
      output: result.output,
      summary: result.summary,
      timedOut: !!result.timedOut,
    });
    emit("activity", {
      kind: "error",
      text: result.timedOut
        ? "Verus timed out."
        : `Verification failed${result.summary ? ` (${result.summary.errors} errors)` : ""}.`,
    });

    if (attempt > MAX_REPAIRS) {
      emit("activity", {
        kind: "error",
        text: `Reached the repair limit (${MAX_REPAIRS}). Stopping.`,
      });
      break;
    }

    // ---- Stage 3b: ask the model to repair the proof ---------------------
    emit("phase", { phase: "repair", label: `Repairing proof (attempt ${attempt})` });
    emit("activity", { kind: "info", text: "Feeding diagnostics back to the model to repair the proof…" });

    let repairRaw = "";
    lastCode = "";
    repairRaw = await streamMessage({
      system: repairSystem(),
      messages: [{ role: "user", content: repairUserMessage(code, result.output || "") }],
      maxTokens: 16000,
      model,
      effort,
      onText: (delta) => {
        repairRaw += delta;
        codeFrom(repairRaw);
      },
      onThinking: (delta) => emit("thinking", { stage: "repair", text: delta }),
    });

    code = extractCode(repairRaw) ?? repairRaw;
    emit("code", { code });
    emit("phase", { phase: "verify", label: "Verifying with Verus" });
  }

  emit("phase", { phase: "done", label: "Done" });
  emit("done", { verified, faithful, verusUnavailable, attempts: attempt, code, spec });
}
