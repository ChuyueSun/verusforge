import "dotenv/config";
import express from "express";
import cors from "cors";
import { generateSpec, buildFromSpec } from "./pipeline.mjs";
import { verusVersion } from "./verus.mjs";
import { getClient, MODEL, MODELS, EFFORTS, pickModel, pickEffort } from "./llm.mjs";

const DEFAULT_EFFORT = EFFORTS.includes(process.env.ANTHROPIC_EFFORT)
  ? process.env.ANTHROPIC_EFFORT
  : "high";

// Never let a stray error in a streaming/poll callback take down the API
// (a crashed server kills every in-flight run's view). Log and keep serving.
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e?.stack || e));
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e?.stack || e));

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));

const PORT = Number(process.env.PORT || 8787);

// Health / capability probe the UI hits on load.
app.get("/api/status", async (_req, res) => {
  const verus = await verusVersion();
  res.json({
    models: MODELS,
    efforts: EFFORTS,
    defaultModel: MODEL,
    defaultEffort: DEFAULT_EFFORT,
    llmConfigured: !!getClient(),
    verus,
  });
});

// Open an SSE stream and run `fn(safeEmit)`. Shared by both pipeline phases.
// Listen for disconnect on the RESPONSE, not the request: for a buffered POST,
// req's "close" fires as soon as the body is read, which would suppress every
// event after the first.
async function runSSE(res, fn) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let closed = false;
  res.on("close", () => (closed = true));
  const safeEmit = (event, data) => {
    if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await fn(safeEmit);
  } catch (err) {
    console.error("[pipeline error]", err);
    safeEmit("error", { message: err?.message || String(err) });
  } finally {
    res.end();
  }
}

// Stage 1: generate the formal spec, then stop for human approval.
app.post("/api/spec", async (req, res) => {
  const prompt = (req.body?.prompt || "").toString().trim();
  const opts = { model: pickModel(req.body?.model), effort: pickEffort(req.body?.effort) };
  await runSSE(res, async (emit) => {
    if (!prompt) return emit("error", { message: "Empty prompt." });
    if (!getClient()) {
      return emit("error", {
        message: "ANTHROPIC_API_KEY is not set on the server. Add it to .env and restart.",
      });
    }
    await generateSpec(prompt, emit, opts);
  });
});

// Stage 2-3: build code from the APPROVED spec, verify, audit, repair.
app.post("/api/build", async (req, res) => {
  const prompt = (req.body?.prompt || "").toString().trim();
  const spec = (req.body?.spec || "").toString().trim();
  const opts = { model: pickModel(req.body?.model), effort: pickEffort(req.body?.effort) };
  await runSSE(res, async (emit) => {
    if (!spec) return emit("error", { message: "Missing approved spec." });
    if (!getClient()) {
      return emit("error", {
        message: "ANTHROPIC_API_KEY is not set on the server. Add it to .env and restart.",
      });
    }
    await buildFromSpec(prompt, spec, emit, opts);
  });
});

app.listen(PORT, () => {
  console.log(`\n  Verus Forge API on http://localhost:${PORT}`);
  console.log(`  model: ${MODEL}`);
  console.log(`  anthropic key: ${getClient() ? "configured" : "MISSING (set ANTHROPIC_API_KEY)"}`);
  verusVersion().then((v) =>
    console.log(`  verus: ${v.available ? v.version || "available" : "not found (set VERUS_BIN)"}\n`),
  );
});
