import { ComparisonTopology, topologyFromTrial } from "./topology";
import { Trial } from "./trial";

export interface TrialPreview {
  trial_id: string; candidate_count: number; adapter_count: number; execution_order: string[]; candidate_timeout_ms: number; transport_retry_allowance: number; maximum_candidate_attempts: number;
  maximum_total_candidate_attempts: number;
  candidate_process_upper_bound_ms: number; independent_validation_upper_bound_ms: number; dependency_policy: Trial["dependencyPolicy"]; intervention_policy: Trial["manualIntervention"];
  allowed_path_count: number; forbidden_path_count: number; validation_commands: string[][]; topology: ComparisonTopology; placeholder_warnings: string[]; noncausal_boundary: string;
  candidate_configurations: Array<{ id: string; display_name: string | null; display_variant: string | null; native_reasoning_effort: string | null; provider_route: string | null; native_variant: string | null; }>;
}

const unresolved = /(?:REPLACE_[A-Z0-9_]+|YOUR_[A-Z0-9_]+|<[^>]+>|\bTODO\b)/g;
export const unresolvedPlaceholders = (value: unknown): string[] => typeof value === "string" ? [...value.matchAll(unresolved)].map((match) => match[0]) : Array.isArray(value) ? value.flatMap(unresolvedPlaceholders) : value && typeof value === "object" ? Object.values(value).flatMap(unresolvedPlaceholders) : [];

export function previewTrial(trial: Trial): TrialPreview {
  const maximum_candidate_attempts = 1 + trial.maxLaunchTransportRetries;
  return {
    trial_id: trial.id, candidate_count: trial.candidates.length, adapter_count: new Set(trial.candidates.map((candidate) => candidate.adapter)).size, execution_order: trial.candidates.map((candidate) => candidate.id), candidate_timeout_ms: trial.timeoutMs,
    transport_retry_allowance: trial.maxLaunchTransportRetries, maximum_candidate_attempts, maximum_total_candidate_attempts: trial.candidates.length * maximum_candidate_attempts, candidate_process_upper_bound_ms: trial.candidates.length * maximum_candidate_attempts * trial.timeoutMs,
    independent_validation_upper_bound_ms: trial.candidates.length * trial.validationCommands.length * trial.validationTimeoutMs, dependency_policy: trial.dependencyPolicy, intervention_policy: trial.manualIntervention,
    allowed_path_count: trial.allowedPaths.length, forbidden_path_count: trial.forbiddenPaths.length, validation_commands: trial.validationCommands, topology: topologyFromTrial(trial), placeholder_warnings: [...new Set(unresolvedPlaceholders(trial))].sort(),
    candidate_configurations: trial.candidates.map((candidate) => ({ id: candidate.id, display_name: candidate.displayName ?? null, display_variant: candidate.displayVariant ?? null, native_reasoning_effort: candidate.nativeReasoningEffort ?? null, provider_route: candidate.providerRoute ?? null, native_variant: typeof candidate.adapterOptions?.native_variant === "string" ? candidate.adapterOptions.native_variant : null })),
    noncausal_boundary: "Arena compares complete configurations. Topology is structural analysis only and does not establish causal effects."
  };
}

export function renderTrialPreview(preview: TrialPreview): string {
  const sweeps = preview.topology.controlled_sweeps.length ? preview.topology.controlled_sweeps.map((group) => `${group.dimension}: ${group.candidates.join(", ")}`).join("; ") : "none";
  const varied = preview.topology.varied_dimensions.length ? preview.topology.varied_dimensions.map((item) => item.dimension).join(", ") : "none";
  const duplicates = preview.topology.duplicate_configuration_groups.length ? preview.topology.duplicate_configuration_groups.map((group) => group.join(", ")).join("; ") : "none";
  const examples = preview.topology.multi_variable_pairs.length ? preview.topology.multi_variable_pairs.map((pair) => `${pair.candidates.join(" vs ")} [${pair.differing_dimensions.join(", ")}]`).join("; ") : "none";
  const truncation = preview.topology.multi_variable_pairs_truncated ? ` (examples truncated after ${preview.topology.multi_variable_pairs.length})` : "";
  const claims = preview.topology.supported_structural_claims.join("; ") || "none";
  const limits = preview.topology.unsupported_causal_claims.join("; ") || "none";
  const warnings = preview.placeholder_warnings.length ? `\nWarnings: unresolved placeholders ${preview.placeholder_warnings.join(", ")}` : "";
  const configurations = preview.candidate_configurations.map((candidate) => `${candidate.id}: ${[candidate.display_name, candidate.display_variant, candidate.native_reasoning_effort && `native effort=${candidate.native_reasoning_effort}`, candidate.native_variant && `native variant=${candidate.native_variant}`, candidate.provider_route && `route=${candidate.provider_route}`].filter(Boolean).join("; ") || "legacy configuration"}`).join(" | ");
  return [`Trial: ${preview.trial_id}`, `Candidates: ${preview.candidate_count} across ${preview.adapter_count} adapter(s); distinct complete configurations: ${preview.topology.distinct_configuration_count}`, `Execution order: ${preview.execution_order.join(", ")}`, `Configurations: ${configurations}`, `Candidate timeout: ${preview.candidate_timeout_ms} ms; transport retries: ${preview.transport_retry_allowance}`, `Maximum attempts per candidate: ${preview.maximum_candidate_attempts}; maximum attempts across all candidates: ${preview.maximum_total_candidate_attempts}`, `Candidate-process upper bound (not a prediction): ${preview.candidate_process_upper_bound_ms} ms`, `Configured-validation upper bound (not a prediction): ${preview.independent_validation_upper_bound_ms} ms`, `Policies: dependencies=${preview.dependency_policy}; intervention=${preview.intervention_policy}`, `Paths: ${preview.allowed_path_count} allowed; ${preview.forbidden_path_count} forbidden`, `Validation commands: ${preview.validation_commands.map((command) => command.join(" ")).join(" | ")}`, `Held constant: ${preview.topology.held_constant_dimensions.join(", ") || "none"}`, `Varied: ${varied}`, `Controlled sweeps: ${sweeps}`, `Exact duplicate groups: ${duplicates}`, `Multi-variable pairs: ${preview.topology.multi_variable_pair_count}; examples: ${examples}${truncation}`, `Supported structural claims: ${claims}`, `Unsupported causal claims: ${limits}`, preview.noncausal_boundary + warnings].join("\n");
}
