# VerusForge

A web app that turns a plain-English description into **machine-checked verified code**:

1. **Formal spec** — an LLM translates your request into a precise specification (signature, `requires`, `ensures`, invariants).
2. **Approve / edit (human gate)** — the run pauses on the spec. Verification only proves *code matches spec*, never that *spec matches intent*, so you review and edit the spec before any code is generated.
3. **Code** — an LLM writes an annotated [Verus](https://github.com/verus-lang/verus) (Rust) implementation targeting the approved spec.
4. **Proof** — the backend runs Verus. If verification fails, the diagnostics are fed back to the model, which repairs the proof. This loops until it verifies (or hits the attempt limit).
5. **Spec-faithfulness audit** — once it verifies, an auditor checks the code's contract didn't drift from the spec (weakened postconditions, trivializing preconditions). On drift it realigns the contract and re-verifies. A final "verified" means *verified **and** faithful*.

The UI has two live windows:

- **Activity** — a streaming log of what's happening, including the model's summarized reasoning.
- **Specification / Code** — the spec, and the code as it continuously evolves through each generation and repair pass. A footer shows the Verus verdict and raw output.

## Stack

- **Frontend:** React + Vite + Tailwind (`src/`)
- **Backend:** Express, streaming Server-Sent Events (`server/`)
- **LLM:** Anthropic Claude (`claude-opus-4-8`) via the official SDK, with adaptive thinking + streaming
- **Verifier:** the local Verus binary, invoked on a temp file per attempt

## Prerequisites

- **Node.js 18+** and npm
- An **Anthropic API key** ([console.anthropic.com](https://console.anthropic.com))
- *(Optional, for the proof step)* A built **Verus** binary and `rustup` on PATH. Without these the demo still runs spec + code generation and just skips verification — see the note at the end.

## Run the demo

**1. Install dependencies**

```bash
npm install
```

**2. Create your `.env`**

```bash
cp .env.example .env
```

Open `.env` and set your key (this is the only required value):

```
ANTHROPIC_API_KEY=sk-ant-...
```

If you have Verus and want the proof step, also point `VERUS_BIN` at your binary
(e.g. `~/verus/source/target-verus/release/verus`). Leave it as-is to skip verification.

**3. Start both servers**

```bash
npm run dev
```

This launches the frontend and backend together (via `concurrently`):

- **Frontend:** http://localhost:5173 ← open this
- **Backend:** http://localhost:8787 (Vite proxies `/api` to it)

**4. Use it**

Open http://localhost:5173, type a request (or pick an example), and hit
**Generate & Verify**. Watch the spec stream in, approve or edit it at the human
gate, then watch the code generate, verify, and self-repair live.

> **Running without an API key or Verus:** the app still starts and tells you
> what's missing. Without Verus it does spec + code generation and skips the
> proof step; without an API key it reports the key is unset.

Run the frontend or backend alone with `npm run web` / `npm run api`.

## How it fits together

```
POST /api/spec   (SSE stream)
  spec   ──▶ streamMessage(SPEC_SYSTEM)        → spec_delta, then spec_done
                                                 (pauses for human approval)

POST /api/build  (SSE stream, with the approved spec)
  code   ──▶ streamMessage(CODE_SYSTEM)        → code events (live fenced-block extraction)
  verify ──▶ runVerus(code)                    → verus event
   ├─ proof fails ─▶ streamMessage(repairSystem) ──┐  → repair, new code
   └─ verifies ───▶ completeJSON(AUDIT_SYSTEM)     │  → drift event
        └─ drift ─▶ streamMessage(realignSystem) ──┤  → realigned code
              ▲──────────────────────────────────┘  (loops up to MAX_REPAIRS)
  done   ──▶ { verified, faithful }
```

## Configuration (`.env`)

| Var | Purpose | Default |
|-----|---------|---------|
| `ANTHROPIC_API_KEY` | **Required.** Your API key | — |
| `ANTHROPIC_MODEL` | Model id | `claude-opus-4-8` |
| `VERUS_BIN` | Path to the Verus binary | `verus` (on PATH) |
| `RUST_BIN_PATH` | Dir containing `rustup` | `~/.cargo/bin` |
| `MAX_REPAIRS` | Max proof-repair iterations | `4` |
| `VERUS_TIMEOUT_MS` | Per-verification timeout | `60000` |
| `PORT` | Backend port | `8787` |

## Project layout

```
server/
  index.mjs      Express app + SSE endpoint
  pipeline.mjs   spec → code → verify → repair orchestration
  llm.mjs        streaming Claude helper
  verus.mjs      runs the Verus binary, parses results
  prompts.mjs    system prompts for each stage
src/
  App.tsx              layout, header, status
  lib/useThreads.ts    SSE client + per-thread run state
  lib/highlight.ts     Rust syntax highlighting
  components/          PromptBar, PipelineStepper, ActivityPanel, ArtifactPanel
```
