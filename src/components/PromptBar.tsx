import { useState } from "react";

const EXAMPLES: { label: string; text: string }[] = [
  { label: "Maximum of a non-empty i32 slice", text: "Find the maximum element in a non-empty array (slice) of i32." },
  { label: "Max of two i32", text: "A function that returns the maximum of two i32 values." },
  { label: "Integer square root", text: "Integer square root: largest r such that r*r <= n, for a u32 n." },
  { label: "Linear search", text: "Linear search returning the index of a value in a slice, or None." },
  { label: "Sum 1..n = n(n+1)/2", text: "Sum the first n natural numbers and prove it equals n*(n+1)/2." },
];

export function PromptBar({
  running,
  onGenerate,
  onCancel,
  disabled,
  disabledReason,
}: {
  running: boolean;
  onGenerate: (prompt: string) => void;
  onCancel: () => void;
  disabled: boolean;
  disabledReason?: string;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    const p = value.trim();
    if (p && !running && !disabled) onGenerate(p);
  };

  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-850/70 p-4 shadow-lg backdrop-blur">
      <div className="flex items-start gap-3">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          rows={2}
          placeholder="Describe a function in plain English…  (⌘/Ctrl + Enter to run)"
          className="min-h-[3rem] flex-1 resize-y rounded-xl border border-ink-700 bg-ink-900 px-4 py-3 text-[15px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
        />
        {running ? (
          <button
            onClick={onCancel}
            className="h-12 shrink-0 rounded-xl border border-ink-600 bg-ink-800 px-5 text-sm font-semibold text-slate-200 transition hover:bg-ink-700"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={disabled || !value.trim()}
            title={disabled ? disabledReason : undefined}
            className="h-12 shrink-0 rounded-xl bg-accent px-6 text-sm font-semibold text-ink-950 transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
          >
            Generate &amp; Verify
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            onClick={() => setValue(ex.text)}
            disabled={running}
            title={ex.text}
            className="rounded-full border border-ink-700 bg-ink-900/60 px-3 py-1 text-xs text-slate-400 transition hover:border-accent/40 hover:text-slate-200 disabled:opacity-40"
          >
            {ex.label}
          </button>
        ))}
      </div>
    </div>
  );
}
