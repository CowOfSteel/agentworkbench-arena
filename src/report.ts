import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { analyzeTopology, ComparisonTopology, TopologyDimension } from "./topology";
import { candidateDisplayName, candidateResult, formatCompactNumber, formatDuration, formatMetricValue, formatRetryCount, formattedChange, formattedCost, lensReason, lensValue, metricLabel, metricNumber, notReported, recommendedSpeedDifference, reportedTokens, semanticQuality } from "./report-presentation";

type JsonObject = Record<string, any>;
export type Outcome = "RECOMMENDATION" | "TIE" | "NO_WINNER" | "INCONCLUSIVE";
export interface ReportMetric { value: unknown; availability: "available" | "unavailable"; source: unknown; }
export interface ReportGate { id: string; status: "passed" | "failed" | "unavailable"; reason: string; }
export type SemanticCriterion = "acceptance_coverage" | "maintainability" | "architecture_fit" | "regression_risk" | "unnecessary_complexity" | "evidence_quality";
export type SemanticOrdinal = "strong" | "adequate" | "weak" | "insufficient_evidence";
export type SemanticCriteria = Record<SemanticCriterion, SemanticOrdinal>;
export type CoverageStatus = "available_nonzero" | "established_zero" | "unavailable";
export interface DecisionLens { id: string; label: string; status: "winner" | "tie" | "not_comparable" | "not_applicable"; candidateIds: string[]; values?: Record<string, unknown>; reason: string; }
export interface ReportCandidate {
  id: string; label: string; eligibility: "eligible" | "excluded"; hardGateStatus: string; semanticRank: number | null; semanticTier: string | null;
  configuration: { adapter: string | null; harness: string | null; provider: string | null; providerRoute: string | null; model: string | null; attention: string | null; displayName: string | null; displayVariant: string | null; nativeReasoningEffort: string | null; nativeVariant: string | null; effectiveProviderReasoningEffort: string | null; reasoningEvidenceSource: string | null; agent: string | null; profile: string | null; permissionPolicy: unknown; declaredToolsPlugins: string[] | null; configurationHash: string; };
  gates: ReportGate[]; exclusions: ReportGate[]; rationale: string | null; strengths: string[]; risks: string[]; validation: Array<{ args: string[]; status: string; wallClockMs: number; exitCode: number | null; timeout: boolean; failureClassification: string | null; }>;
  criteria: SemanticCriteria | null; completionStatus: string; metrics: Record<string, ReportMetric>; coverage: { available: number; unavailable: number; metrics: Record<string, { status: CoverageStatus; source: unknown }>; }; placement: { why: string[]; why_not: string[]; }; evidence: string[];
}
export interface ReportModel {
  schemaVersion: "1.0"; runId: string; trialId: string; evaluationSchemaVersion: string; comparisonMode: string; objective: string; validationCommands: string[][];
  outcome: Outcome; recommendedCandidate: string | null; tiedCandidates: string[]; confidence: string | null; summary: string | null; limitations: string[];
  runPipelineMs: number; candidates: ReportCandidate[]; rootEvidence: string[]; noncausalStatement: string;
  judgeExecution: { status: string; failureClassification: string | null; }; sourceExecutionLimitations: string[];
  sampleMetadata: { schemaVersion: "1.0"; kind: "sanitized_derivative"; evidenceCompletenessScope: string; omittedArtifacts: string[]; retainedResults: string; } | null;
  topology: ComparisonTopology; decisionLenses: DecisionLens[]; telemetryMetricNames: string[];
}
export interface CompletedRun {
  directory: string; manifest: JsonObject; taskContract: JsonObject; snapshot: JsonObject; identityMap: JsonObject; evaluation: JsonObject; adjudication: JsonObject; judgeResult: JsonObject;
  sampleMetadata: ReportModel["sampleMetadata"];
  candidates: Array<{ manifest: JsonObject; evaluation: JsonObject; provenance: JsonObject; telemetry: JsonObject; validation: JsonObject; diff: string; directory: string; }>;
}

const rootArtifacts = ["manifest.json", "task-contract.json", "trial-snapshot.json", "identity-map.json", "evaluation.json", "adjudication.json", "judge-result.json"];
const candidateArtifacts = ["provenance.json", "telemetry.json", "validation.json", "candidate.diff"];
const semanticCriteria: SemanticCriterion[] = ["acceptance_coverage", "maintainability", "architecture_fit", "regression_risk", "unnecessary_complexity", "evidence_quality"];
const semanticOrdinals = new Set<SemanticOrdinal>(["strong", "adequate", "weak", "insufficient_evidence"]);
const noncausalStatement = "Arena compares complete configurations. Observed differences cannot be attributed to any single model, harness, provider, attention level, tool, or profile.";
const recommendationSchemaVersion = "1.1";
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const object = (value: unknown, label: string): JsonObject => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as JsonObject; };
const array = (value: unknown, label: string): any[] => { if (!Array.isArray(value)) throw new Error(`${label} must be an array`); return value; };
const text = (value: unknown, label: string): string => { if (typeof value !== "string" || !value) throw new Error(`${label} must be a nonempty string`); return value; };
const nullableText = (value: unknown, label: string): string | null => { if (value === null) return null; return text(value, label); };
const nullableOptional = (value: Record<string, unknown>, key: string, label: string): string | null => { const result = optional(value, key); return result === undefined ? null : nullableText(result, label); };
const sameSet = (left: string[], right: string[]): boolean => left.length === right.length && new Set(left).size === left.length && new Set(right).size === right.length && left.every((item) => right.includes(item));
const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const portable = (value: unknown): value is string => typeof value === "string" && value.length > 0 && !isAbsolute(value) && !/^[A-Za-z]:/.test(value) && !value.includes("\\") && !value.split("/").includes("..") && !value.split("/").includes("");
const confined = (root: string, path: string): boolean => { const rel = relative(root, path); return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel); };
const exactKeys = (value: JsonObject, keys: string[], label: string): void => { if (!sameSet(Object.keys(value), keys)) throw new Error(`${label} is invalid`); };

async function artifact(root: string, path: string): Promise<string> {
  if (!portable(path)) throw new Error("artifact path is not portable");
  const absolute = resolve(root, ...path.split("/"));
  if (!confined(root, absolute)) throw new Error("artifact path escapes run directory");
  const info = await lstat(absolute).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`required artifact is missing or unsafe: ${path}`);
  const actual = await realpath(absolute);
  if (!confined(root, actual)) throw new Error("artifact path escapes run directory");
  return readFile(actual, "utf8");
}

async function jsonArtifact(root: string, path: string): Promise<JsonObject> {
  try { return object(JSON.parse(await artifact(root, path)), path); }
  catch (error) { if (error instanceof SyntaxError) throw new Error(`artifact is malformed: ${path}`); throw error; }
}

async function optionalJsonArtifact(root: string, path: string): Promise<JsonObject | null> {
  const absolute = resolve(root, ...path.split("/"));
  return await lstat(absolute).catch(() => null) ? jsonArtifact(root, path) : null;
}

function gate(value: unknown): ReportGate {
  const item = object(value, "hard gate"), status = text(item.status, "gate status");
  if (!['passed', 'failed', 'unavailable'].includes(status)) throw new Error("hard gate status is invalid");
  return { id: text(item.id, "gate id"), status: status as ReportGate["status"], reason: text(item.reason, "gate reason") };
}

function metric(value: unknown, label: string): ReportMetric {
  const item = object(value, label);
  if (!['available', 'unavailable'].includes(item.availability) || !("value" in item) || !("source" in item)) throw new Error(`${label} is invalid`);
  if (item.availability === "unavailable" && item.value !== null) throw new Error(`${label} availability is inconsistent`);
  if (item.availability === "available" && item.value === null) throw new Error(`${label} availability is inconsistent`);
  return item as ReportMetric;
}

function criteriaByCandidate(value: unknown, labels: string[]): Record<string, SemanticCriteria> {
  const byLabel = object(value, "semantic criteria"); exactKeys(byLabel, labels, "semantic criteria");
  return Object.fromEntries(labels.map((label) => {
    const entry = object(byLabel[label], "semantic criterion"); exactKeys(entry, semanticCriteria, "semantic criterion");
    for (const criterion of semanticCriteria) if (!semanticOrdinals.has(entry[criterion])) throw new Error("semantic criterion is invalid");
    return [label, Object.fromEntries(semanticCriteria.map((criterion) => [criterion, entry[criterion]])) as SemanticCriteria];
  }));
}

function sampleMetadata(value: JsonObject): NonNullable<ReportModel["sampleMetadata"]> {
  exactKeys(value, ["schema_version", "kind", "evidence_completeness_scope", "omitted_artifacts", "retained_results"], "sample metadata");
  if (value.schema_version !== "1.0" || value.kind !== "sanitized_derivative") throw new Error("sample metadata is invalid");
  return { schemaVersion: "1.0", kind: "sanitized_derivative", evidenceCompletenessScope: text(value.evidence_completeness_scope, "sample metadata scope"), omittedArtifacts: array(value.omitted_artifacts, "sample metadata omissions").map((item) => text(item, "sample metadata omission")), retainedResults: text(value.retained_results, "sample metadata results") };
}

function validateOutcome(evaluation: JsonObject, adjudication: JsonObject, judgeResult: JsonObject, candidates: JsonObject[]): void {
  const outcome = text(evaluation.outcome, "evaluation outcome") as Outcome;
  if (!["RECOMMENDATION", "TIE", "NO_WINNER", "INCONCLUSIVE"].includes(outcome)) throw new Error("evaluation outcome is invalid");
  const recommended = evaluation.recommended_candidate_id, tied = array(evaluation.tied_candidate_ids, "tied candidates");
  const eligible = new Set(candidates.filter((item) => item.eligibility === "eligible").map((item) => text(item.candidate_id, "candidate id")));
  if (outcome === "RECOMMENDATION" && (typeof recommended !== "string" || !eligible.has(recommended) || tied.length)) throw new Error("recommendation is inconsistent");
  if (outcome === "TIE" && (recommended !== null || tied.length < 2 || tied.some((id) => typeof id !== "string" || !eligible.has(id)) || new Set(tied).size !== tied.length)) throw new Error("tie is inconsistent");
  if ((outcome === "NO_WINNER" || outcome === "INCONCLUSIVE") && (recommended !== null || tied.length)) throw new Error("evaluation outcome is inconsistent");
  const verdict = adjudication.verdict;
  if (outcome === "NO_WINNER") {
    if (eligible.size || verdict !== null || judgeResult.status !== "not_invoked_no_eligible_candidates") throw new Error("no-winner evidence is inconsistent");
    return;
  }
  if (verdict !== null) {
    const accepted = object(verdict, "adjudication verdict");
    if (accepted.verdict !== outcome || judgeResult.status !== "completed" || !sameJson(evaluation.adjudication, accepted)) throw new Error("accepted adjudication is inconsistent");
  } else if (outcome !== "INCONCLUSIVE" || judgeResult.status !== "inconclusive" || object(evaluation.adjudication, "evaluation adjudication").status !== "inconclusive") throw new Error("inconclusive evidence is inconsistent");
}

export async function loadCompletedRun(runDirectory: string): Promise<CompletedRun> {
  const requested = resolve(runDirectory), requestedInfo = await lstat(requested).catch(() => null);
  if (!requestedInfo?.isDirectory()) throw new Error("run directory does not exist");
  const directory = await realpath(requested);
  const [rootValues, sample] = await Promise.all([Promise.all(rootArtifacts.map((path) => jsonArtifact(directory, path))), optionalJsonArtifact(directory, "sample-metadata.json")]);
  const [manifest, taskContract, snapshot, identityMap, evaluation, adjudication, judgeResult] = rootValues;
  if (manifest.run_status !== "completed" || manifest.manifest_finalization_status !== "complete" || manifest.phase_3_readiness !== "ready_for_audit") throw new Error("run is not finalized");
  if (typeof taskContract.objective !== "string" || hash(taskContract.objective) !== taskContract.task_contract_hash || taskContract.task_contract_hash !== manifest.task_contract_hash) throw new Error("task contract integrity check failed");
  if (hash(JSON.stringify(snapshot)) !== manifest.normalized_trial_snapshot_hash || snapshot.task_contract_hash !== manifest.task_contract_hash) throw new Error("trial snapshot integrity check failed");
  if (manifest.task_contract_artifact !== "task-contract.json") throw new Error("run identity is inconsistent");

  const manifestCandidates = array(manifest.candidates, "manifest candidates").map((item) => object(item, "manifest candidate"));
  const snapshotCandidates = array(snapshot.candidates, "snapshot candidates").map((item) => object(item, "snapshot candidate"));
  const evaluationCandidates = array(evaluation.candidates, "evaluation candidates").map((item) => object(item, "evaluation candidate"));
  if (manifest.candidate_count !== manifestCandidates.length) throw new Error("manifest candidate count mismatch");
  const manifestIds = manifestCandidates.map((item) => text(item.candidate_id, "candidate id"));
  const snapshotIds = snapshotCandidates.map((item) => text(item.id, "candidate id"));
  const evaluationIds = evaluationCandidates.map((item) => text(item.candidate_id, "candidate id"));
  if (!sameSet(manifestIds, snapshotIds) || !sameSet(manifestIds, evaluationIds)) throw new Error("candidate sets are inconsistent");
  if (new Set(evaluationIds).size !== evaluationIds.length) throw new Error("evaluation contains duplicate candidates");

  const labels = object(identityMap.labels, "identity labels"), labelEntries = Object.entries(labels);
  const evaluationLabels = evaluationCandidates.map((item) => text(item.label, "candidate label"));
  if (!sameSet(labelEntries.map(([label]) => label), evaluationLabels) || !sameSet(labelEntries.map(([, id]) => text(id, "mapped candidate id")), manifestIds)) throw new Error("identity mapping is not bijective");
  for (const item of evaluationCandidates) if (labels[item.label] !== item.candidate_id) throw new Error("identity mapping is inconsistent");
  const eligibleLabels = evaluationCandidates.filter((item) => item.eligibility === "eligible").map((item) => item.label);
  if (!sameSet(array(adjudication.labels, "adjudication labels"), evaluationLabels) || !sameSet(array(adjudication.eligible_labels, "eligible labels"), eligibleLabels)) throw new Error("adjudication candidate sets are inconsistent");
  let excludedSeen = false;
  for (const item of evaluationCandidates) { if (!['eligible', 'excluded'].includes(item.eligibility)) throw new Error("candidate eligibility is invalid"); if (item.eligibility === "excluded") excludedSeen = true; else if (excludedSeen) throw new Error("eligible candidates must precede excluded candidates"); }
  validateOutcome(evaluation, adjudication, judgeResult, evaluationCandidates);
  const accepted = adjudication.verdict === null ? null : object(adjudication.verdict, "accepted verdict"), semanticRanking = accepted ? array(accepted.ranking, "semantic ranking").map((item) => object(item, "semantic ranking item")) : [];
  if (accepted) {
    if (!sameSet(semanticRanking.map((item) => text(item.label, "semantic label")), eligibleLabels)) throw new Error("semantic ranking is inconsistent");
    criteriaByCandidate(accepted.criteria_by_candidate, evaluationLabels);
    for (const item of evaluationCandidates) {
      const semantic = semanticRanking.find((entry) => entry.label === item.label);
      if (item.eligibility === "eligible" ? !semantic || semantic.rank !== item.semantic_rank || semantic.tier !== item.semantic_tier : item.semantic_rank !== null || item.semantic_tier !== null) throw new Error("semantic candidate record is inconsistent");
    }
    const recommendedIds = array(accepted.recommended_labels, "recommended labels").map((label) => labels[text(label, "recommended label")]);
    if (evaluation.outcome === "RECOMMENDATION" && recommendedIds[0] !== evaluation.recommended_candidate_id || evaluation.outcome === "TIE" && !sameJson(recommendedIds, evaluation.tied_candidate_ids)) throw new Error("semantic recommendation mapping is inconsistent");
  } else if (evaluationCandidates.some((item) => item.semantic_rank !== null || item.semantic_tier !== null)) throw new Error("semantic candidate record is inconsistent");

  const candidatesDirectory = join(directory, "candidates"), entries = await readdir(candidatesDirectory, { withFileTypes: true }).catch(() => []);
  if (entries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink())) throw new Error("candidate directories are inconsistent");
  const actualDirectories = entries.map((entry) => entry.name);
  if (!sameSet(actualDirectories, manifestIds)) throw new Error("candidate directories are inconsistent");
  const candidates = [] as CompletedRun["candidates"];
  for (const evaluated of evaluationCandidates) {
    const id = text(evaluated.candidate_id, "candidate id"), manifestCandidate = manifestCandidates.find((item) => item.candidate_id === id)!;
    const snapshotCandidate = snapshotCandidates.find((item) => item.id === id)!;
    const artifactDirectory = text(manifestCandidate.artifact_directory, "candidate artifact directory");
    if (artifactDirectory !== `candidates/${id}` || !portable(artifactDirectory)) throw new Error("candidate artifact path is invalid");
    const directoryInfo = await lstat(join(directory, ...artifactDirectory.split("/")));
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error("candidate artifact directory is unsafe");
    const [provenance, telemetry, validation, diff] = await Promise.all([
      jsonArtifact(directory, `${artifactDirectory}/provenance.json`), jsonArtifact(directory, `${artifactDirectory}/telemetry.json`),
      jsonArtifact(directory, `${artifactDirectory}/validation.json`), artifact(directory, `${artifactDirectory}/candidate.diff`)
    ]);
    const telemetryProvenance = object(telemetry.provenance, "telemetry provenance"), output = object(telemetry.output, "telemetry output");
    if (telemetry.finalization_status !== "complete" || telemetryProvenance.candidate_id !== id || provenance.candidate_id !== id || telemetryProvenance.task_contract_hash !== manifest.task_contract_hash) throw new Error("candidate provenance is inconsistent");
    if (telemetryProvenance.configuration_hash !== manifestCandidate.configuration_hash || snapshotCandidate.configuration_hash !== manifestCandidate.configuration_hash) throw new Error("candidate configuration hash is inconsistent");
    const recordedStatus = metric(output.hard_gate_status, "hard-gate status").value;
    if (recordedStatus !== evaluated.hard_gate_status || manifestCandidate.hard_gate_status !== evaluated.hard_gate_status) throw new Error("candidate hard-gate status is inconsistent");
    const gates = array(telemetry.hard_gates, "hard gates").map(gate), exclusions = gates.filter((item) => item.status !== "passed"), evaluatedExclusions = array(evaluated.exclusion_gates, "evaluation exclusions").map(gate);
    if (evaluated.eligibility === "eligible" ? evaluatedExclusions.length !== 0 || recordedStatus !== "passed" : !sameJson(exclusions, evaluatedExclusions)) throw new Error("candidate eligibility evidence is inconsistent");
    array(validation.commands, "validation commands");
    candidates.push({ manifest: manifestCandidate, evaluation: evaluated, provenance, telemetry, validation, diff, directory: artifactDirectory });
  }
  return { directory, manifest, taskContract, snapshot, identityMap, evaluation, adjudication, judgeResult, sampleMetadata: sample ? sampleMetadata(sample) : null, candidates };
}

const sourceMetric = (group: JsonObject, name: string): ReportMetric => metric(group[name], name);
const isMetric = (value: unknown): boolean => Boolean(value && typeof value === "object" && !Array.isArray(value) && "availability" in value && "value" in value && "source" in value);
const metricOrder = ["wall_clock_ms", "attempt_execution_ms", "retry_overhead_ms", "validation_wall_clock_ms", "total_pipeline_ms", "input_tokens", "cached_input_tokens", "uncached_input_tokens", "output_tokens", "provider_reported_cost", "provider_reported_currency", "estimated_cost", "estimated_cost_currency", "subscription_consumption", "quota_percent_before", "quota_percent_after", "usage_source", "turn_count", "tool_call_count", "command_count", "retry_count", "approval_count", "human_intervention_count", "error_count", "permission_requests", "permission_denials", "user_questions", "manual_prompt_corrections", "manual_file_edits", "aborts", "transport_retries", "files_changed", "lines_added", "lines_deleted", "dependencies_added", "dependencies_removed", "untracked_files", "validation_pass_count", "validation_fail_count", "hard_gate_status"];
const zero = (value: unknown): boolean => value === 0 || value === false || Array.isArray(value) && value.length === 0;
const coverage = (metrics: Record<string, ReportMetric>): ReportCandidate["coverage"] => {
  const entries = Object.fromEntries(Object.entries(metrics).map(([name, value]) => [name, { status: value.availability === "unavailable" ? "unavailable" : zero(value.value) ? "established_zero" : "available_nonzero", source: value.source }])) as ReportCandidate["coverage"]["metrics"];
  return { available: Object.values(entries).filter((item) => item.status !== "unavailable").length, unavailable: Object.values(entries).filter((item) => item.status === "unavailable").length, metrics: entries };
};
const toolList = (value: unknown): string[] | null => { if (value === null) return []; if (!value || typeof value !== "object" || Array.isArray(value) || !("explicitly_enabled" in value)) return null; const tools = (value as JsonObject).explicitly_enabled; return Array.isArray(tools) && tools.every((tool) => typeof tool === "string") ? [...tools].sort() as string[] : null; };
const optional = (value: JsonObject, key: string): unknown => key in value ? value[key] : undefined;
const availableNumber = (candidate: ReportCandidate, name: string): number | null => { const metric = candidate.metrics[name]; return metric?.availability === "available" && typeof metric.value === "number" && Number.isFinite(metric.value) ? metric.value : null; };
function numericLens(id: string, label: string, candidates: ReportCandidate[], metric: string, transform: (candidate: ReportCandidate) => number | null = (candidate) => availableNumber(candidate, metric)): DecisionLens {
  const eligible = candidates.filter((candidate) => candidate.eligibility === "eligible"); if (!eligible.length) return { id, label, status: "not_applicable", candidateIds: [], reason: "No eligible candidates." };
  const values = Object.fromEntries(eligible.map((candidate) => [candidate.id, transform(candidate)])); if (Object.values(values).some((value) => value === null)) return { id, label, status: "not_comparable", candidateIds: [], reason: `Every eligible candidate needs available ${metric} evidence.` };
  const minimum = Math.min(...Object.values(values) as number[]), winners = eligible.filter((candidate) => values[candidate.id] === minimum).map((candidate) => candidate.id);
  return { id, label, status: winners.length === 1 ? "winner" : "tie", candidateIds: winners, values, reason: `${label} uses the lowest available ${metric}.` };
}
function decisionLenses(candidates: ReportCandidate[], outcome: Outcome, recommended: string | null, tied: string[]): DecisionLens[] {
  const overall = outcome === "RECOMMENDATION" ? { id: "controller_recommendation", label: "Controller recommendation", status: "winner" as const, candidateIds: recommended ? [recommended] : [], reason: "Controller-owned evaluation.json outcome." } : outcome === "TIE" ? { id: "controller_recommendation", label: "Controller recommendation", status: "tie" as const, candidateIds: tied, reason: "Controller-owned evaluation.json tie." } : { id: "controller_recommendation", label: "Controller recommendation", status: "not_applicable" as const, candidateIds: [], reason: `Controller outcome is ${outcome}.` };
  const cost = (() => { const eligible = candidates.filter((candidate) => candidate.eligibility === "eligible"); if (!eligible.length) return { id: "lowest_provider_reported_cost", label: "Lowest provider-reported cost", status: "not_applicable" as const, candidateIds: [], reason: "No eligible candidates." }; const rows = eligible.map((candidate) => ({ candidate, cost: availableNumber(candidate, "provider_reported_cost"), currency: candidate.metrics.provider_reported_currency, source: candidate.metrics.provider_reported_cost?.source })); if (rows.some((row) => row.cost === null || row.currency?.availability !== "available" || typeof row.currency.value !== "string") || new Set(rows.map((row) => String(row.currency?.value).toUpperCase())).size !== 1 || new Set(rows.map((row) => JSON.stringify(row.source))).size !== 1) return { id: "lowest_provider_reported_cost", label: "Lowest provider-reported cost", status: "not_comparable" as const, candidateIds: [], reason: "Eligible candidates lack compatible complete provider cost and currency evidence." }; const values = Object.fromEntries(rows.map((row) => [row.candidate.id, row.cost!])), minimum = Math.min(...Object.values(values)), winner = rows.filter((row) => row.cost === minimum).map((row) => row.candidate.id); return { id: "lowest_provider_reported_cost", label: "Lowest provider-reported cost", status: winner.length === 1 ? "winner" as const : "tie" as const, candidateIds: winner, values, reason: `Comparable currency: ${String(rows[0].currency.value).toUpperCase()}.` }; })();
  const tokens = (() => { const eligible = candidates.filter((candidate) => candidate.eligibility === "eligible"); if (!eligible.length) return { id: "lowest_token_usage", label: "Lowest reported token usage", status: "not_applicable" as const, candidateIds: [], reason: "No eligible candidates." }; const rows = eligible.map((candidate) => ({ candidate, input: availableNumber(candidate, "input_tokens"), output: availableNumber(candidate, "output_tokens"), source: candidate.metrics.usage_source })); const compatible = rows.every((row) => row.input !== null && row.output !== null && row.source?.availability === "available") && new Set(rows.map((row) => JSON.stringify(row.source?.value))).size === 1 && new Set(rows.flatMap((row) => [JSON.stringify(row.candidate.metrics.input_tokens?.source), JSON.stringify(row.candidate.metrics.output_tokens?.source)])).size === 1; if (!compatible) return { id: "lowest_token_usage", label: "Lowest reported token usage", status: "not_comparable" as const, candidateIds: [], reason: "Eligible candidates lack compatible complete token source semantics." }; const values = Object.fromEntries(rows.map((row) => [row.candidate.id, row.input! + row.output!])), minimum = Math.min(...Object.values(values)), winner = rows.filter((row) => values[row.candidate.id] === minimum).map((row) => row.candidate.id); return { id: "lowest_token_usage", label: "Lowest reported token usage", status: winner.length === 1 ? "winner" as const : "tie" as const, candidateIds: winner, values, reason: "Uses input_tokens plus output_tokens with matching source semantics." }; })();
  return [overall, numericLens("fastest_candidate_execution", "Fastest candidate execution", candidates, "wall_clock_ms"), numericLens("smallest_total_code_change", "Smallest total code change", candidates, "lines_added + lines_deleted", (candidate) => { const added = availableNumber(candidate, "lines_added"), deleted = availableNumber(candidate, "lines_deleted"); return added === null || deleted === null ? null : added + deleted; }), numericLens("fewest_interventions", "Fewest interventions", candidates, "human_intervention_count"), numericLens("fewest_retries", "Fewest retries", candidates, "retry_count"), cost, tokens, { id: "telemetry_coverage", label: "Telemetry coverage", status: "not_applicable", candidateIds: [], values: Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate.coverage])), reason: "Informational coverage only; it is not a coding-result quality score." }];
}
function placement(candidate: ReportCandidate, outcome: Outcome, recommended: string | null, tied: string[], lenses: DecisionLens[]): ReportCandidate["placement"] {
  const why: string[] = [], why_not: string[] = [];
  if (candidate.eligibility === "excluded") { why.push("Excluded by deterministic hard gates."); why_not.push(...candidate.exclusions.map((gate) => `${gate.id}: ${gate.reason}`)); }
  else if (outcome === "RECOMMENDATION" && candidate.id === recommended) why.push("Selected by the controller-owned recommendation.");
  else if (outcome === "TIE" && tied.includes(candidate.id)) why.push("Included in the controller-owned tie.");
  else if (outcome === "NO_WINNER") why.push("No eligible candidate exists, so no winner was selected.");
  else if (outcome === "INCONCLUSIVE") why.push("Eligible, but no accepted semantic verdict established a recommendation.");
  else { why.push("Eligible and retained in controller order."); why_not.push(`Not the controller recommendation; accepted semantic rank is ${candidate.semanticRank ?? "unavailable"}.`); }
  if (outcome === "NO_WINNER") why.push("NO_WINNER occurred because no candidate was deterministically eligible.");
  if (outcome === "INCONCLUSIVE") why_not.push("INCONCLUSIVE outcome: no accepted semantic verdict established a winner.");
  if (candidate.rationale) why.push(candidate.rationale); why_not.push(...candidate.risks);
  for (const lens of lenses.filter((lens) => (lens.status === "winner" || lens.status === "tie") && lens.candidateIds.includes(candidate.id))) why.push(`Informational lens: ${lens.label}.`);
  return { why, why_not };
}
export function buildReportModel(run: CompletedRun): ReportModel {
  const verdict = run.adjudication.verdict ? object(run.adjudication.verdict, "accepted verdict") : null;
  const ranking = verdict ? array(verdict.ranking, "semantic ranking").map((item) => object(item, "semantic ranking item")) : [];
  const criteria = verdict ? criteriaByCandidate(verdict.criteria_by_candidate, run.candidates.map((candidate) => text(candidate.evaluation.label, "candidate label"))) : {};
  const strengths = verdict ? object(verdict.strengths_by_candidate, "semantic strengths") : {};
  const risks = verdict ? object(verdict.risks_by_candidate, "semantic risks") : {};
  const candidates = run.candidates.map((candidate): ReportCandidate => {
    const evaluated = candidate.evaluation, provenance = candidate.provenance, telemetry = candidate.telemetry;
    const execution = object(telemetry.execution, "execution telemetry"), usage = object(telemetry.usage, "usage telemetry"), intervention = object(telemetry.intervention, "intervention telemetry"), output = object(telemetry.output, "output telemetry");
    const label = text(evaluated.label, "candidate label"), rank = ranking.find((item) => item.label === label);
    const metrics: Record<string, ReportMetric> = {};
    for (const group of [execution, usage, intervention, output]) for (const [name, value] of Object.entries(group)) if (isMetric(value)) metrics[name] = sourceMetric(group, name);
    const validation = array(candidate.validation.commands, "validation commands").map((raw) => { const item = object(raw, "validation command"); return { args: array(item.args, "validation args").map((arg) => text(arg, "validation arg")), status: text(item.status, "validation status"), wallClockMs: Number(item.wall_clock_ms), exitCode: item.exit_code === null ? null : Number(item.exit_code), timeout: Boolean(item.timeout), failureClassification: item.failure_classification === null ? null : text(item.failure_classification, "failure classification") }; });
    const gates = array(telemetry.hard_gates, "hard gates").map(gate), exclusions = array(evaluated.exclusion_gates, "exclusions").map(gate);
    return {
      id: text(evaluated.candidate_id, "candidate id"), label, eligibility: evaluated.eligibility, hardGateStatus: text(evaluated.hard_gate_status, "hard-gate status"), semanticRank: evaluated.semantic_rank === null ? null : Number(evaluated.semantic_rank), semanticTier: evaluated.semantic_tier === null ? null : text(evaluated.semantic_tier, "semantic tier"),
      configuration: {
        adapter: nullableText(provenance.adapter, "adapter"), harness: nullableText(provenance.harness, "harness"), provider: nullableText(provenance.provider, "provider"), providerRoute: nullableOptional(provenance, "provider_route", "provider route"), model: nullableText(provenance.model, "model"),
        attention: nullableText(provenance.attention, "attention"),
        displayName: nullableOptional(provenance, "display_name", "display name"), displayVariant: nullableOptional(provenance, "display_variant", "display variant"), nativeReasoningEffort: nullableOptional(provenance, "native_reasoning_effort", "native reasoning effort"), nativeVariant: nullableOptional(provenance, "native_variant", "native variant"), effectiveProviderReasoningEffort: nullableOptional(object(optional(provenance, "reasoning") ?? {}, "reasoning"), "effective_provider_reasoning_effort", "effective provider reasoning effort"), reasoningEvidenceSource: nullableOptional(object(optional(provenance, "reasoning") ?? {}, "reasoning"), "evidence_source", "reasoning evidence source"), agent: nullableText(provenance.agent, "agent"), profile: nullableText(provenance.profile, "profile"), permissionPolicy: optional(provenance, "permission_policy"), declaredToolsPlugins: toolList(optional(provenance, "candidate_tool_provenance")), configurationHash: text(candidate.manifest.configuration_hash, "configuration hash")
      },
      gates, exclusions, rationale: rank ? text(rank.rationale, "semantic rationale") : null, strengths: array(strengths[label] ?? [], "strengths").map((item) => text(item, "strength")), risks: array(risks[label] ?? [], "risks").map((item) => text(item, "risk")), criteria: verdict ? criteria[label] : null, completionStatus: text(candidate.manifest.completion_status, "candidate completion status"), validation, metrics, coverage: coverage(metrics), placement: { why: [], why_not: [] },
      evidence: candidateArtifacts.map((name) => `${candidate.directory}/${name}`)
    };
  });
  const original = run.judgeResult.original === null ? null : object(run.judgeResult.original, "judge original execution");
  const judgeFailureClassification = original?.failure_classification === undefined ? null : nullableText(original.failure_classification, "judge failure classification");
  const sourceExecutionLimitations = [
    ...candidates.filter((candidate) => candidate.completionStatus !== "completed").map((candidate) => `${run.sampleMetadata ? "Historical" : "Recorded"} source completion status for ${candidate.label}: ${candidate.completionStatus}.`),
    ...(judgeFailureClassification ? [`${run.sampleMetadata ? "Historical" : "Recorded"} judge original failure classification: ${judgeFailureClassification}.`] : [])
  ];
  const topology = analyzeTopology(candidates.map((candidate) => ({ id: candidate.id, dimensions: { adapter: candidate.configuration.adapter, harness: candidate.configuration.harness, provider: candidate.configuration.provider, provider_route: candidate.configuration.providerRoute, model: candidate.configuration.model, attention: candidate.configuration.nativeReasoningEffort ? null : candidate.configuration.attention, native_reasoning_effort: candidate.configuration.nativeReasoningEffort, native_variant: candidate.configuration.nativeVariant, agent: candidate.configuration.agent, profile: candidate.configuration.profile, permission_policy: candidate.configuration.permissionPolicy, declared_tools_plugins: candidate.configuration.declaredToolsPlugins ?? undefined } as Partial<Record<TopologyDimension, unknown>> })));
  const decisionLensResults = decisionLenses(candidates, run.evaluation.outcome, run.evaluation.recommended_candidate_id, run.evaluation.tied_candidate_ids);
  const telemetryMetricNames = [...new Set(candidates.flatMap((candidate) => Object.keys(candidate.metrics)))].sort((left, right) => (metricOrder.indexOf(left) < 0 ? Number.MAX_SAFE_INTEGER : metricOrder.indexOf(left)) - (metricOrder.indexOf(right) < 0 ? Number.MAX_SAFE_INTEGER : metricOrder.indexOf(right)) || left.localeCompare(right));
  const placedCandidates = candidates.map((candidate) => ({ ...candidate, placement: placement(candidate, run.evaluation.outcome, run.evaluation.recommended_candidate_id, run.evaluation.tied_candidate_ids, decisionLensResults) }));
  return {
    schemaVersion: "1.0", runId: text(run.manifest.run_id, "run id"), trialId: text(run.manifest.trial_id, "trial id"), evaluationSchemaVersion: text(run.evaluation.schema_version, "evaluation schema"), comparisonMode: text(run.manifest.comparison_mode, "comparison mode"), objective: text(run.taskContract.objective, "task objective"), validationCommands: array(run.taskContract.validation_commands, "task validation commands").map((command) => array(command, "validation command").map((arg) => text(arg, "validation argument"))),
    outcome: run.evaluation.outcome, recommendedCandidate: run.evaluation.recommended_candidate_id, tiedCandidates: run.evaluation.tied_candidate_ids, confidence: verdict ? text(verdict.confidence, "confidence") : null, summary: verdict ? text(verdict.summary, "semantic summary") : null, limitations: verdict ? array(verdict.limitations, "limitations").map((item) => text(item, "limitation")) : run.judgeResult.error ? [String(run.judgeResult.error)] : [],
    runPipelineMs: Number(run.manifest.total_pipeline_ms), candidates: placedCandidates, rootEvidence: [...rootArtifacts, ...(run.sampleMetadata ? ["sample-metadata.json"] : [])], noncausalStatement,
    judgeExecution: { status: text(run.judgeResult.status, "judge status"), failureClassification: judgeFailureClassification }, sourceExecutionLimitations, sampleMetadata: run.sampleMetadata, topology, decisionLenses: decisionLensResults, telemetryMetricNames
  };
}

const escapeHtml = (value: unknown): string => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const valueText = (value: unknown): string => typeof value === "object" ? JSON.stringify(value) : String(value);
const configText = (value: unknown): string => value === null || value === undefined || value === "" ? notReported : valueText(value);
const link = (path: string): string => `<a href="${path.split('/').map(encodeURIComponent).join('/')}">${escapeHtml(path)}</a>`;
const list = (items: string[], empty = "None reported"): string => items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p>${escapeHtml(empty)}</p>`;
const linkList = (items: string[]): string => `<ul>${items.map((item) => `<li>${link(item)}</li>`).join("")}</ul>`;
const plain = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;

function recommendationDto(model: ReportModel): Record<string, unknown> {
  const topology = {
    candidate_count: model.topology.candidate_count,
    distinct_configuration_count: model.topology.distinct_configuration_count,
    held_constant_dimensions: [...model.topology.held_constant_dimensions],
    varied_dimensions: model.topology.varied_dimensions.map((item) => ({ dimension: item.dimension, values: plain(item.values), incomplete: item.incomplete })),
    controlled_sweeps: model.topology.controlled_sweeps.map((item) => ({ dimension: item.dimension, candidate_ids: [...item.candidates], values: item.values.map((value) => ({ candidate_id: value.candidate, value: plain(value.value) })) })),
    duplicate_configuration_groups: model.topology.duplicate_configuration_groups.map((candidate_ids) => ({ candidate_ids: [...candidate_ids] })),
    multi_variable_pair_count: model.topology.multi_variable_pair_count,
    multi_variable_pairs: model.topology.multi_variable_pairs.map((item) => ({ candidate_ids: [...item.candidates], differing_dimensions: [...item.differing_dimensions] })),
    multi_variable_pairs_truncated: model.topology.multi_variable_pairs_truncated,
    uncomparable_pair_count: model.topology.uncomparable_pair_count,
    supported_structural_claims: [...model.topology.supported_structural_claims],
    unsupported_causal_claims: [...model.topology.unsupported_causal_claims]
  };
  const lenses = model.decisionLenses.map((lens) => ({ id: lens.id, label: lens.label, status: lens.status, candidate_ids: [...lens.candidateIds], ...(lens.values ? { values: plain(lens.values) } : {}), reason: lens.reason }));
  return {
    schema_version: recommendationSchemaVersion,
    source: { run_id: model.runId, trial_id: model.trialId, evaluation_schema_version: model.evaluationSchemaVersion, comparison_mode: model.comparisonMode },
    outcome: model.outcome, recommended_candidate: model.recommendedCandidate, tied_candidates: [...model.tiedCandidates], confidence: model.confidence, routing_applied: false,
    ranking: model.candidates.map((candidate) => ({ candidate_id: candidate.id, opaque_label: candidate.label, eligibility: candidate.eligibility, hard_gate_status: candidate.hardGateStatus, source_completion_status: candidate.completionStatus, configuration: { display_name: candidate.configuration.displayName, display_variant: candidate.configuration.displayVariant, provider_route: candidate.configuration.providerRoute, native_reasoning_effort: candidate.configuration.nativeReasoningEffort, native_variant: candidate.configuration.nativeVariant, effective_provider_reasoning_effort: candidate.configuration.effectiveProviderReasoningEffort, reasoning_evidence_source: candidate.configuration.reasoningEvidenceSource }, semantic_rank: candidate.semanticRank, semantic_tier: candidate.semanticTier, semantic_criteria: candidate.criteria ? plain(candidate.criteria) : null, exclusion_reasons: candidate.exclusions.map((item) => ({ gate_id: item.id, status: item.status, reason: item.reason })), reasons: candidate.eligibility === "eligible" ? [candidate.rationale, ...candidate.strengths].filter((item): item is string => Boolean(item)) : candidate.exclusions.map((item) => `${item.id}: ${item.reason}`), tradeoffs: [...candidate.risks], placement: { why: [...candidate.placement.why], why_not: [...candidate.placement.why_not] }, telemetry_coverage: { available: candidate.coverage.available, unavailable: candidate.coverage.unavailable, metrics: Object.fromEntries(Object.entries(candidate.coverage.metrics).map(([name, metric]) => [name, { status: metric.status, source: plain(metric.source) }])) }, evidence_references: ["evaluation.json", "adjudication.json", ...candidate.evidence] })),
    comparison_topology: topology, decision_lenses: lenses, judge_execution: { status: model.judgeExecution.status, failure_classification: model.judgeExecution.failureClassification }, source_execution_limitations: [...model.sourceExecutionLimitations], evidence_references: [...model.rootEvidence], noncausal_statement: model.noncausalStatement,
    ...(model.sampleMetadata ? { sample_metadata: { schema_version: model.sampleMetadata.schemaVersion, kind: model.sampleMetadata.kind, evidence_completeness_scope: model.sampleMetadata.evidenceCompletenessScope, omitted_artifacts: [...model.sampleMetadata.omittedArtifacts], retained_results: model.sampleMetadata.retainedResults } } : {})
  };
}

export function renderReportHtml(model: ReportModel): string {
  const gates = [...new Set(model.candidates.flatMap((candidate) => candidate.gates.map((item) => item.id)))];
  const metricNames = model.telemetryMetricNames;
  const byId = (id: string): ReportCandidate | undefined => model.candidates.find((candidate) => candidate.id === id);
  const nameById = (id: string): string => { const candidate = byId(id); return candidate ? candidateDisplayName(candidate) : id; };
  const resultFor = (candidate: ReportCandidate): string => candidateResult(candidate, model.outcome, model.recommendedCandidate, model.tiedCandidates);
  const outcomeDetail = model.outcome === "RECOMMENDATION" && model.recommendedCandidate ? `Recommended: ${nameById(model.recommendedCandidate)}` : model.outcome === "TIE" ? `Tied: ${model.tiedCandidates.map(nameById).join(", ")}` : model.outcome === "NO_WINNER" ? "No candidate was eligible" : "No conclusive recommendation";
  const atGlanceRows = model.candidates.map((candidate) => {
    const result = resultFor(candidate), className = result.toLowerCase().replace(/\s+/g, "-");
    const exclusion = candidate.eligibility === "excluded" ? `<br><small>${escapeHtml(candidate.exclusions.map((gate) => gate.id).join(", ") || "Deterministic exclusion")}</small>` : "";
    return `<tr class="${escapeHtml(className)}"><th scope="row">${escapeHtml(candidateDisplayName(candidate))}</th><td><strong>${escapeHtml(result)}</strong>${exclusion}</td><td>${escapeHtml(semanticQuality(candidate))}</td><td>${escapeHtml(formatDuration(metricNumber(candidate.metrics.wall_clock_ms)))}</td><td>${escapeHtml(formatCompactNumber(reportedTokens(candidate)))}</td><td>${escapeHtml(formattedCost(candidate))}</td><td>${escapeHtml(formatMetricValue("tool_call_count", candidate.metrics.tool_call_count, candidate.metrics))}</td><td>${escapeHtml(formatMetricValue("retry_count", candidate.metrics.retry_count, candidate.metrics))}</td><td>${escapeHtml(formatMetricValue("human_intervention_count", candidate.metrics.human_intervention_count, candidate.metrics))}</td><td>${escapeHtml(formattedChange(candidate))}</td></tr>`;
  }).join("");
  const stateStyles = `<style>.summary-table tr.recommended,.candidate-card.recommended{background:#f0fff4;box-shadow:inset .35rem 0 #276749}.summary-table tr.tied,.candidate-card.tied{background:#ebf8ff;box-shadow:inset .35rem 0 #2b6cb0}.summary-table tr.eligible,.candidate-card.eligible{background:#f7fafc;box-shadow:inset .35rem 0 #4a5568}.summary-table tr.inconclusive,.candidate-card.inconclusive{background:#fffaf0;box-shadow:inset .35rem 0 #b7791f}.summary-table tr.excluded,.candidate-card.excluded{background:#fff5f5;box-shadow:inset .35rem 0 #c53030}.candidate-card.recommended,.candidate-card.tied,.candidate-card.eligible,.candidate-card.inconclusive,.candidate-card.excluded{border-top:.4rem solid currentColor}.candidate-card.recommended{color:#276749}.candidate-card.tied{color:#2b6cb0}.candidate-card.eligible{color:#4a5568}.candidate-card.inconclusive{color:#975a16}.candidate-card.excluded{color:#c53030}.candidate-card h3,.candidate-card p,.candidate-card dl,.candidate-card details,.candidate-card .exclusion{color:#18212b}</style>`;
  const atGlance = `${stateStyles}<section id="at-a-glance"><h2>At a glance</h2><p class="muted">Operational values describe each complete candidate run; they do not alter the controller-owned result.</p><p class="muted">Individual token and cost values may use different harness accounting semantics. Compare them across candidates only when the corresponding decision lens reports compatible evidence.</p><div class="table-scroll"><table class="summary-table"><thead><tr><th>Configuration</th><th>Result</th><th>Quality</th><th>Execution</th><th>Reported tokens</th><th>Provider cost</th><th>Tool calls</th><th>Retries</th><th>Interventions</th><th>Change</th></tr></thead><tbody>${atGlanceRows}</tbody></table></div></section>`;
  const cards = model.candidates.map((candidate) => {
    const result = resultFor(candidate), tokens = reportedTokens(candidate), exclusion = candidate.exclusions.length ? `<div class="exclusion"><h4>Deterministic exclusion</h4>${list(candidate.exclusions.map((gate) => `${gate.id} (${gate.status}): ${gate.reason}`))}</div>` : "";
    const technical = [
      ["Candidate ID", candidate.id], ["Opaque judge label", candidate.label], ["Adapter", candidate.configuration.adapter], ["Harness", candidate.configuration.harness], ["Provider", candidate.configuration.provider], ["Provider route", candidate.configuration.providerRoute], ["Model", candidate.configuration.model], ["Native reasoning effort", candidate.configuration.nativeReasoningEffort], ["Effective provider effort", candidate.configuration.effectiveProviderReasoningEffort], ["Native variant", candidate.configuration.nativeVariant], ["Legacy attention", candidate.configuration.attention], ["Agent", candidate.configuration.agent], ["Profile", candidate.configuration.profile], ["Permission policy", candidate.configuration.permissionPolicy], ["Declared tools/plugins", candidate.configuration.declaredToolsPlugins?.join(", ") || "None declared"], ["Reasoning evidence source", candidate.configuration.reasoningEvidenceSource], ["Source completion status", candidate.completionStatus]
    ].map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(configText(value))}</dd>`).join("");
    return `<article class="card candidate-card ${escapeHtml(result.toLowerCase())}"><h3>${escapeHtml(candidateDisplayName(candidate))}</h3><p class="candidate-status"><strong>${escapeHtml(result)}</strong> · ${escapeHtml(candidate.eligibility === "eligible" ? "Eligible" : "Excluded")} · ${escapeHtml(semanticQuality(candidate))}</p><p class="candidate-summary">${escapeHtml(formatDuration(metricNumber(candidate.metrics.wall_clock_ms)))} · ${escapeHtml(tokens === null ? notReported : `${formatCompactNumber(tokens)} reported tokens`)} · ${escapeHtml(formatRetryCount(candidate.metrics.retry_count))}</p><dl class="key-facts"><dt>Provider cost</dt><dd>${escapeHtml(formattedCost(candidate))}</dd><dt>Interventions</dt><dd>${escapeHtml(formatMetricValue("human_intervention_count", candidate.metrics.human_intervention_count, candidate.metrics))}</dd><dt>Change</dt><dd>${escapeHtml(formattedChange(candidate))}</dd></dl>${exclusion}<h4>Why</h4>${list(candidate.placement.why)}<h4>Why not</h4>${list(candidate.placement.why_not)}<h4>Semantic rationale</h4><p>${escapeHtml(candidate.rationale ?? "No accepted semantic ranking was available.")}</p><details><summary>Technical configuration</summary><dl>${technical}<dt>Configuration hash</dt><dd><code>${escapeHtml(candidate.configuration.configurationHash)}</code></dd></dl></details><details><summary>Strengths and risks</summary><h4>Strengths</h4>${list(candidate.strengths)}<h4>Risks</h4>${list(candidate.risks)}</details><details><summary>Validation</summary>${candidate.validation.map((command) => `<p><code>${escapeHtml(command.args.join(" "))}</code><br>${escapeHtml(command.status)} · ${escapeHtml(formatDuration(command.wallClockMs))} · exit ${escapeHtml(command.exitCode ?? "none")}${command.timeout ? " · timeout" : ""}</p>`).join("")}</details><details><summary>Evidence</summary>${linkList(candidate.evidence)}</details></article>`;
  }).join("");
  const gateRows = gates.map((id) => `<tr><th scope="row">${escapeHtml(id)}</th>${model.candidates.map((candidate) => { const item = candidate.gates.find((gate) => gate.id === id); return `<td class="${escapeHtml(item?.status ?? "unavailable")}"><strong>${escapeHtml(item?.status ?? "unavailable")}</strong><br><small>${escapeHtml(item?.reason ?? "Gate not recorded")}</small></td>`; }).join("")}</tr>`).join("");
  const telemetryRows = metricNames.map((name) => `<tr><th scope="row">${escapeHtml(metricLabel(name))}</th>${model.candidates.map((candidate) => `<td>${escapeHtml(formatMetricValue(name, candidate.metrics[name], candidate.metrics))}</td>`).join("")}</tr>`).join("");
  const coverageStatus = (status: CoverageStatus): string => status === "available_nonzero" ? "Available" : status === "established_zero" ? "Established zero" : "Not reported";
  const coverageRows = metricNames.map((name) => `<tr><th scope="row">${escapeHtml(metricLabel(name))}</th>${model.candidates.map((candidate) => { const cell = candidate.coverage.metrics[name] ?? { status: "unavailable" as const, source: "not recorded" }; return `<td class="${escapeHtml(cell.status)}"><strong>${escapeHtml(coverageStatus(cell.status))}</strong><br><small>Source: ${escapeHtml(valueText(cell.source))}</small></td>`; }).join("")}</tr>`).join("");
  const criteriaRows = semanticCriteria.map((criterion) => `<tr><th scope="row">${escapeHtml(criterion)}</th>${model.candidates.map((candidate) => `<td>${escapeHtml(candidate.criteria?.[criterion] ?? "Not reported by harness")}</td>`).join("")}</tr>`).join("");
  const reveals = model.candidates.map((candidate) => `<section><h3>${escapeHtml(candidate.label)} revealed as ${escapeHtml(candidateDisplayName(candidate))}</h3><p>${escapeHtml(candidate.rationale ?? "No accepted semantic ranking was available.")}</p>${list(candidate.strengths)}${list(candidate.risks)}</section>`).join("");
  const duplicates = model.topology.duplicate_configuration_groups.length ? model.topology.duplicate_configuration_groups.map((group) => group.join(", ")).join("; ") : "none";
  const pairs = model.topology.multi_variable_pairs.length ? model.topology.multi_variable_pairs.map((pair) => `${pair.candidates.join(" vs ")} (${pair.differing_dimensions.join(", ")})`).join("; ") : "none";
  const topology = `<section><h2>Comparison topology</h2><p>Held constant: ${escapeHtml(model.topology.held_constant_dimensions.join(", ") || "none")}</p><p>Varied: ${escapeHtml(model.topology.varied_dimensions.map((item) => item.dimension).join(", ") || "none")}</p><p>Controlled sweeps: ${escapeHtml(model.topology.controlled_sweeps.map((group) => `${group.dimension} (${group.candidates.join(", ")})`).join("; ") || "none")}</p><h3>Exact duplicate groups</h3><p>${escapeHtml(duplicates)}</p><h3>Multi-variable comparison examples</h3><p>${escapeHtml(pairs)}${model.topology.multi_variable_pairs_truncated ? ` (examples truncated after ${model.topology.multi_variable_pairs.length})` : ""}</p><h3>Supported structural claims</h3>${list(model.topology.supported_structural_claims)}<h3>Unsupported causal claims</h3>${list(model.topology.unsupported_causal_claims)}</section>`;
  const speedDifference = recommendedSpeedDifference(model.candidates, model.recommendedCandidate, model.decisionLenses);
  const lenses = `<section><h2>Decision summary</h2><p>The overall recommendation combines accepted semantic judgment with deterministic eligibility. Operational lenses are informational only and never change controller ordering.</p><div class="lens-grid">${model.decisionLenses.map((lens) => {
    if (lens.id === "telemetry_coverage") return `<article class="lens-card"><h3>${escapeHtml(lens.label)}</h3>${model.candidates.map((candidate) => `<p><strong>${escapeHtml(candidateDisplayName(candidate))}</strong><br>${escapeHtml(lensValue(lens, candidate))}</p>`).join("")}<small>${escapeHtml(lensReason(lens))}</small></article>`;
    if (lens.status === "not_comparable" || lens.status === "not_applicable") return `<article class="lens-card"><h3>${escapeHtml(lens.label)}</h3><p><strong>${escapeHtml(lens.status === "not_comparable" ? "Not comparable" : "Not applicable")}</strong></p><small>${escapeHtml(lensReason(lens))}</small></article>`;
    const selected = lens.candidateIds.map(byId).filter((candidate): candidate is ReportCandidate => Boolean(candidate));
    return `<article class="lens-card"><h3>${escapeHtml(lens.label)}</h3>${selected.map((candidate) => `<p><strong>${escapeHtml(candidateDisplayName(candidate))}</strong><br>${escapeHtml(lensValue(lens, candidate))}</p>`).join("")}${lens.id === "controller_recommendation" && speedDifference ? `<p class="muted">${escapeHtml(speedDifference)}</p>` : ""}<small>${escapeHtml(lensReason(lens))}</small></article>`;
  }).join("")}</div></section>`;
  const sampleNotice = model.sampleMetadata ? `<section><h2>Sanitized derivative sample</h2><p>This report is a sanitized derivative sample. Evidence completeness applies to the source run; omitted source artifacts: ${escapeHtml(model.sampleMetadata.omittedArtifacts.join(", "))}.</p><p>${escapeHtml(model.sampleMetadata.retainedResults)} Historical source execution classifications below are retained as evidence; the accepted controller outcome remains authoritative.</p></section>` : "";
  const limitations = [...model.limitations, ...model.sourceExecutionLimitations];
  const candidateHeaders = model.candidates.map((candidate) => `<th>${escapeHtml(candidateDisplayName(candidate))}</th>`).join("");
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arena report — ${escapeHtml(model.trialId)}</title><style>:root{color-scheme:light}body{font:16px/1.5 system-ui,sans-serif;color:#18212b;background:#f5f7fa;margin:0}main{max-width:1240px;margin:auto;padding:2rem}header,.card,section{background:#fff;border:1px solid #d8dee7;border-radius:.7rem;padding:1rem;margin:1rem 0}.banner{border-left:.55rem solid #276749}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:1rem}.cards .card{margin:0}.candidate-card.recommended{border-top:.4rem solid #276749}.candidate-card.tied{border-top:.4rem solid #2b6cb0}.candidate-card.excluded,.summary-table tr.excluded{background:#fff5f5}.candidate-status,.candidate-summary{margin:.35rem 0}.candidate-summary{font-weight:600}.key-facts{padding:.65rem;background:#f7fafc;border-radius:.4rem}.exclusion{border-left:.35rem solid #c53030;padding:.1rem .8rem;background:#fff5f5}.lens-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:.75rem}.lens-card{margin:0;background:#f8fafc}.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;background:#fff}th,td{border:1px solid #d8dee7;padding:.55rem;text-align:left;vertical-align:top}th{background:#edf2f7}.summary-table th:first-child{min-width:14rem}.summary-table tr.recommended{box-shadow:inset .35rem 0 #276749}.summary-table tr.tied{box-shadow:inset .35rem 0 #2b6cb0}.passed,.available_nonzero{background:#e6ffed}.failed{background:#ffe6e6}.unavailable{background:#fff8d6}.established_zero{background:#edf2f7}dl{display:grid;grid-template-columns:minmax(9rem,max-content) 1fr;gap:.25rem 1rem}dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}details{margin-top:.75rem}summary{cursor:pointer;font-weight:700}code{overflow-wrap:anywhere}a{color:#1255a5}small,.muted{color:#4a5568}@media(max-width:700px){main{padding:.75rem}.cards{display:block}.candidate-card{margin:1rem 0}dl{grid-template-columns:1fr}}@media print{body{background:#fff}main{max-width:none;padding:0}header,.card,section{break-inside:avoid;box-shadow:none}.table-scroll{overflow:visible}a{color:inherit}}</style></head><body><main><header class="banner"><p>Arena static product report</p><h1>${escapeHtml(model.outcome)}</h1><p><strong>${escapeHtml(outcomeDetail)}</strong></p>${model.summary ? `<p>${escapeHtml(model.summary)}</p>` : ""}${model.confidence ? `<p>Accepted semantic confidence: ${escapeHtml(model.confidence)}</p>` : ""}</header>${sampleNotice}${atGlance}<section><h2>Task and comparison</h2><p>${escapeHtml(model.objective)}</p><p>Trial <code>${escapeHtml(model.trialId)}</code> · run <code>${escapeHtml(model.runId)}</code> · ${escapeHtml(model.comparisonMode)}</p><p>Arena pipeline: ${escapeHtml(formatDuration(model.runPipelineMs))}</p><details><summary>Configured validation commands</summary>${list(model.validationCommands.map((command) => command.join(" ")))}</details><p class="muted">${escapeHtml(model.noncausalStatement)}</p></section>${topology}${lenses}<h2>Complete candidate order</h2><div class="cards">${cards}</div><section><h2>Hard-gate matrix</h2><div class="table-scroll"><table><thead><tr><th>Gate</th>${candidateHeaders}</tr></thead><tbody>${gateRows}</tbody></table></div></section><section><h2>Semantic criteria</h2><div class="table-scroll"><table><thead><tr><th>Criterion</th>${candidateHeaders}</tr></thead><tbody>${criteriaRows}</tbody></table></div></section><section><h2>Telemetry</h2><p>Arena reports normalized per-candidate execution telemetry. Harnesses may expose different fields and accounting semantics; unavailable data is never treated as zero.</p><p>Candidate duration includes the harness run and tool activity. It is not provider API request latency. Candidate execution, independent validation, and Arena pipeline durations remain separate.</p><div class="table-scroll"><table><thead><tr><th>Metric</th>${candidateHeaders}</tr></thead><tbody>${telemetryRows}</tbody></table></div></section><section><h2>Telemetry coverage</h2><p>Coverage is informational and does not measure coding-result quality.</p><p>${model.candidates.map((candidate) => `${escapeHtml(candidateDisplayName(candidate))}: ${candidate.coverage.available} available, ${candidate.coverage.unavailable} unavailable`).join(" · ")}</p><div class="table-scroll"><table><thead><tr><th>Metric</th>${candidateHeaders}</tr></thead><tbody>${coverageRows}</tbody></table></div></section><section><h2>Identity-masked semantic findings and reveal</h2>${reveals}</section><section><h2>Evidence limitations</h2><p>Judge source execution: ${escapeHtml(model.judgeExecution.status)}${model.judgeExecution.failureClassification ? ` · original failure classification: ${escapeHtml(model.judgeExecution.failureClassification)}` : ""}</p>${list(limitations, "No accepted limitations were reported.")}</section><section><h2>Portable evidence</h2>${linkList(model.rootEvidence)}</section><section><h2>Development provenance</h2><p><a href="https://github.com/CowOfSteel/agentworkbench-arena/blob/main/docs/CODEX-DEVELOPMENT.md">Codex development provenance</a> records the human-owned decisions and submission-provenance blocker.</p></section><section><h2>Configuration comparison boundary</h2><p>${escapeHtml(model.noncausalStatement)}</p></section></main></body></html>\n`;
}

export function renderRecommendationYaml(model: ReportModel): string {
  return stringifyYaml(recommendationDto(model), { lineWidth: 0, aliasDuplicateObjects: false });
}

async function atomicWrite(path: string, value: string): Promise<void> {
  const temporary = join(dirname(path), `.${path.split(/[\\/]/).at(-1)}.${process.pid}.tmp`);
  try { await writeFile(temporary, value, "utf8"); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

export async function generateReport(runDirectory: string): Promise<{ directory: string; report: "report.html"; recommendation: "recommendation.yml" }> {
  const run = await loadCompletedRun(runDirectory), model = buildReportModel(run);
  await Promise.all([atomicWrite(join(run.directory, "report.html"), renderReportHtml(model)), atomicWrite(join(run.directory, "recommendation.yml"), renderRecommendationYaml(model))]);
  return { directory: run.directory, report: "report.html", recommendation: "recommendation.yml" };
}

export interface VerificationResult { status: "VERIFIED" | "FAILED"; run_directory: string; sample_metadata: "sanitized_derivative" | "none" | "unavailable"; checks: Array<{ id: string; status: "passed" | "failed"; reason: string }>; }
export async function verifyReport(runDirectory: string): Promise<VerificationResult> {
  const requested = resolve(runDirectory); const checks: VerificationResult["checks"] = [];
  try {
    const run = await loadCompletedRun(requested), model = buildReportModel(run); checks.push({ id: "source_artifacts", status: "passed", reason: "Completed-run structure, confinement, and authority checks passed." });
    const expectedHtml = renderReportHtml(model), expectedYaml = renderRecommendationYaml(model);
    const html = await artifact(run.directory, "report.html").catch(() => null), yaml = await artifact(run.directory, "recommendation.yml").catch(() => null);
    checks.push({ id: "report_html", status: html === expectedHtml ? "passed" : "failed", reason: html === expectedHtml ? "report.html is current." : html === null ? "report.html is missing or unsafe." : "report.html is stale." });
    checks.push({ id: "recommendation_yaml", status: yaml === expectedYaml ? "passed" : "failed", reason: yaml === expectedYaml ? "recommendation.yml is current." : yaml === null ? "recommendation.yml is missing or unsafe." : "recommendation.yml is stale." });
    return { status: checks.every((check) => check.status === "passed") ? "VERIFIED" : "FAILED", run_directory: run.directory, sample_metadata: run.sampleMetadata ? "sanitized_derivative" : "none", checks };
  } catch (error) { checks.push({ id: "source_artifacts", status: "failed", reason: error instanceof Error ? error.message : "verification failed" }); return { status: "FAILED", run_directory: requested, sample_metadata: "unavailable", checks }; }
}
