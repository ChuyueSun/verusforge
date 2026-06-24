import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { highlightRust } from "../lib/highlight";
import type { DriftResult, VerusResult } from "../types";

type Tab = "spec" | "code";

export function ArtifactPanel({
  spec,
  code,
  verus,
  drift,
  activeTab,
  onTabChange,
  specEditable = false,
  editedSpec = "",
  onSpecChange,
}: {
  spec: string;
  code: string;
  verus: VerusResult;
  drift: DriftResult | null;
  activeTab: Tab;
  onTabChange: (t: Tab) => void;
  specEditable?: boolean;
  editedSpec?: string;
  onSpecChange?: (s: string) => void;
}) {
  const [showOutput, setShowOutput] = useState(false);
  const [copied, setCopied] = useState(false);

  const highlighted = useMemo(() => highlightRust(code), [code]);
  const lineCount = useMemo(() => code.split("\n").length, [code]);

  const codeScrollRef = useRef<HTMLDivElement>(null);
  // Keep the latest code in view while it streams in.
  useEffect(() => {
    if (activeTab === "code") {
      const el = codeScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [code, activeTab]);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section className="flex min-h-[440px] flex-col rounded-2xl border border-ink-700 bg-ink-850/60 lg:min-h-0">
      <header className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
        <div className="flex gap-1">
          <TabButton active={activeTab === "spec"} onClick={() => onTabChange("spec")}>
            Specification
          </TabButton>
          <TabButton active={activeTab === "code"} onClick={() => onTabChange("code")}>
            Code
            <span className="ml-1.5 text-[10px] text-slate-500">evolving</span>
          </TabButton>
        </div>
        {activeTab === "code" && code && (
          <button
            onClick={copy}
            className="rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-slate-400 transition hover:text-slate-200"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        {activeTab === "spec" ? (
          specEditable ? (
            <div className="flex h-full flex-col px-3 py-3">
              <span className="px-1 pb-1.5 text-[11px] text-slate-500">
                Editable — adjust the spec, then approve above.
              </span>
              <textarea
                value={editedSpec}
                onChange={(e) => onSpecChange?.(e.target.value)}
                spellCheck={false}
                className="scroll-thin h-full w-full flex-1 resize-none rounded-lg border border-accent/30 bg-ink-900 px-4 py-3 font-mono text-[13px] leading-[1.55] text-slate-100 outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
              />
            </div>
          ) : (
            <div className="scroll-thin h-full overflow-y-auto px-5 py-4">
              {spec ? (
                <div className="spec-prose text-sm" dangerouslySetInnerHTML={{ __html: renderSpec(spec) }} />
              ) : (
                <Placeholder>The formal specification will appear here.</Placeholder>
              )}
            </div>
          )
        ) : (
          <div ref={codeScrollRef} className="scroll-thin h-full overflow-auto">
            {code ? (
              <div className="flex min-h-full font-mono text-[13px] leading-[1.55]">
                <pre
                  aria-hidden
                  className="select-none border-r border-ink-700 bg-ink-900/40 px-3 py-4 text-right text-slate-600"
                >
                  {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
                </pre>
                <pre className="flex-1 overflow-x-auto px-4 py-4">
                  <code dangerouslySetInnerHTML={{ __html: highlighted }} />
                </pre>
              </div>
            ) : (
              <Placeholder>The Verus implementation will stream here.</Placeholder>
            )}
          </div>
        )}
      </div>

      {verus.status && verus.status !== "unavailable" && (
        <footer className="border-t border-ink-700">
          <button
            onClick={() => setShowOutput((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2 text-left"
          >
            <span
              className={`flex items-center gap-2 text-xs font-semibold ${
                verus.status === "verified" ? "text-emerald-300" : "text-rose-300"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  verus.status === "verified" ? "bg-emerald-400" : "bg-rose-500"
                }`}
              />
              {verus.status === "verified"
                ? `Verus: verified${verus.summary ? ` (${verus.summary.verified} ok, ${verus.summary.errors} errors)` : ""}`
                : verus.timedOut
                  ? "Verus: timed out"
                  : `Verus: failed${verus.summary ? ` (${verus.summary.errors} errors)` : ""}`}
            </span>
            <span className="text-[11px] text-slate-500">{showOutput ? "hide output" : "show output"}</span>
          </button>
          {showOutput && verus.output && (
            <pre className="scroll-thin max-h-44 overflow-auto border-t border-ink-700 bg-ink-900/60 px-4 py-3 font-mono text-[11.5px] leading-relaxed text-slate-400">
              {verus.output}
            </pre>
          )}
        </footer>
      )}

      {drift && (
        <footer className="border-t border-ink-700 px-4 py-2.5">
          <div
            className={`flex items-center gap-2 text-xs font-semibold ${
              drift.faithful ? "text-emerald-300" : "text-amber-300"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${drift.faithful ? "bg-emerald-400" : "bg-amber-400"}`}
            />
            {drift.faithful ? "Contract matches the spec" : "Spec drift detected"}
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-slate-300">{drift.summary}</p>
          {!drift.faithful && drift.issues.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {drift.issues.map((issue, i) => (
                <li key={i} className="text-[12px] leading-relaxed text-amber-200/90">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-amber-400/70">
                    {issue.kind.replace(/_/g, " ")}
                  </span>{" "}
                  — {issue.detail}
                </li>
              ))}
            </ul>
          )}
        </footer>
      )}
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        active ? "bg-ink-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
      }`}
    >
      {children}
    </button>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return <p className="mt-10 text-center text-sm text-slate-600">{children}</p>;
}

// Minimal, safe renderer for the spec markdown the model emits (## headings,
// `inline code`, and dash bullet lists). Escapes everything first.
function renderSpec(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (h2) {
      closeList();
      out.push(`<h2>${inline(h2[1])}</h2>`);
    } else if (bullet) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join("");
}
