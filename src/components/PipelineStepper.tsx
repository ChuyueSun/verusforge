import type { Phase } from "../types";

const STEPS: { key: Phase; label: string }[] = [
  { key: "spec", label: "Formal spec" },
  { key: "code", label: "Generate code" },
  { key: "verify", label: "Verify (Verus)" },
  { key: "done", label: "Verified" },
];

// "repair" maps onto the verify step visually.
const order: Record<Phase, number> = {
  idle: -1,
  spec: 0,
  review: 0.5, // spec done, awaiting human approval before code
  code: 1,
  verify: 2,
  repair: 2,
  audit: 2,
  done: 3,
};

export function PipelineStepper({ phase, verified }: { phase: Phase; verified: boolean | null }) {
  const active = order[phase];

  return (
    <div className="flex items-center gap-2">
      {STEPS.map((step, i) => {
        const stepIdx = order[step.key];
        const isDone = active > stepIdx || (phase === "done" && step.key === "done");
        const isActive = active === stepIdx && phase !== "done";
        const isFinal = step.key === "done";

        let dot = "bg-ink-600";
        if (isActive) dot = "bg-accent animate-pulseDot";
        else if (isDone) dot = isFinal && verified === false ? "bg-rose-500" : "bg-emerald-400";

        let labelColor = "text-slate-500";
        if (isActive) labelColor = "text-accent-soft";
        else if (isDone) labelColor = "text-slate-300";

        return (
          <div key={step.key} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
              <span className={`text-xs font-medium ${labelColor}`}>
                {isFinal && verified === false ? "Unverified" : step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span className={`h-px w-6 ${active > stepIdx ? "bg-emerald-400/40" : "bg-ink-700"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
