import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

// Selectable in the UI. Opus 4.6+ only (user preference) — no sub-4.6 or
// non-Opus models. All support the `effort` parameter.
export const MODELS = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
];
export const EFFORTS = ["low", "medium", "high"];

const DEFAULT_EFFORT = EFFORTS.includes(process.env.ANTHROPIC_EFFORT)
  ? process.env.ANTHROPIC_EFFORT
  : "high";

// Validate caller-supplied choices, falling back to defaults.
export function pickModel(m) {
  return MODELS.some((x) => x.id === m) ? m : MODEL;
}
export function pickEffort(e) {
  return EFFORTS.includes(e) ? e : DEFAULT_EFFORT;
}

let client = null;
export function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Stream a single Claude message.
 *
 * `system` is the system prompt; `messages` is [{ role, content }, ...].
 * Calls onText(delta) for each chunk of answer text and onThinking(delta) for
 * each chunk of summarized reasoning. Returns the full answer text.
 */
export async function streamMessage({ system, messages, onText, onThinking, maxTokens = 8000, model, effort }) {
  const anthropic = getClient();
  if (!anthropic) throw new Error("ANTHROPIC_API_KEY is not set on the server.");

  const stream = anthropic.messages.stream({
    model: model || MODEL,
    max_tokens: maxTokens,
    // Adaptive thinking lets the model decide how much to reason; the
    // summarized display gives us reasoning to surface in the activity feed.
    thinking: { type: "adaptive", display: "summarized" },
    // Effort is the main latency lever — lower = faster, less deliberation.
    output_config: { effort: effort || DEFAULT_EFFORT },
    system,
    messages,
  });

  let text = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        text += event.delta.text;
        onText?.(event.delta.text);
      } else if (event.delta.type === "thinking_delta") {
        onThinking?.(event.delta.thinking);
      }
    }
  }

  await stream.finalMessage();
  return text;
}

/**
 * Non-streaming completion constrained to a JSON schema. Returns the parsed
 * object. Used for the spec-faithfulness audit.
 */
export async function completeJSON({ system, messages, schema, model, effort, maxTokens = 3000 }) {
  const anthropic = getClient();
  if (!anthropic) throw new Error("ANTHROPIC_API_KEY is not set on the server.");

  const resp = await anthropic.messages.create({
    model: model || MODEL,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    output_config: {
      effort: effort || DEFAULT_EFFORT,
      format: { type: "json_schema", schema },
    },
    system,
    messages,
  });

  const text = resp.content.find((b) => b.type === "text")?.text ?? "";
  return JSON.parse(text);
}

export { MODEL };
