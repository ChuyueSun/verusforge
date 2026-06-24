import { useRef, useState } from "react";
import type { ActivityKind, DriftResult, Phase, VerusResult } from "../types";

let uid = 0;
let threadSeq = 0;
const nextThreadId = () => `t${++threadSeq}`;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  rounds: number;
}

export type ThreadKind = "toy";
export type ArtifactTab = "spec" | "code";

// Per-thread run state. (Formerly the single GenerationState — now one per
// concurrent run.) `tab`/`editedSpec` live here so each thread remembers its
// own artifact view and edited spec; `thinkingId/Stage` group streamed
// reasoning into one growing block per stage.
export interface ThreadState {
  running: boolean;
  phase: Phase;
  phaseLabel: string;
  spec: string;
  code: string;
  activity: { id: number; kind: ActivityKind; text: string; at: number }[];
  verus: VerusResult;
  drift: DriftResult | null;
  error: string | null;
  attempts: number;
  verified: boolean | null;
  faithful: boolean | null;
  awaitingApproval: boolean;
  usage: Usage | null;
  tab: ArtifactTab;
  editedSpec: string;
  thinkingId: number | null;
  thinkingStage: string | null;
}

export interface Thread {
  id: string;
  label: string;        // short label shown in the thread tab bar
  kind: ThreadKind;
  prompt: string;       // for regenerate
  model: string;
  effort: string;
  state: ThreadState;
}

export function emptyState(): ThreadState {
  return {
    running: false,
    phase: "idle",
    phaseLabel: "",
    spec: "",
    code: "",
    activity: [],
    verus: { status: null },
    drift: null,
    error: null,
    attempts: 0,
    verified: null,
    faithful: null,
    awaitingApproval: false,
    usage: null,
    tab: "spec",
    editedSpec: "",
    thinkingId: null,
    thinkingStage: null,
  };
}

const phaseToTab = (phase: Phase): ArtifactTab =>
  phase === "spec" || phase === "review" ? "spec" : "code";

// Pure reducer: apply one SSE event to a thread's state. Auto-tab switching and
// approval-spec seeding (previously App effects) live here so they apply
// per-thread for free.
function reduce(s: ThreadState, event: string, data: any): ThreadState {
  switch (event) {
    case "phase":
      // Switch the artifact tab to match the new phase, but only on a real
      // phase change (the server only emits `phase` when it changes) so we
      // don't fight a manual tab switch mid-phase.
      return { ...s, phase: data.phase, phaseLabel: data.label, tab: phaseToTab(data.phase), thinkingId: null, thinkingStage: null };

    case "spec_delta":
      return { ...s, spec: s.spec + data.text };

    case "spec_done":
      // Spec finished streaming — pause for review and seed the editable copy.
      return { ...s, spec: data.spec, awaitingApproval: true, tab: "spec", editedSpec: data.spec };

    case "code":
      return { ...s, code: data.code };

    case "usage":
      return { ...s, usage: data as Usage };

    case "activity":
      return {
        ...s,
        thinkingId: null,
        thinkingStage: null,
        activity: [...s.activity, { id: ++uid, kind: data.kind, text: data.text, at: Date.now() }],
      };

    case "thinking": {
      if (s.thinkingId != null && s.thinkingStage === data.stage) {
        const id = s.thinkingId;
        return {
          ...s,
          activity: s.activity.map((a) => (a.id === id ? { ...a, text: a.text + data.text } : a)),
        };
      }
      const id = ++uid;
      return {
        ...s,
        thinkingId: id,
        thinkingStage: data.stage,
        activity: [...s.activity, { id, kind: "thinking", text: data.text, at: Date.now() }],
      };
    }

    case "verus":
      return {
        ...s,
        verus: { status: data.status, output: data.output, summary: data.summary, timedOut: data.timedOut },
      };

    case "drift":
      return {
        ...s,
        drift: { faithful: data.faithful, summary: data.summary, issues: data.issues || [] },
        faithful: data.faithful,
      };

    case "done":
      return {
        ...s,
        verified: data.verusUnavailable ? null : data.verified,
        faithful: data.faithful ?? s.faithful,
        attempts: data.attempts,
      };

    case "error":
      return {
        ...s,
        error: data.message,
        thinkingId: null,
        thinkingStage: null,
        activity: [...s.activity, { id: ++uid, kind: "error", text: data.message, at: Date.now() }],
      };

    default:
      return s;
  }
}

export function useThreads() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const abortMap = useRef<Map<string, AbortController>>(new Map());

  const patch = (id: string, fn: (s: ThreadState) => ThreadState) =>
    setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, state: fn(t.state) } : t)));
  const apply = (id: string, event: string, data: any) => patch(id, (s) => reduce(s, event, data));

  // Open a fresh thread, make it active, and return its id.
  function openThread(t: Omit<Thread, "state">): string {
    setThreads((ts) => [...ts, { ...t, state: emptyState() }]);
    setActiveId(t.id);
    return t.id;
  }

  // Stream an SSE endpoint into a specific thread. Each thread has its OWN
  // AbortController, so launching/stopping one run never touches another.
  async function stream(id: string, url: string, body: unknown) {
    abortMap.current.get(id)?.abort();
    const controller = new AbortController();
    abortMap.current.set(id, controller);
    patch(id, (s) => ({ ...s, running: true, thinkingId: null, thinkingStage: null }));

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Server returned ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          let event = "message";
          let dataStr = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;
          try {
            apply(id, event, JSON.parse(dataStr));
          } catch {
            /* ignore malformed chunk */
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") apply(id, "error", { message: err?.message || String(err) });
    } finally {
      patch(id, (s) => ({ ...s, running: false }));
    }
  }

  // ── launch actions (each opens a new thread) ──────────────────────────────

  // Toy pipeline: NL → spec (then pause for approval).
  function startToy(prompt: string, llm: { model: string; effort: string }) {
    const id = openThread({ id: nextThreadId(), label: "toy", kind: "toy", prompt, ...llm });
    patch(id, (s) => ({ ...s, running: true, phase: "spec", phaseLabel: "Starting…" }));
    void stream(id, "/api/spec", { prompt, ...llm });
    return id;
  }

  // ── per-thread controls ───────────────────────────────────────────────────

  function approve(id: string) {
    const t = threads.find((x) => x.id === id);
    if (!t) return;
    const spec = t.state.editedSpec;
    patch(id, (s) => ({
      ...s,
      running: true,
      awaitingApproval: false,
      spec,
      code: "",
      verus: { status: null },
      drift: null,
      verified: null,
      faithful: null,
      phase: "code",
      phaseLabel: "Generating Verus implementation",
    }));
    const llm = { model: t.model, effort: t.effort };
    void stream(id, "/api/build", { prompt: t.prompt, spec, ...llm });
  }

  function regenerate(id: string) {
    const t = threads.find((x) => x.id === id);
    if (!t) return;
    const llm = { model: t.model, effort: t.effort };
    patch(id, () => ({ ...emptyState(), running: true, phase: "spec", phaseLabel: "Starting…" }));
    void stream(id, "/api/spec", { prompt: t.prompt, ...llm });
  }

  const setTab = (id: string, tab: ArtifactTab) => patch(id, (s) => ({ ...s, tab }));
  const setEditedSpec = (id: string, editedSpec: string) => patch(id, (s) => ({ ...s, editedSpec }));

  function cancel(id: string) {
    abortMap.current.get(id)?.abort();
    patch(id, (s) => ({ ...s, running: false, awaitingApproval: false }));
  }

  function closeThread(id: string) {
    abortMap.current.get(id)?.abort();
    abortMap.current.delete(id);
    setThreads((ts) => {
      const rest = ts.filter((t) => t.id !== id);
      setActiveId((cur) => (cur === id ? rest[rest.length - 1]?.id ?? null : cur));
      return rest;
    });
  }

  const active = threads.find((t) => t.id === activeId) ?? null;

  return {
    threads,
    activeId,
    active,
    setActiveId,
    startToy,
    approve,
    regenerate,
    setTab,
    setEditedSpec,
    cancel,
    closeThread,
  };
}
