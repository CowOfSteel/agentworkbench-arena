import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { stringify as stringifyYaml } from "yaml";

type JsonObject = Record<string, any>;
export type Outcome = "RECOMMENDATION" | "TIE" | "NO_WINNER" | "INCONCLUSIVE";
export interface ReportMetric { value: unknown; availability: "available" | "unavailable"; source: unknown; }
export interface ReportGate { id: string; status: "passed" | "failed" | "unavailable"; reason: string; }
export type SemanticCriterion = "acceptance_coverage" | "maintainability" | "architecture_fit" | "regression_risk" | "unnecessary_complexity" | "evidence_quality";
export type SemanticOrdinal = "strong" | "adequate" | "weak" | "insufficient_evidence";
export type SemanticCriteria = Record<SemanticCriterion, SemanticOrdinal>;
export interface ReportCandidate {
  id: string; label: string; eligibility: "eligible" | "excluded"; hardGateStatus: string; semanticRank: number | null; semanticTier: string | null;
  configuration: { adapter: string | null; harness: string | null; provider: string | null; model: string | null; attention: string | null; agent: string | null; profile: string | null; configurationHash: string; };
  gates: ReportGate[]; exclusions: ReportGate[]; rationale: string | null; strengths: string[]; risks: string[]; validation: Array<{ args: string[]; status: string; wallClockMs: number; exitCode: number | null; timeout: boolean; failureClassification: string | null; }>;
  criteria: SemanticCriteria | null; completionStatus: string; metrics: Record<string, ReportMetric>; evidence: string[];
}
export interface ReportModel {
  schemaVersion: "1.0"; runId: string; trialId: string; evaluationSchemaVersion: string; comparisonMode: string; objective: string; validationCommands: string[][];
  outcome: Outcome; recommendedCandidate: string | null; tiedCandidates: string[]; confidence: string | null; summary: string | null; limitations: string[];
  runPipelineMs: number; candidates: ReportCandidate[]; rootEvidence: string[]; noncausalStatement: string;
  judgeExecution: { status: string; failureClassification: string | null; }; sourceExecutionLimitations: string[];
  sampleMetadata: { schemaVersion: "1.0"; kind: "sanitized_derivative"; evidenceCompletenessScope: string; omittedArtifacts: string[]; retainedResults: string; } | null;
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
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const object = (value: unknown, label: string): JsonObject => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as JsonObject; };
const array = (value: unknown, label: string): any[] => { if (!Array.isArray(value)) throw new Error(`${label} must be an array`); return value; };
const text = (value: unknown, label: string): string => { if (typeof value !== "string" || !value) throw new Error(`${label} must be a nonempty string`); return value; };
const nullableText = (value: unknown, label: string): string | null => { if (value === null) return null; return text(value, label); };
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
    for (const name of ["wall_clock_ms", "validation_wall_clock_ms", "total_pipeline_ms", "tool_call_count", "command_count", "retry_count", "human_intervention_count"]) metrics[name] = sourceMetric(execution, name);
    for (const name of ["input_tokens", "cached_input_tokens", "uncached_input_tokens", "output_tokens", "provider_reported_cost", "provider_reported_currency", "estimated_cost", "estimated_cost_currency", "subscription_consumption", "quota_percent_before", "quota_percent_after"]) metrics[name] = sourceMetric(usage, name);
    for (const name of ["permission_denials", "user_questions", "manual_prompt_corrections", "manual_file_edits", "aborts", "transport_retries"]) metrics[name] = sourceMetric(intervention, name);
    for (const name of ["files_changed", "lines_added", "lines_deleted", "validation_pass_count", "validation_fail_count"]) metrics[name] = sourceMetric(output, name);
    const validation = array(candidate.validation.commands, "validation commands").map((raw) => { const item = object(raw, "validation command"); return { args: array(item.args, "validation args").map((arg) => text(arg, "validation arg")), status: text(item.status, "validation status"), wallClockMs: Number(item.wall_clock_ms), exitCode: item.exit_code === null ? null : Number(item.exit_code), timeout: Boolean(item.timeout), failureClassification: item.failure_classification === null ? null : text(item.failure_classification, "failure classification") }; });
    const gates = array(telemetry.hard_gates, "hard gates").map(gate), exclusions = array(evaluated.exclusion_gates, "exclusions").map(gate);
    return {
      id: text(evaluated.candidate_id, "candidate id"), label, eligibility: evaluated.eligibility, hardGateStatus: text(evaluated.hard_gate_status, "hard-gate status"), semanticRank: evaluated.semantic_rank === null ? null : Number(evaluated.semantic_rank), semanticTier: evaluated.semantic_tier === null ? null : text(evaluated.semantic_tier, "semantic tier"),
      configuration: { adapter: nullableText(provenance.adapter, "adapter"), harness: nullableText(provenance.harness, "harness"), provider: nullableText(provenance.provider, "provider"), model: nullableText(provenance.model, "model"), attention: nullableText(provenance.attention, "attention"), agent: nullableText(provenance.agent, "agent"), profile: nullableText(provenance.profile, "profile"), configurationHash: text(candidate.manifest.configuration_hash, "configuration hash") },
      gates, exclusions, rationale: rank ? text(rank.rationale, "semantic rationale") : null, strengths: array(strengths[label] ?? [], "strengths").map((item) => text(item, "strength")), risks: array(risks[label] ?? [], "risks").map((item) => text(item, "risk")), criteria: verdict ? criteria[label] : null, completionStatus: text(candidate.manifest.completion_status, "candidate completion status"), validation, metrics,
      evidence: candidateArtifacts.map((name) => `${candidate.directory}/${name}`)
    };
  });
  const original = run.judgeResult.original === null ? null : object(run.judgeResult.original, "judge original execution");
  const judgeFailureClassification = original?.failure_classification === undefined ? null : nullableText(original.failure_classification, "judge failure classification");
  const sourceExecutionLimitations = [
    ...candidates.filter((candidate) => candidate.completionStatus !== "completed").map((candidate) => `${run.sampleMetadata ? "Historical" : "Recorded"} source completion status for ${candidate.label}: ${candidate.completionStatus}.`),
    ...(judgeFailureClassification ? [`${run.sampleMetadata ? "Historical" : "Recorded"} judge original failure classification: ${judgeFailureClassification}.`] : [])
  ];
  return {
    schemaVersion: "1.0", runId: text(run.manifest.run_id, "run id"), trialId: text(run.manifest.trial_id, "trial id"), evaluationSchemaVersion: text(run.evaluation.schema_version, "evaluation schema"), comparisonMode: text(run.manifest.comparison_mode, "comparison mode"), objective: text(run.taskContract.objective, "task objective"), validationCommands: array(run.taskContract.validation_commands, "task validation commands").map((command) => array(command, "validation command").map((arg) => text(arg, "validation argument"))),
    outcome: run.evaluation.outcome, recommendedCandidate: run.evaluation.recommended_candidate_id, tiedCandidates: run.evaluation.tied_candidate_ids, confidence: verdict ? text(verdict.confidence, "confidence") : null, summary: verdict ? text(verdict.summary, "semantic summary") : null, limitations: verdict ? array(verdict.limitations, "limitations").map((item) => text(item, "limitation")) : run.judgeResult.error ? [String(run.judgeResult.error)] : [],
    runPipelineMs: Number(run.manifest.total_pipeline_ms), candidates, rootEvidence: [...rootArtifacts, ...(run.sampleMetadata ? ["sample-metadata.json"] : [])], noncausalStatement,
    judgeExecution: { status: text(run.judgeResult.status, "judge status"), failureClassification: judgeFailureClassification }, sourceExecutionLimitations, sampleMetadata: run.sampleMetadata
  };
}

const escapeHtml = (value: unknown): string => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const valueText = (value: unknown): string => typeof value === "object" ? JSON.stringify(value) : String(value);
const metricText = (value: ReportMetric): string => value.availability === "unavailable" ? "Not reported by harness" : valueText(value.value);
const configText = (value: string | null): string => value ?? "Not reported by harness";
const link = (path: string): string => `<a href="${path.split('/').map(encodeURIComponent).join('/')}">${escapeHtml(path)}</a>`;
const list = (items: string[], empty = "None reported"): string => items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p>${escapeHtml(empty)}</p>`;
const linkList = (items: string[]): string => `<ul>${items.map((item) => `<li>${link(item)}</li>`).join("")}</ul>`;

export function renderReportHtml(model: ReportModel): string {
  const gates = [...new Set(model.candidates.flatMap((candidate) => candidate.gates.map((item) => item.id)))];
  const metricNames = ["wall_clock_ms", "validation_wall_clock_ms", "total_pipeline_ms", "input_tokens", "cached_input_tokens", "uncached_input_tokens", "output_tokens", "provider_reported_cost", "provider_reported_currency", "estimated_cost", "estimated_cost_currency", "subscription_consumption", "tool_call_count", "command_count", "retry_count", "human_intervention_count", "permission_denials", "user_questions", "manual_prompt_corrections", "manual_file_edits", "aborts", "transport_retries", "validation_pass_count", "validation_fail_count", "files_changed", "lines_added", "lines_deleted"];
  const outcomeDetail = model.outcome === "RECOMMENDATION" ? `Recommended: ${model.recommendedCandidate}` : model.outcome === "TIE" ? `Tied: ${model.tiedCandidates.join(", ")}` : model.outcome === "NO_WINNER" ? "No candidate was eligible" : "No conclusive recommendation";
  const cards = model.candidates.map((candidate) => `<article class="card"><h3>${escapeHtml(candidate.label)} → ${escapeHtml(candidate.id)}</h3><p><strong>${escapeHtml(candidate.eligibility)}</strong> · hard gates: ${escapeHtml(candidate.hardGateStatus)}${candidate.semanticRank === null ? "" : ` · semantic rank ${candidate.semanticRank} (${escapeHtml(candidate.semanticTier)})`}</p><p class="muted">Source completion status: ${escapeHtml(candidate.completionStatus)}</p><dl><dt>Harness</dt><dd>${escapeHtml(configText(candidate.configuration.harness))}</dd><dt>Provider</dt><dd>${escapeHtml(configText(candidate.configuration.provider))}</dd><dt>Model</dt><dd>${escapeHtml(configText(candidate.configuration.model))}</dd><dt>Attention / variant</dt><dd>${escapeHtml(configText(candidate.configuration.attention))}</dd><dt>Adapter</dt><dd>${escapeHtml(configText(candidate.configuration.adapter))}</dd><dt>Agent</dt><dd>${escapeHtml(configText(candidate.configuration.agent))}</dd><dt>Profile</dt><dd>${escapeHtml(configText(candidate.configuration.profile))}</dd><dt>Configuration hash</dt><dd><code>${escapeHtml(candidate.configuration.configurationHash)}</code></dd></dl><h4>Semantic rationale</h4><p>${escapeHtml(candidate.rationale ?? "No accepted semantic ranking was available.")}</p><details><summary>Strengths and risks</summary><h4>Strengths</h4>${list(candidate.strengths)}<h4>Risks</h4>${list(candidate.risks)}</details><details><summary>Validation</summary>${candidate.validation.map((command) => `<p><code>${escapeHtml(command.args.join(" "))}</code><br>${escapeHtml(command.status)} · ${command.wallClockMs} ms · exit ${escapeHtml(command.exitCode ?? "none")}${command.timeout ? " · timeout" : ""}</p>`).join("")}</details><details><summary>Evidence</summary>${linkList(candidate.evidence)}</details></article>`).join("");
  const gateRows = gates.map((id) => `<tr><th scope="row">${escapeHtml(id)}</th>${model.candidates.map((candidate) => { const item = candidate.gates.find((gate) => gate.id === id); return `<td class="${escapeHtml(item?.status ?? "unavailable")}"><strong>${escapeHtml(item?.status ?? "unavailable")}</strong><br><small>${escapeHtml(item?.reason ?? "Gate not recorded")}</small></td>`; }).join("")}</tr>`).join("");
  const telemetryRows = metricNames.map((name) => `<tr><th scope="row">${escapeHtml(name)}</th>${model.candidates.map((candidate) => `<td>${escapeHtml(metricText(candidate.metrics[name]))}</td>`).join("")}</tr>`).join("");
  const criteriaRows = semanticCriteria.map((criterion) => `<tr><th scope="row">${escapeHtml(criterion)}</th>${model.candidates.map((candidate) => `<td>${escapeHtml(candidate.criteria?.[criterion] ?? "Not reported by harness")}</td>`).join("")}</tr>`).join("");
  const reveals = model.candidates.map((candidate) => `<section><h3>${escapeHtml(candidate.label)} revealed as ${escapeHtml(candidate.id)}</h3><p>${escapeHtml(candidate.rationale ?? "No accepted semantic ranking was available.")}</p>${list(candidate.strengths)}${list(candidate.risks)}</section>`).join("");
  const sampleNotice = model.sampleMetadata ? `<section><h2>Sanitized derivative sample</h2><p>This report is a sanitized derivative sample. Evidence completeness applies to the source run; omitted source artifacts: ${escapeHtml(model.sampleMetadata.omittedArtifacts.join(", "))}.</p><p>${escapeHtml(model.sampleMetadata.retainedResults)} Historical source execution classifications below are retained as evidence; the accepted controller outcome remains authoritative.</p></section>` : "";
  const limitations = [...model.limitations, ...model.sourceExecutionLimitations];
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arena report — ${escapeHtml(model.trialId)}</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#18212b;background:#f5f7fa;margin:0}main{max-width:1200px;margin:auto;padding:2rem}header,.card,section{background:white;border:1px solid #d8dee7;border-radius:.7rem;padding:1rem;margin:1rem 0}.banner{border-left:.55rem solid #276749}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1rem}.cards .card{margin:0}.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;background:white}th,td{border:1px solid #d8dee7;padding:.55rem;text-align:left;vertical-align:top}th{background:#edf2f7}.passed{background:#e6ffed}.failed{background:#ffe6e6}.unavailable{background:#fff8d6}dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem}dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}code{overflow-wrap:anywhere}a{color:#1255a5}small{color:#4a5568}.muted{color:#4a5568}</style></head><body><main><header class="banner"><p>Arena static product report</p><h1>${escapeHtml(model.outcome)}</h1><p><strong>${escapeHtml(outcomeDetail)}</strong></p>${model.summary ? `<p>${escapeHtml(model.summary)}</p>` : ""}${model.confidence ? `<p>Accepted semantic confidence: ${escapeHtml(model.confidence)}</p>` : ""}</header>${sampleNotice}<section><h2>Task and comparison</h2><p>${escapeHtml(model.objective)}</p><p>Trial <code>${escapeHtml(model.trialId)}</code> · run <code>${escapeHtml(model.runId)}</code> · ${escapeHtml(model.comparisonMode)}</p><p>Run pipeline: ${escapeHtml(model.runPipelineMs)} ms</p><details><summary>Configured validation commands</summary>${list(model.validationCommands.map((command) => command.join(" ")))}</details><p class="muted">${escapeHtml(model.noncausalStatement)}</p></section><h2>Complete candidate order</h2><div class="cards">${cards}</div><section><h2>Hard-gate matrix</h2><div class="table-scroll"><table><thead><tr><th>Gate</th>${model.candidates.map((candidate) => `<th>${escapeHtml(candidate.id)}</th>`).join("")}</tr></thead><tbody>${gateRows}</tbody></table></div></section><section><h2>Semantic criteria</h2><div class="table-scroll"><table><thead><tr><th>Criterion</th>${model.candidates.map((candidate) => `<th>${escapeHtml(candidate.id)}</th>`).join("")}</tr></thead><tbody>${criteriaRows}</tbody></table></div></section><section><h2>Telemetry</h2><p>Candidate execution, independent validation, and candidate pipeline durations remain separate.</p><div class="table-scroll"><table><thead><tr><th>Metric</th>${model.candidates.map((candidate) => `<th>${escapeHtml(candidate.id)}</th>`).join("")}</tr></thead><tbody>${telemetryRows}</tbody></table></div></section><section><h2>Identity-masked semantic findings and reveal</h2>${reveals}</section><section><h2>Evidence limitations</h2><p>Judge source execution: ${escapeHtml(model.judgeExecution.status)}${model.judgeExecution.failureClassification ? ` · original failure classification: ${escapeHtml(model.judgeExecution.failureClassification)}` : ""}</p>${list(limitations, "No accepted limitations were reported.")}</section><section><h2>Portable evidence</h2>${linkList(model.rootEvidence)}</section><section><h2>Configuration comparison boundary</h2><p>${escapeHtml(model.noncausalStatement)}</p></section></main></body></html>\n`;
}

export function renderRecommendationYaml(model: ReportModel): string {
  const document = {
    schema_version: model.schemaVersion,
    source: { run_id: model.runId, trial_id: model.trialId, evaluation_schema_version: model.evaluationSchemaVersion, comparison_mode: model.comparisonMode },
    outcome: model.outcome, recommended_candidate: model.recommendedCandidate, tied_candidates: model.tiedCandidates, confidence: model.confidence, routing_applied: false,
    ranking: model.candidates.map((candidate) => ({ candidate_id: candidate.id, opaque_label: candidate.label, eligibility: candidate.eligibility, hard_gate_status: candidate.hardGateStatus, source_completion_status: candidate.completionStatus, semantic_rank: candidate.semanticRank, semantic_tier: candidate.semanticTier, semantic_criteria: candidate.criteria, exclusion_reasons: candidate.exclusions.map((item) => ({ gate_id: item.id, status: item.status, reason: item.reason })), reasons: candidate.eligibility === "eligible" ? [candidate.rationale, ...candidate.strengths].filter(Boolean) : candidate.exclusions.map((item) => `${item.id}: ${item.reason}`), tradeoffs: candidate.risks, evidence_references: ["evaluation.json", "adjudication.json", ...candidate.evidence] })),
    judge_execution: model.judgeExecution, source_execution_limitations: model.sourceExecutionLimitations, evidence_references: model.rootEvidence, noncausal_statement: model.noncausalStatement,
    ...(model.sampleMetadata ? { sample_metadata: { schema_version: model.sampleMetadata.schemaVersion, kind: model.sampleMetadata.kind, evidence_completeness_scope: model.sampleMetadata.evidenceCompletenessScope, omitted_artifacts: model.sampleMetadata.omittedArtifacts, retained_results: model.sampleMetadata.retainedResults } } : {})
  };
  return stringifyYaml(document, { lineWidth: 0 });
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
