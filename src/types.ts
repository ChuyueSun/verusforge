export type Phase = "idle" | "spec" | "review" | "code" | "verify" | "repair" | "audit" | "done";

export type ActivityKind = "info" | "thinking" | "verus" | "success" | "error";

export interface ActivityEntry {
  id: number;
  kind: ActivityKind;
  text: string;
  at: number;
}

export type VerusStatus = "verified" | "failed" | "unavailable" | null;

export interface VerusResult {
  status: VerusStatus;
  output?: string;
  summary?: { verified: number; errors: number } | null;
  timedOut?: boolean;
}

export interface DriftIssue {
  kind: string;
  detail: string;
}

export interface DriftResult {
  faithful: boolean;
  summary: string;
  issues: DriftIssue[];
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface ServerStatus {
  models: ModelOption[];
  efforts: string[];
  defaultModel: string;
  defaultEffort: string;
  llmConfigured: boolean;
  verus: { available: boolean; version?: string };
}
