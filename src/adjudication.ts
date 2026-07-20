import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { CandidateExecution, CodexExecAdapter, DoctorResult, resolveCodexExecutable, runProcess } from "./adapters";
import { phase3PacketReady } from "./runner";

export const judgeSchemaVersion = "3.0";
export type ReasoningEffort = "low" | "high";
export type JudgeVerdict = "RECOMMENDATION" | "TIE" | "INCONCLUSIVE";
export type EvaluationOutcome = JudgeVerdict | "NO_WINNER";
export interface JudgeConfig { model: "gpt-5.6-sol"; reasoning_effort: ReasoningEffort; timeout_ms: number; }
export const defaultJudgeConfig: JudgeConfig = { model: "gpt-5.6-sol", reasoning_effort: "low", timeout_ms: 120_000 };
export interface JudgeRequest { staging_directory: string; packet: unknown; schema: unknown; prompt: string; config: JudgeConfig; }
export interface JudgeExecution { started_at: string; completed_at: string; wall_clock_ms: number; exit_code: number | null; timeout: boolean; stdout: string; stderr: string; response_text: string; launch_error: string | null; failure_classification: string | null; args: string[]; }
export interface JudgeAdapter { doctor(config: JudgeConfig): Promise<DoctorResult>; adjudicate(request: JudgeRequest): Promise<JudgeExecution>; }

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface CandidatePacket { id: string; label: string; telemetry: Record<string, unknown>; validation: Record<string, unknown>; diff: string; }
interface LoadedRun { directory: string; manifest: Record<string, unknown>; snapshot: Record<string, unknown>; candidates: CandidatePacket[]; }

const portable = (value: unknown): value is string => typeof value === "string" && value.length > 0 && !/^(?:[A-Za-z]:)?[\\/]/.test(value) && !value.split(/[\\/]/).includes("..");
const object = (value: unknown, label: string): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as Record<string, unknown>; };
const array = (value: unknown, label: string): unknown[] => { if (!Array.isArray(value)) throw new Error(`${label} must be an array`); return value; };
const text = (value: unknown, label: string): string => { if (typeof value !== "string") throw new Error(`${label} must be a string`); return value; };
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const labelAt = (index: number): string => { let value = index + 1; let label = ""; while (value > 0) { value--; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26); } return label; };
const metricValue = (value: unknown): Json => object(value, "metric").value as Json;
const truncate = (value: string, limit: number): { text: string; truncated: boolean } => value.length <= limit ? { text: value, truncated: false } : { text: `${value.slice(0, Math.max(0, limit - 16))}\n<truncated>`, truncated: true };
const json = (value: unknown): string => JSON.stringify(value, null, 2);
// Candidate diffs can contain absolute worktree paths in Git's no-index headers. Keep only content/hunk lines.
const judgeDiff = (value: string): string => value.split(/\r?\n/).filter((line) => !/^(diff --git |index |--- |\+\+\+ |new file mode |deleted file mode )/.test(line)).join("\n");

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, typeof value === "string" ? value : json(value));
  await rename(temporary, path);
}

function ensureNoLeak(value: unknown, forbidden: string[], label = "judge packet"): void {
  if (typeof value === "string") {
    if (/^(?:[A-Za-z]:)?[\\/]/.test(value)) throw new Error(`${label} contains a local path at ${label}`);
    if (forbidden.some((item) => item && value.includes(item))) throw new Error(`${label} contains candidate identity at ${label}`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((item, index) => ensureNoLeak(item, forbidden, `${label}[${index}]`));
  if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => ensureNoLeak(item, forbidden, `${label}.${key}`));
}

async function readJson(path: string): Promise<Record<string, unknown>> { return object(JSON.parse(await readFile(path, "utf8")), path); }

export async function loadPhase2Run(runDirectory: string): Promise<LoadedRun> {
  const directory = resolve(runDirectory);
  const [manifest, snapshot] = await Promise.all([readJson(join(directory, "manifest.json")), readJson(join(directory, "trial-snapshot.json"))]);
  if (manifest.manifest_finalization_status !== "complete" || manifest.phase_3_readiness !== "ready_for_audit") throw new Error("run is not finalized for Phase 3 audit");
  const candidates = array(manifest.candidates, "manifest candidates");
  if (typeof manifest.candidate_count !== "number" || manifest.candidate_count !== candidates.length) throw new Error("manifest candidate count mismatch");
  if (hash(JSON.stringify(snapshot)) !== manifest.normalized_trial_snapshot_hash) throw new Error("trial snapshot hash mismatch");
  if (snapshot.task_contract_hash !== manifest.task_contract_hash) throw new Error("task contract hash mismatch");
  const expectedDirectories = new Set<string>();
  const loaded: CandidatePacket[] = [];
  for (const item of candidates) {
    const candidate = object(item, "manifest candidate");
    const id = text(candidate.candidate_id, "candidate id");
    const artifactDirectory = text(candidate.artifact_directory, "artifact directory");
    if (!portable(artifactDirectory) || artifactDirectory !== `candidates/${id}` || expectedDirectories.has(artifactDirectory)) throw new Error("invalid or duplicate candidate artifact directory");
    expectedDirectories.add(artifactDirectory);
    const absolute = resolve(directory, artifactDirectory);
    if (relative(directory, absolute).startsWith("..") || !absolute.startsWith(`${directory}${sep}`)) throw new Error("candidate artifact path escapes run directory");
    const [telemetry, validation, diff] = await Promise.all([readJson(join(absolute, "telemetry.json")), readJson(join(absolute, "validation.json")), readFile(join(absolute, "candidate.diff"), "utf8")]);
    if (!phase3PacketReady({ telemetry, validation, artifactDirectory })) throw new Error(`candidate ${id} is not Phase 3 packet ready`);
    const provenance = object(telemetry.provenance, "telemetry provenance");
    if (provenance.candidate_id !== id || provenance.task_contract_hash !== manifest.task_contract_hash || provenance.configuration_hash !== candidate.configuration_hash) throw new Error(`candidate ${id} provenance mismatch`);
    loaded.push({ id, label: "", telemetry, validation, diff });
  }
  const actualDirectories = new Set((await readdir(join(directory, "candidates"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => `candidates/${entry.name}`));
  if (actualDirectories.size !== expectedDirectories.size || [...actualDirectories].some((entry) => !expectedDirectories.has(entry))) throw new Error("unexpected candidate artifacts");
  return { directory, manifest, snapshot, candidates: loaded };
}

function maskedCandidates(run: LoadedRun): CandidatePacket[] {
  const seed = `${judgeSchemaVersion}:${run.manifest.run_id}:${run.manifest.trial_id}:${run.manifest.task_contract_hash}:${run.manifest.normalized_trial_snapshot_hash}`;
  return [...run.candidates].sort((left, right) => hash(`${seed}:${left.id}`).localeCompare(hash(`${seed}:${right.id}`))).map((candidate, index) => ({ ...candidate, label: labelAt(index) }));
}

function candidateInput(candidate: CandidatePacket, excerptLimit: number): Record<string, Json> {
  const telemetry = candidate.telemetry;
  const output = object(telemetry.output, "telemetry output");
  const execution = object(telemetry.execution, "telemetry execution");
  const changes = object(telemetry.change_analysis, "change analysis");
  const commands = array(candidate.validation.commands, "validation commands");
  const commandLimit = Math.max(128, Math.floor(excerptLimit / Math.max(1, commands.length * 2)));
  const validation = commands.map((item) => {
    const command = object(item, "validation command");
    const stdout = truncate(String(command.stdout ?? ""), commandLimit);
    const stderr = truncate(String(command.stderr ?? ""), commandLimit);
    return { status: command.status as Json, exit_code: command.exit_code as Json, timeout: command.timeout as Json, failure_classification: command.failure_classification as Json, stdout_excerpt: stdout.text, stderr_excerpt: stderr.text, truncated: stdout.truncated || stderr.truncated };
  });
  const diff = truncate(judgeDiff(candidate.diff), excerptLimit * 2);
  const gates = array(telemetry.hard_gates, "hard gates").map((item) => { const gate = object(item, "hard gate"); return { id: gate.id as Json, status: gate.status as Json, reason: gate.reason as Json }; });
  return {
    label: candidate.label,
    hard_gates: gates,
    deterministic_facts: {
      files_changed: metricValue(output.files_changed), lines_added: metricValue(output.lines_added), lines_deleted: metricValue(output.lines_deleted), validation_pass_count: metricValue(output.validation_pass_count), validation_fail_count: metricValue(output.validation_fail_count), process_timeout: metricValue(execution.process_timeout), pre_validation: { changed_paths: array(object(changes.pre_validation, "pre validation").changed_paths, "changed paths").length, untracked_paths: array(object(changes.pre_validation, "pre validation").untracked_paths, "untracked paths").length },
      evidence_completeness: object(telemetry.evidence_completeness, "evidence completeness").status as Json
    },
    validation,
    candidate_diff: diff.text,
    truncation: { candidate_diff: diff.truncated, validation_excerpt_limit: commandLimit }
  };
}

export function buildJudgePacket(run: LoadedRun): { packet: Record<string, Json>; identityMap: Record<string, string> } {
  const candidates = maskedCandidates(run);
  const labels = candidates.map((candidate) => candidate.label);
  const packet = {
    schema_version: judgeSchemaVersion,
    task_snapshot: { task_contract_hash: run.manifest.task_contract_hash as string, allowed_paths: run.snapshot.allowed_paths as Json, forbidden_paths: run.snapshot.forbidden_paths as Json, validation_commands: (run.snapshot.validation_commands as unknown[]).map(() => "configured command") },
    criteria: ["acceptance_coverage", "maintainability", "architecture_fit", "regression_risk", "unnecessary_complexity", "evidence_quality"],
    candidates: candidates.map((candidate) => candidateInput(candidate, 2_000)),
    limits: { per_candidate_excerpt_chars: 6_000, run_packet_budget_chars: 8_000 + candidates.length * 12_000 }
  } as Record<string, Json>;
  ensureNoLeak(packet, candidates.map((candidate) => candidate.id));
  return { packet, identityMap: Object.fromEntries(candidates.map((candidate) => [candidate.label, candidate.id])) };
}

const criteria = ["acceptance_coverage", "maintainability", "architecture_fit", "regression_risk", "unnecessary_complexity", "evidence_quality"] as const;
const ordinal = new Set(["strong", "adequate", "weak", "insufficient_evidence"]);
function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void { if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) throw new Error(`${label} has invalid fields`); }
export function validateJudgeResponse(value: unknown, labels: string[], eligible: Set<string>): Record<string, unknown> {
  const result = object(value, "judge response");
  exactKeys(result, ["schema_version", "verdict", "recommended_labels", "confidence", "ranking", "criteria_by_candidate", "strengths_by_candidate", "risks_by_candidate", "limitations", "summary"], "judge response");
  if (result.schema_version !== judgeSchemaVersion || !["RECOMMENDATION", "TIE", "INCONCLUSIVE"].includes(String(result.verdict)) || !["low", "medium", "high"].includes(String(result.confidence))) throw new Error("judge response has invalid header");
  const recommendation = array(result.recommended_labels, "recommended labels").map((item) => text(item, "recommended label"));
  if (recommendation.some((label) => !eligible.has(label)) || new Set(recommendation).size !== recommendation.length) throw new Error("judge response recommends an ineligible or duplicate label");
  if (result.verdict === "RECOMMENDATION" && recommendation.length !== 1) throw new Error("recommendation verdict requires one label");
  if (result.verdict === "TIE" && recommendation.length < 2) throw new Error("tie verdict requires two labels");
  if (result.verdict === "INCONCLUSIVE" && recommendation.length !== 0) throw new Error("inconclusive verdict cannot recommend a label");
  const ranking = array(result.ranking, "ranking").map((item) => object(item, "ranking item"));
  if (ranking.length !== eligible.size || new Set(ranking.map((item) => item.label)).size !== ranking.length || ranking.some((item) => !eligible.has(item.label as string) || typeof item.rank !== "number" || !ordinal.has(String(item.tier)) || typeof item.rationale !== "string")) throw new Error("judge response has invalid ranking");
  const top = new Set(ranking.filter((item) => item.rank === 1).map((item) => item.label as string));
  if ((result.verdict === "RECOMMENDATION" && (top.size !== 1 || !top.has(recommendation[0]))) || (result.verdict === "TIE" && (top.size !== recommendation.length || recommendation.some((label) => !top.has(label))))) throw new Error("judge response has inconsistent recommendation ranks");
  for (const section of ["criteria_by_candidate", "strengths_by_candidate", "risks_by_candidate"] as const) {
    const entries = object(result[section], section); exactKeys(entries, labels, section);
    for (const label of labels) {
      if (section === "criteria_by_candidate") { const item = object(entries[label], `${section}.${label}`); exactKeys(item, [...criteria], `${section}.${label}`); if (criteria.some((key) => !ordinal.has(String(item[key])))) throw new Error("invalid criterion ordinal"); }
      else if (!Array.isArray(entries[label]) || (entries[label] as unknown[]).some((item) => typeof item !== "string")) throw new Error(`${section}.${label} must be a string list`);
    }
  }
  if (!Array.isArray(result.limitations) || (result.limitations as unknown[]).some((item) => typeof item !== "string") || typeof result.summary !== "string") throw new Error("judge response has invalid conclusion");
  return result;
}

export class CodexJudgeAdapter implements JudgeAdapter {
  async doctor(_config: JudgeConfig): Promise<DoctorResult> { return new CodexExecAdapter().doctor(); }
  async adjudicate(request: JudgeRequest): Promise<JudgeExecution> {
    await mkdir(request.staging_directory, { recursive: true });
    const packetPath = join(request.staging_directory, "masked-judge-input.json");
    const schemaPath = join(request.staging_directory, "judge-output-schema.json");
    const responsePath = join(request.staging_directory, "response.txt");
    await Promise.all([writeFile(packetPath, json(request.packet)), writeFile(schemaPath, json(request.schema))]);
    const executable = await resolveCodexExecutable();
    const args = ["exec", "--model", request.config.model, "--sandbox", "read-only", "--ephemeral", "--cd", request.staging_directory, "--output-schema", schemaPath, "--output-last-message", responsePath, "--config", 'approval_policy="never"', "--config", `model_reasoning_effort=${JSON.stringify(request.config.reasoning_effort)}`, request.prompt];
    const execution: CandidateExecution = await runProcess(executable.path, args, request.staging_directory, request.config.timeout_ms, join(request.staging_directory, "stdout.log"), join(request.staging_directory, "stderr.log"));
    const [stdout, stderr, response] = await Promise.all([readFile(join(request.staging_directory, "stdout.log"), "utf8").catch(() => ""), readFile(join(request.staging_directory, "stderr.log"), "utf8").catch(() => ""), readFile(responsePath, "utf8").catch(() => "")]);
    return { started_at: execution.startedAt, completed_at: execution.completedAt, wall_clock_ms: execution.durationMs, exit_code: execution.exitCode, timeout: execution.timedOut, stdout, stderr, response_text: response, launch_error: execution.launchError ?? null, failure_classification: execution.failureKind ?? null, args: execution.args };
  }
}

function schema(labels: string[], eligible: Set<string>): Record<string, Json> {
  const criterion = { type: "object", additionalProperties: false, required: [...criteria], properties: Object.fromEntries(criteria.map((key) => [key, { enum: [...ordinal] }])) };
  const byLabel = (entry: Json): Json => ({ type: "object", additionalProperties: false, required: labels, properties: Object.fromEntries(labels.map((label) => [label, entry])) });
  return { type: "object", additionalProperties: false, required: ["schema_version", "verdict", "recommended_labels", "confidence", "ranking", "criteria_by_candidate", "strengths_by_candidate", "risks_by_candidate", "limitations", "summary"], properties: {
    schema_version: { const: judgeSchemaVersion }, verdict: { enum: ["RECOMMENDATION", "TIE", "INCONCLUSIVE"] }, recommended_labels: { type: "array", items: { enum: [...eligible] }, uniqueItems: true }, confidence: { enum: ["low", "medium", "high"] },
    ranking: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "rank", "tier", "rationale"], properties: { label: { enum: [...eligible] }, rank: { type: "integer", minimum: 1 }, tier: { enum: [...ordinal] }, rationale: { type: "string" } } }, uniqueItems: true },
    criteria_by_candidate: byLabel(criterion), strengths_by_candidate: byLabel({ type: "array", items: { type: "string" } }), risks_by_candidate: byLabel({ type: "array", items: { type: "string" } }), limitations: { type: "array", items: { type: "string" } }, summary: { type: "string" }
  } };
}
function prompt(labels: string[]): string { return `Evaluate labels ${labels.join(", ")} only. Deterministic hard gates are authoritative; failed or unavailable candidates are ineligible. Return only JSON matching schema ${judgeSchemaVersion}. Do not infer configuration identity or causal claims. Use ordinal criteria, no weighted score.`; }
function eligibility(candidate: CandidatePacket): "eligible" | "excluded" { const gates = array(candidate.telemetry.hard_gates, "hard gates"); return gates.every((item) => object(item, "hard gate").status === "passed") ? "eligible" : "excluded"; }
function repairPrompt(labels: string[], problem: string): string { return `${prompt(labels)} Repair only the JSON structure. Problem: ${problem}`; }
function publicExecution(execution: JudgeExecution | null, staging: string): JudgeExecution | null {
  if (!execution) return null;
  const redact = (value: string): string => value.replaceAll(staging, "<path:judge-staging>");
  return { ...execution, args: execution.args.map(redact), stdout: redact(execution.stdout), stderr: redact(execution.stderr), launch_error: execution.launch_error ? redact(execution.launch_error) : null };
}

export async function adjudicateRun(runDirectory: string, judge: JudgeAdapter, config: JudgeConfig = defaultJudgeConfig): Promise<Record<string, unknown>> {
  if (config.model !== "gpt-5.6-sol" || !["low", "high"].includes(config.reasoning_effort)) throw new Error("judge must use gpt-5.6-sol with low or high reasoning");
  const run = await loadPhase2Run(runDirectory);
  if (await stat(join(run.directory, "evaluation.json")).then(() => true).catch(() => false)) throw new Error("completed adjudication already exists");
  const { packet, identityMap } = buildJudgePacket(run);
  const candidates = maskedCandidates(run);
  const labels = candidates.map((candidate) => candidate.label);
  const eligible = new Set(candidates.filter((candidate) => eligibility(candidate) === "eligible").map((candidate) => candidate.label));
  const request = { schema_version: judgeSchemaVersion, config: { model: config.model, reasoning_effort: config.reasoning_effort, timeout_ms: config.timeout_ms }, labels, eligible_labels: [...eligible] };
  let verdict: Record<string, unknown> | null = null;
  let execution: JudgeExecution | null = null;
  let repair: JudgeExecution | null = null;
  let parseError: string | null = null;
  if (eligible.size > 0) {
    const staging = join(run.directory, ".judge-staging");
    execution = await judge.adjudicate({ staging_directory: staging, packet, schema: schema(labels, eligible), prompt: prompt(labels), config });
    if (!execution.timeout && execution.exit_code === 0 && !execution.launch_error) {
      try { verdict = validateJudgeResponse(JSON.parse(execution.response_text), labels, eligible); } catch (error) { parseError = error instanceof Error ? error.message : String(error); repair = await judge.adjudicate({ staging_directory: staging, packet, schema: schema(labels, eligible), prompt: repairPrompt(labels, parseError), config }); if (!repair.timeout && repair.exit_code === 0 && !repair.launch_error) try { verdict = validateJudgeResponse(JSON.parse(repair.response_text), labels, eligible); } catch (repairError) { parseError = repairError instanceof Error ? repairError.message : String(repairError); } }
    } else parseError = execution.failure_classification ?? "judge execution failed";
  }
  const outcome: EvaluationOutcome = eligible.size === 0 ? "NO_WINNER" : verdict ? verdict.verdict as JudgeVerdict : "INCONCLUSIVE";
  const ranking = verdict ? array(verdict.ranking, "ranking") as Record<string, unknown>[] : [];
  const evaluation = { schema_version: judgeSchemaVersion, outcome, candidates: candidates.map((candidate) => { const item = ranking.find((entry) => entry.label === candidate.label); return { candidate_id: candidate.id, label: candidate.label, eligibility: eligibility(candidate), hard_gate_status: object(candidate.telemetry.output, "output").hard_gate_status, rank: item?.rank ?? null, tier: item?.tier ?? null }; }), adjudication: verdict ?? { status: eligible.size === 0 ? "not_invoked_no_eligible_candidates" : "inconclusive", error: parseError } };
  await Promise.all([
    atomicWrite(join(run.directory, "identity-map.json"), { schema_version: judgeSchemaVersion, labels: identityMap }),
    atomicWrite(join(run.directory, "masked-judge-input.json"), packet),
    atomicWrite(join(run.directory, "judge-request.json"), request),
    atomicWrite(join(run.directory, "judge-output-schema.json"), schema(labels, eligible)),
    atomicWrite(join(run.directory, "judge-original-response.txt"), execution?.response_text ?? ""),
    atomicWrite(join(run.directory, "judge-original-response.json"), execution ? safeJson(execution.response_text) : { status: "not_applicable" }),
    atomicWrite(join(run.directory, "judge-repair-request.json"), repair ? { prompt: repairPrompt(labels, parseError ?? "invalid response") } : { status: "not_applicable" }),
    atomicWrite(join(run.directory, "judge-repaired-response.txt"), repair?.response_text ?? ""),
    atomicWrite(join(run.directory, "judge-repaired-response.json"), repair ? safeJson(repair.response_text) : { status: "not_applicable" }),
    atomicWrite(join(run.directory, "judge-result.json"), { status: eligible.size === 0 ? "not_invoked_no_eligible_candidates" : verdict ? "completed" : "inconclusive", original: publicExecution(execution, join(run.directory, ".judge-staging")), repair: publicExecution(repair, join(run.directory, ".judge-staging")), error: parseError }),
    atomicWrite(join(run.directory, "adjudication.json"), { schema_version: judgeSchemaVersion, labels, eligible_labels: [...eligible], verdict: verdict ?? null }),
    atomicWrite(join(run.directory, "evaluation.json"), evaluation)
  ]);
  return evaluation;
}

const safeJson = (value: string): unknown => { try { return JSON.parse(value); } catch { return { status: "malformed" }; } };
export async function adjudicationDryRun(runDirectory: string, config: JudgeConfig = defaultJudgeConfig): Promise<Record<string, unknown>> {
  if (config.model !== "gpt-5.6-sol" || !["low", "high"].includes(config.reasoning_effort)) throw new Error("judge must use gpt-5.6-sol with low or high reasoning");
  const run = await loadPhase2Run(runDirectory); const { packet } = buildJudgePacket(run); const labels = (packet.candidates as Array<Record<string, Json>>).map((item) => String(item.label));
  return { packet_valid: true, labels, model: config.model, reasoning_effort: config.reasoning_effort, command_shape: ["exec", "--model", config.model, "--sandbox", "read-only", "--ephemeral", "--output-schema", "<path:redacted>", "--config", 'approval_policy="never"'] };
}
