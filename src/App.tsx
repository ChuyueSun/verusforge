import { useEffect, useState, type ReactNode } from "react";
import { PromptBar } from "./components/PromptBar";
import { PipelineStepper } from "./components/PipelineStepper";
import { ActivityPanel } from "./components/ActivityPanel";
import { ArtifactPanel } from "./components/ArtifactPanel";
import { useThreads, emptyState, type Thread, type Usage } from "./lib/useThreads";
import type { ServerStatus } from "./types";

export default function App() {
  const {
    threads, activeId, active, setActiveId,
    startToy, approve, regenerate, setTab, setEditedSpec, cancel, closeThread,
  } = useThreads();
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");

  // Active thread's run state (or a blank state when nothing is selected).
  const st = active?.state ?? emptyState();

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((s: ServerStatus) => {
        setServer(s);
        setModel(s.defaultModel);
        setEffort(s.defaultEffort);
      })
      .catch(() => setServer(null));
  }, []);

  const apiMissing = server ? !server.llmConfigured : false;

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col gap-4 p-4 md:p-6">
      <Header server={server} model={model} verified={st.verified} faithful={st.faithful} phase={st.phase} usage={st.usage} />

      <PromptBar
        running={!!(active && active.state.running)}
        onGenerate={(p) => startToy(p, { model, effort })}
        onCancel={() => active && cancel(active.id)}
        disabled={apiMissing}
        disabledReason="Set ANTHROPIC_API_KEY on the server"
      />

      {server && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-slate-500">Model</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-slate-200 outline-none focus:border-accent/50"
            >
              {server.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-slate-500">Reasoning effort</span>
            <select
              value={effort}
              onChange={(e) => setEffort(e.target.value)}
              className="rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 capitalize text-slate-200 outline-none focus:border-accent/50"
            >
              {server.efforts.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <span className="text-xs text-slate-600">higher effort = stronger proofs, slower runs</span>
        </div>
      )}

      {apiMissing && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
          The server has no <code className="font-mono">ANTHROPIC_API_KEY</code>. Add it to{" "}
          <code className="font-mono">.env</code> and restart <code className="font-mono">npm run dev</code>.
        </div>
      )}

      {threads.length > 0 && (
        <ThreadBar
          threads={threads}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={closeThread}
          onStop={cancel}
        />
      )}

      <div className="flex items-center gap-3">
        <PipelineStepper phase={st.phase} verified={st.verified} />
        {st.attempts > 1 && (
          <span className="text-xs text-slate-500">· {st.attempts} verification attempts</span>
        )}
      </div>

      {st.awaitingApproval && active && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-2.5">
          <p className="text-sm text-accent-soft">
            <span className="font-semibold">Review the spec.</span> Verification proves code matches
            this spec — not that the spec matches your intent. Edit it in the Specification tab if
            needed, then approve.
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => regenerate(active.id)}
              className="rounded-lg border border-ink-600 bg-ink-800 px-3.5 py-1.5 text-sm font-medium text-slate-200 transition hover:bg-ink-700"
            >
              Regenerate
            </button>
            <button
              onClick={() => approve(active.id)}
              disabled={!st.editedSpec.trim()}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-ink-950 transition hover:bg-accent-soft disabled:opacity-40"
            >
              Approve &amp; generate code
            </button>
          </div>
        </div>
      )}

      {threads.length === 0 ? (
        <div className="grid min-h-[40vh] place-items-center rounded-2xl border border-dashed border-ink-700 bg-ink-850/40 p-8 text-center">
          <div>
            <p className="text-sm font-medium text-slate-300">No runs yet</p>
            <p className="mt-1 max-w-md text-xs text-slate-500">
              Describe a function above to generate a verified proof. Each run opens its own thread —
              you can launch several and switch between them here.
            </p>
          </div>
        </div>
      ) : (
        <main className="grid grid-cols-1 gap-4 lg:h-[72vh] lg:grid-cols-2">
          <ActivityPanel entries={st.activity} running={st.running} />
          <ArtifactPanel
            spec={st.spec}
            code={st.code}
            verus={st.verus}
            drift={st.drift}
            activeTab={st.tab}
            onTabChange={(t) => active && setTab(active.id, t)}
            specEditable={st.awaitingApproval}
            editedSpec={st.editedSpec}
            onSpecChange={(s) => active && setEditedSpec(active.id, s)}
          />
        </main>
      )}
    </div>
  );
}

// ── thread tab bar ───────────────────────────────────────────────────────────
function threadStatus(t: Thread): { dot: string; pulse: boolean; text: string; textColor: string } {
  const s = t.state;
  if (s.running) {
    if (s.awaitingApproval) return { dot: "bg-amber-400", pulse: true, text: "review", textColor: "text-amber-300" };
    return { dot: "bg-accent", pulse: true, text: s.phaseLabel || "running", textColor: "text-accent-soft" };
  }
  if (s.error) return { dot: "bg-rose-500", pulse: false, text: "error", textColor: "text-rose-300" };
  if (s.awaitingApproval) return { dot: "bg-amber-400", pulse: false, text: "awaiting approval", textColor: "text-amber-300" };
  if (s.verified === true) return { dot: "bg-emerald-400", pulse: false, text: "verified", textColor: "text-emerald-300" };
  if (s.verified === false && s.phase === "done") return { dot: "bg-rose-500", pulse: false, text: "unverified", textColor: "text-rose-300" };
  if (s.phase === "done") return { dot: "bg-slate-400", pulse: false, text: "done", textColor: "text-slate-400" };
  return { dot: "bg-slate-500", pulse: false, text: "idle", textColor: "text-slate-500" };
}

function ThreadBar({
  threads, activeId, onSelect, onClose, onStop,
}: {
  threads: Thread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onStop: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 text-xs font-medium uppercase tracking-wider text-slate-500">
        Threads ({threads.length}) — run several at once
      </span>
      <div className="flex flex-wrap gap-2">
        {threads.map((t) => {
          const s = threadStatus(t);
          const isActive = t.id === activeId;
          return (
            <div
              key={t.id}
              onClick={() => onSelect(t.id)}
              className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 transition ${
                isActive ? "border-accent/60 bg-accent/10" : "border-ink-700 bg-ink-850/60 hover:border-ink-600"
              }`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot} ${s.pulse ? "animate-pulse" : ""}`} />
              <div className="flex flex-col leading-tight">
                <span className={`text-xs font-semibold ${isActive ? "text-slate-100" : "text-slate-300"}`}>{t.label}</span>
                <span className={`text-[10.5px] ${s.textColor}`}>{s.text}</span>
              </div>
              {t.state.running ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onStop(t.id); }}
                  className="ml-1 rounded-md px-1 text-xs text-slate-500 hover:bg-ink-700 hover:text-rose-300"
                  title="Stop this run"
                >
                  ■
                </button>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
                  className="ml-1 rounded-md px-1 text-sm text-slate-500 hover:bg-ink-700 hover:text-slate-200"
                  title="Close thread"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Header({
  server,
  model,
  verified,
  faithful,
  phase,
  usage,
}: {
  server: ServerStatus | null;
  model: string;
  verified: boolean | null;
  faithful: boolean | null;
  phase: string;
  usage: Usage | null;
}) {
  const modelLabel = server?.models.find((m) => m.id === model)?.label ?? model;
  const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`);
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-50">
          Verus<span className="text-accent">Forge</span>
        </h1>
        <p className="text-sm text-slate-500">Plain English → formal spec → verified Verus code</p>
      </div>

      <div className="flex items-center gap-2">
        {phase === "done" && verified === true && (
          <Pill className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">✓ Verified</Pill>
        )}
        {phase === "done" && verified === false && (
          <Pill className="border-rose-500/40 bg-rose-500/10 text-rose-300">Unverified</Pill>
        )}
        {faithful === true && (
          <Pill className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
            ✓ Matches spec
          </Pill>
        )}
        {faithful === false && (
          <Pill className="border-amber-500/40 bg-amber-500/10 text-amber-300" title="Verus passed but the contract drifted from the spec">
            ⚠ Spec drift
          </Pill>
        )}
        {usage && (
          <Pill
            className="border-violet-500/30 bg-violet-500/10 text-violet-200/90"
            title={`tokens — output ${usage.outputTokens.toLocaleString()} · input ${usage.inputTokens.toLocaleString()} · cache read ${usage.cacheReadTokens.toLocaleString()} · cache write ${usage.cacheCreationTokens.toLocaleString()} · ${usage.rounds} round(s)`}
          >
            🪙 {fmtTok(usage.outputTokens)} out · ${usage.costUsd.toFixed(2)}
          </Pill>
        )}
        <Pill className="border-ink-700 bg-ink-850 text-slate-400">{modelLabel || "…"}</Pill>
        <Pill
          className={
            server?.verus.available
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300/90"
              : "border-ink-700 bg-ink-850 text-slate-500"
          }
          title={server?.verus.version}
        >
          Verus {server?.verus.available ? "ready" : "off"}
        </Pill>
      </div>
    </header>
  );
}

function Pill({
  children,
  className = "",
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`rounded-full border px-3 py-1 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}
