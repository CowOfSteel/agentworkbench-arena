import type { DecisionLens, Outcome, ReportCandidate, ReportMetric } from "./report";

export const notReported = "Not reported";

const metricLabels: Record<string, string> = {
  wall_clock_ms: "Candidate execution",
  attempt_execution_ms: "Attempt execution",
  retry_overhead_ms: "Retry overhead",
  validation_wall_clock_ms: "Independent validation",
  total_pipeline_ms: "Arena pipeline",
  input_tokens: "Input tokens",
  cached_input_tokens: "Cached input tokens",
  uncached_input_tokens: "Uncached input tokens",
  output_tokens: "Output tokens",
  provider_reported_cost: "Provider-reported cost",
  provider_reported_currency: "Reported currency",
  estimated_cost: "Estimated cost",
  estimated_cost_currency: "Estimated cost currency",
  subscription_consumption: "Subscription consumption",
  quota_percent_before: "Quota before",
  quota_percent_after: "Quota after",
  usage_source: "Usage source",
  turn_count: "Reported harness turns",
  tool_call_count: "Tool calls",
  command_count: "Commands",
  retry_count: "Candidate retries",
  approval_count: "Approvals",
  human_intervention_count: "Human interventions",
  error_count: "Errors",
  permission_requests: "Permission requests",
  permission_denials: "Permission denials",
  user_questions: "User questions",
  manual_prompt_corrections: "Manual prompt corrections",
  manual_file_edits: "Manual file edits",
  aborts: "Aborts",
  transport_retries: "Transport retries",
  files_changed: "Files changed",
  lines_added: "Lines added",
  lines_deleted: "Lines deleted",
  dependencies_added: "Dependencies added",
  dependencies_removed: "Dependencies removed",
  untracked_files: "Untracked files",
  validation_pass_count: "Validation passes",
  validation_fail_count: "Validation failures",
  hard_gate_status: "Hard-gate status"
};

const durationMetrics = new Set(["wall_clock_ms", "attempt_execution_ms", "retry_overhead_ms", "validation_wall_clock_ms", "total_pipeline_ms"]);
const compactMetrics = new Set(["input_tokens", "cached_input_tokens", "uncached_input_tokens", "output_tokens", "turn_count", "tool_call_count", "command_count", "retry_count", "approval_count", "human_intervention_count", "error_count", "permission_requests", "permission_denials", "user_questions", "manual_prompt_corrections", "manual_file_edits", "aborts", "transport_retries", "files_changed", "lines_added", "lines_deleted", "dependencies_added", "dependencies_removed", "validation_pass_count", "validation_fail_count"]);

export const metricLabel = (name: string): string => metricLabels[name] ?? name.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());

export function metricNumber(metric: ReportMetric | undefined): number | null {
  return metric?.availability === "available" && typeof metric.value === "number" && Number.isFinite(metric.value) ? metric.value : null;
}

const trimZeros = (value: string): string => value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;

export function formatDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return notReported;
  if (value < 1_000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${trimZeros((value / 1_000).toFixed(1))} s`;
  const seconds = Math.round(value / 1_000);
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(seconds / 3_600)}h ${String(Math.floor(seconds % 3_600 / 60)).padStart(2, "0")}m`;
}

export function formatCompactNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return notReported;
  const absolute = Math.abs(value);
  if (absolute < 1_000) return Number.isInteger(value) ? String(value) : trimZeros(value.toFixed(2));
  if (absolute < 1_000_000) return `${trimZeros((value / 1_000).toFixed(1))}k`;
  return `${trimZeros((value / 1_000_000).toFixed(2))}M`;
}

export function formatCurrency(value: number | null, currency: unknown): string {
  if (value === null || typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) return notReported;
  try {
    const digits = Math.abs(value) < .01 ? 4 : 2;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  } catch { return notReported; }
}

export function candidateDisplayName(candidate: ReportCandidate): string {
  const name = candidate.configuration.displayName?.trim(), variant = candidate.configuration.displayVariant?.trim();
  if (name) return variant && !name.toLocaleLowerCase("en-US").includes(variant.toLocaleLowerCase("en-US")) ? `${name} — ${variant}` : name;
  const model = candidate.configuration.model?.trim();
  const native = candidate.configuration.nativeReasoningEffort ?? candidate.configuration.nativeVariant;
  if (model && native) return `${model} — ${native}`;
  if (model && candidate.configuration.attention) return `${model} — ${candidate.configuration.attention}`;
  return model ?? candidate.id;
}

export function candidateResult(candidate: ReportCandidate, outcome: Outcome, recommended: string | null, tied: string[]): string {
  if (candidate.eligibility === "excluded") return "Excluded";
  if (outcome === "RECOMMENDATION" && candidate.id === recommended) return "Recommended";
  if (outcome === "TIE" && tied.includes(candidate.id)) return "Tied";
  if (outcome === "INCONCLUSIVE") return "Inconclusive";
  return "Eligible";
}

export function semanticQuality(candidate: ReportCandidate): string {
  if (candidate.eligibility === "excluded") return "Excluded";
  if (candidate.semanticRank === null || !candidate.semanticTier) return "Not adjudicated";
  return `Rank ${candidate.semanticRank} · ${candidate.semanticTier.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase())}`;
}

export function reportedTokens(candidate: ReportCandidate): number | null {
  const input = metricNumber(candidate.metrics.input_tokens), output = metricNumber(candidate.metrics.output_tokens);
  return input === null || output === null ? null : input + output;
}

export function formattedCost(candidate: ReportCandidate): string {
  const currency = candidate.metrics.provider_reported_currency;
  return formatCurrency(metricNumber(candidate.metrics.provider_reported_cost), currency?.availability === "available" ? currency.value : null);
}

export function formattedChange(candidate: ReportCandidate): string {
  const added = metricNumber(candidate.metrics.lines_added), deleted = metricNumber(candidate.metrics.lines_deleted);
  return added === null || deleted === null ? notReported : `+${formatCompactNumber(added)} / −${formatCompactNumber(deleted)}`;
}

export function formatRetryCount(metric: ReportMetric | undefined): string {
  const value = metricNumber(metric);
  if (value === null) return `Retries: ${notReported}`;
  return `${formatCompactNumber(value)} ${value === 1 ? "retry" : "retries"}`;
}

export function formatMetricValue(name: string, metric: ReportMetric | undefined, metrics: Record<string, ReportMetric>): string {
  if (!metric || metric.availability === "unavailable") return notReported;
  if (durationMetrics.has(name)) return formatDuration(metricNumber(metric));
  if (name === "provider_reported_cost") return formatCurrency(metricNumber(metric), metrics.provider_reported_currency?.value);
  if (name === "estimated_cost") return formatCurrency(metricNumber(metric), metrics.estimated_cost_currency?.value);
  if (name === "quota_percent_before" || name === "quota_percent_after") return typeof metric.value === "number" ? `${trimZeros(metric.value.toFixed(2))}%` : String(metric.value);
  if (compactMetrics.has(name) && typeof metric.value === "number") return formatCompactNumber(metric.value);
  if (Array.isArray(metric.value)) return metric.value.length ? metric.value.map(String).join(", ") : "0";
  return String(metric.value);
}

export function lensValue(lens: DecisionLens, candidate: ReportCandidate): string {
  const value = lens.values?.[candidate.id];
  if (lens.id === "controller_recommendation") return `Candidate execution: ${formatDuration(metricNumber(candidate.metrics.wall_clock_ms))}`;
  if (lens.id === "fastest_candidate_execution") return formatDuration(typeof value === "number" ? value : null);
  if (lens.id === "smallest_total_code_change") return typeof value === "number" ? `${formatCompactNumber(value)} ${value === 1 ? "line" : "lines"}` : notReported;
  if (lens.id === "lowest_provider_reported_cost") return formatCurrency(typeof value === "number" ? value : null, candidate.metrics.provider_reported_currency?.value);
  if (lens.id === "lowest_token_usage") return typeof value === "number" ? `${formatCompactNumber(value)} reported tokens` : notReported;
  if (lens.id === "telemetry_coverage") return `${candidate.coverage.available} available · ${candidate.coverage.unavailable} unavailable`;
  return typeof value === "number" ? formatCompactNumber(value) : value === undefined ? notReported : String(value);
}

export function lensReason(lens: DecisionLens): string {
  return lens.reason
    .replace(/wall_clock_ms/g, metricLabel("wall_clock_ms"))
    .replace(/lines_added \+ lines_deleted/g, "Lines added + lines deleted")
    .replace(/human_intervention_count/g, metricLabel("human_intervention_count"))
    .replace(/retry_count/g, metricLabel("retry_count"));
}

export function recommendedSpeedDifference(candidates: ReportCandidate[], recommended: string | null, lenses: DecisionLens[]): string | null {
  if (!recommended) return null;
  const candidate = candidates.find((item) => item.id === recommended), fastest = lenses.find((lens) => lens.id === "fastest_candidate_execution");
  const selected = candidate ? metricNumber(candidate.metrics.wall_clock_ms) : null;
  const fastestValue = fastest?.values ? Math.min(...Object.values(fastest.values).filter((value): value is number => typeof value === "number")) : null;
  return selected !== null && fastestValue !== null && Number.isFinite(fastestValue) && selected > fastestValue ? `${formatDuration(selected - fastestValue)} slower than the fastest eligible candidate.` : null;
}
