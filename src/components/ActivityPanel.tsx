import { useEffect, useRef } from "react";
import type { ActivityEntry, ActivityKind } from "../types";

const META: Record<ActivityKind, { dot: string; label: string; labelColor: string }> = {
  info: { dot: "bg-sky-400", label: "step", labelColor: "text-sky-300" },
  thinking: { dot: "bg-violet-400", label: "thinking", labelColor: "text-violet-300" },
  verus: { dot: "bg-amber-400", label: "verus", labelColor: "text-amber-300" },
  success: { dot: "bg-emerald-400", label: "ok", labelColor: "text-emerald-300" },
  error: { dot: "bg-rose-500", label: "error", labelColor: "text-rose-300" },
};

export function ActivityPanel({
  entries,
  running,
}: {
  entries: ActivityEntry[];
  running: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries]);

  return (
    <section className="flex min-h-[440px] flex-col rounded-2xl border border-ink-700 bg-ink-850/60 lg:min-h-0">
      <header className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-200">Activity</span>
          <span className="text-xs text-slate-500">what's going on</span>
        </div>
        {running && (
          <span className="flex items-center gap-1.5 text-xs text-accent-soft">
            <span className="h-2 w-2 animate-pulseDot rounded-full bg-accent" />
            working
          </span>
        )}
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {entries.length === 0 ? (
          <p className="mt-8 text-center text-sm text-slate-600">
            The pipeline log will stream here.
          </p>
        ) : (
          <ol className="space-y-3">
            {entries.map((e) => {
              const m = META[e.kind];
              return (
                <li key={e.id} className="animate-fadeIn">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${m.dot}`} />
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wider ${m.labelColor}`}
                    >
                      {m.label}
                    </span>
                    <span className="text-[10px] text-slate-600">
                      {new Date(e.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                  </div>
                  <p
                    className={`ml-4 mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed ${
                      e.kind === "thinking"
                        ? "italic text-slate-400"
                        : e.kind === "error"
                          ? "text-rose-200"
                          : "text-slate-200"
                    }`}
                  >
                    {e.text}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
        <div ref={endRef} />
      </div>
    </section>
  );
}
