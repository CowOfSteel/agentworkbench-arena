import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
export interface PacketLimits { validation_output_chars: number; diff_chars: number; candidate_chars: number; packet_chars?: number; }
export const defaultPacketLimits: PacketLimits = { validation_output_chars: 1_000, diff_chars: 8_000, candidate_chars: 12_000 };

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface CandidatePacket { id: string; label: string; artifactDirectory: string; telemetry: Record<string, unknown>; validation: Record<string, unknown>; provenance: Record<string, unknown>; diff: string; }
interface IdentityInventory { substring: string[]; token: string[]; }
interface LoadedRun { directory: string; manifest: Record<string, unknown>; snapshot: Record<string, unknown>; taskContract: Record<string, unknown>; candidates: CandidatePacket[]; forbidden: IdentityInventory; }
const criteria = ["acceptance_coverage", "maintainability", "architecture_fit", "regression_risk", "unnecessary_complexity", "evidence_quality"] as const;
const ordinal = new Set(["strong", "adequate", "weak", "insufficient_evidence"]);
const maxText = 2_000, maxList = 16, maxResponse = 16_000;
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const json = (value: unknown): string => JSON.stringify(value, null, 2);
const object = (value: unknown, label: string): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as Record<string, unknown>; };
const array = (value: unknown, label: string): unknown[] => { if (!Array.isArray(value)) throw new Error(`${label} must be an array`); return value; };
const text = (value: unknown, label: string): string => { if (typeof value !== "string") throw new Error(`${label} must be a string`); return value; };
const portable = (value: unknown): value is string => typeof value === "string" && value.length > 0 && !/^(?:[A-Za-z]:)?[\\/]/.test(value) && !value.split(/[\\/]/).includes("..");
const metric = (value: unknown): Json => object(value, "metric").value as Json;
const labelAt = (index: number): string => { let value = index + 1, result = ""; while (value) { value--; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); } return result; };
const truncate = (value: string, limit: number): { text: string; truncated: boolean } => value.length <= limit ? { text: value, truncated: false } : { text: `${value.slice(0, Math.max(0, limit - 16))}\n<truncated>`, truncated: true };
const pathPattern = /(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/]|file:\/\/|(?:^|[\s"'(])\/(?:Users|home|tmp|var|private|mnt|opt|dev)\/)/i;
const sanitizePaths = (value: string): string => value.replace(/[A-Za-z]:[\\/][^\s"']+|\\\\[^\\/]+[\\/][^\s"']+|file:\/\/[^\s"']+|\/(?:Users|home|tmp|var|private|mnt|opt)\/[^\s"']+/gi, "<path:redacted>");

async function atomicWrite(path: string, value: unknown): Promise<void> { const temporary = `${path}.tmp`; await writeFile(temporary, typeof value === "string" ? value : json(value)); await rename(temporary, path); }
async function readJson(path: string): Promise<Record<string, unknown>> { return object(JSON.parse(await readFile(path, "utf8")), path); }
function strings(value: unknown, target: Set<string>): void { if (typeof value === "string" && value) target.add(value); else if (Array.isArray(value)) value.forEach((item) => strings(item, target)); else if (value && typeof value === "object") Object.values(value).forEach((item) => strings(item, target)); }
function failPolicy(): never { throw new Error("judge packet violates identity or path policy"); }
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function inventory(value: IdentityInventory | string[]): IdentityInventory { return Array.isArray(value) ? { substring: value, token: [] } : value; }
const genericIdentityField = /^(?:attention|variant|harness|provider|agent|profile|adapter|reasoning[_ -]?effort)$/i;
const genericLeak = (value: string, tokens: string[], field = ""): boolean => tokens.some((item) => item && (genericIdentityField.test(field) && new RegExp(`^${escapeRegex(item)}$`, "i").test(value) || new RegExp(`(?:["']?(?:attention|variant|harness|provider|agent|profile|adapter|reasoning[ _-]?effort)["']?)\\s*(?::|=|\\bis\\b)\\s*["']?${escapeRegex(item)}\\b`, "i").test(value)));
function ensureSafe(value: unknown, forbidden: IdentityInventory | string[], runDirectory = "", field = ""): void {
  if (typeof value === "string") {
    const lower = value.toLocaleLowerCase(), identities = inventory(forbidden), tokenValue = value.replaceAll("<path:redacted>", "");
    if (pathPattern.test(value) || (runDirectory && lower.includes(runDirectory.toLocaleLowerCase())) || identities.substring.some((item) => item && lower.includes(item.toLocaleLowerCase())) || genericLeak(tokenValue, identities.token, field)) failPolicy();
  } else if (Array.isArray(value)) value.forEach((item) => ensureSafe(item, forbidden, runDirectory, field));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => ensureSafe(item, forbidden, runDirectory, key));
}
function safeText(value: string, forbidden: IdentityInventory | string[], runDirectory: string): string { const sanitized = sanitizePaths(value); ensureSafe(sanitized, forbidden, runDirectory); return sanitized; }

function forbiddenInventory(candidate: CandidatePacket, manifestCandidate: Record<string, unknown>): IdentityInventory {
  const substring = new Set<string>(), token = new Set<string>(), telemetry = object(candidate.telemetry.provenance, "telemetry provenance");
  const add = (value: unknown, target: Set<string>) => strings(value, target), compound = (value: unknown, target: Set<string>) => { const values = new Set<string>(); strings(value, values); values.forEach((item) => (/[\d._:/-]/.test(item) ? substring : target).add(item)); };
  for (const source of [candidate.id, candidate.artifactDirectory, manifestCandidate.configuration_hash, telemetry.model, telemetry.configuration_hash]) add(source, substring);
  compound(telemetry.adapter, token); compound(telemetry.profile, token);
  for (const source of [telemetry.harness, telemetry.provider, telemetry.attention, telemetry.agent]) add(source, token);
  const native = candidate.provenance;
  for (const key of ["candidate_id", "model"]) add(native[key], substring);
  compound(native.adapter, token); compound(native.profile, token);
  for (const key of ["harness", "provider", "attention", "agent"]) add(native[key], token);
  const executable = object(native.adapter_execution ?? {}, "adapter execution").executable;
  if (typeof executable === "string") add(executable, substring);
  else if (executable && typeof executable === "object" && !Array.isArray(executable)) add(object(executable, "executable").path, substring);
  return { substring: [...substring].filter(Boolean).sort(), token: [...token].filter(Boolean).sort() };
}

export async function loadPhase2Run(runDirectory: string): Promise<LoadedRun> {
  const directory = resolve(runDirectory); const [manifest, snapshot] = await Promise.all([readJson(join(directory, "manifest.json")), readJson(join(directory, "trial-snapshot.json"))]);
  if (manifest.manifest_finalization_status !== "complete" || manifest.phase_3_readiness !== "ready_for_audit") throw new Error("run is not finalized for Phase 3 audit");
  if (hash(JSON.stringify(snapshot)) !== manifest.normalized_trial_snapshot_hash || snapshot.task_contract_hash !== manifest.task_contract_hash) throw new Error("run integrity check failed");
  if (!portable(manifest.task_contract_artifact)) throw new Error("run lacks canonical task contract artifact");
  const taskContract = await readJson(join(directory, manifest.task_contract_artifact));
  if (typeof taskContract.objective !== "string" || hash(taskContract.objective) !== taskContract.task_contract_hash || taskContract.task_contract_hash !== manifest.task_contract_hash || !Array.isArray(taskContract.instructions) || !Array.isArray(taskContract.acceptance_criteria) || !Array.isArray(taskContract.validation_commands)) throw new Error("task contract integrity check failed");
  const manifestCandidates = array(manifest.candidates, "manifest candidates"); if (manifest.candidate_count !== manifestCandidates.length) throw new Error("manifest candidate count mismatch");
  const seen = new Set<string>(), actual = new Set((await readdir(join(directory, "candidates"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => `candidates/${entry.name}`));
  const candidates: CandidatePacket[] = []; const forbidden: IdentityInventory = { substring: [], token: [] };
  for (const raw of manifestCandidates) {
    const entry = object(raw, "manifest candidate"), id = text(entry.candidate_id, "candidate id"), artifactDirectory = text(entry.artifact_directory, "artifact directory");
    if (!portable(artifactDirectory) || artifactDirectory !== `candidates/${id}` || seen.has(artifactDirectory) || !actual.delete(artifactDirectory)) throw new Error("candidate artifact integrity check failed");
    seen.add(artifactDirectory); const absolute = resolve(directory, artifactDirectory); if (relative(directory, absolute).startsWith("..") || !absolute.startsWith(`${directory}${sep}`)) throw new Error("candidate artifact integrity check failed");
    const [telemetry, validation, provenance, diff] = await Promise.all([readJson(join(absolute, "telemetry.json")), readJson(join(absolute, "validation.json")), readJson(join(absolute, "provenance.json")), readFile(join(absolute, "candidate.diff"), "utf8")]);
    if (!phase3PacketReady({ telemetry, validation, artifactDirectory, taskContract })) throw new Error("candidate packet is not ready");
    const source = object(telemetry.provenance, "telemetry provenance"); if (source.candidate_id !== id || source.task_contract_hash !== manifest.task_contract_hash || source.configuration_hash !== entry.configuration_hash) throw new Error("candidate provenance integrity check failed");
    const candidate = { id, label: "", artifactDirectory, telemetry, validation, provenance, diff }, identities = forbiddenInventory(candidate, entry); forbidden.substring.push(...identities.substring); forbidden.token.push(...identities.token); candidates.push(candidate);
  }
  if (actual.size) throw new Error("candidate artifact integrity check failed");
  return { directory, manifest, snapshot, taskContract, candidates, forbidden: { substring: [...new Set(forbidden.substring)].sort(), token: [...new Set(forbidden.token)].sort() } };
}

function maskedCandidates(run: LoadedRun): CandidatePacket[] { const seed = `${judgeSchemaVersion}:${run.manifest.run_id}:${run.manifest.trial_id}:${run.manifest.task_contract_hash}:${run.manifest.normalized_trial_snapshot_hash}`; return [...run.candidates].sort((a, b) => hash(`${seed}:${a.id}`).localeCompare(hash(`${seed}:${b.id}`))).map((candidate, index) => ({ ...candidate, label: labelAt(index) })); }
function changedPaths(candidate: CandidatePacket): string[] { return array(object(object(candidate.telemetry.change_analysis, "change analysis").pre_validation, "pre validation").changed_paths, "changed paths").filter((value): value is string => typeof value === "string" && portable(value)).sort(); }
function safeDiff(diff: string, paths: string[], limit: number): { text: string; limitations: string[] } {
  const output: string[] = [], limitations: string[] = []; let current: string | undefined;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) { current = paths.find((path) => line.replace(/\\/g, "/").includes(`/${path}`)); if (current) output.push(`diff --git a/${current} b/${current}`); else limitations.push("unsafe diff header omitted"); continue; }
    if (/^(--- |\+\+\+ )/.test(line)) { if (!current) continue; output.push(`${line.slice(0, 4)}${line.startsWith("--- ") && /\/dev\/null/.test(line) ? "/dev/null" : `${line.startsWith("--- ") ? "a" : "b"}/${current}`}`); continue; }
    if (/^(index |new file mode |deleted file mode )/.test(line)) continue;
    if (/^(@@|[ +\-])/.test(line)) output.push(line);
  }
  const clipped = truncate(output.join("\n"), limit); if (clipped.truncated) limitations.push("diff truncated to symmetric limit"); return { text: clipped.text, limitations };
}

function candidateInput(candidate: CandidatePacket, run: LoadedRun, limits: PacketLimits): Record<string, Json> {
  const telemetry = candidate.telemetry, output = object(telemetry.output, "output"), execution = object(telemetry.execution, "execution"), changes = object(telemetry.change_analysis, "changes"); const limitations: string[] = [];
  const commands = array(candidate.validation.commands, "validation commands"), perSide = Math.max(64, Math.floor(limits.validation_output_chars / Math.max(1, commands.length * 2)));
  const validation = commands.map((raw) => { const command = object(raw, "validation command"), stdout = truncate(safeText(String(command.stdout ?? ""), run.forbidden, run.directory), perSide), stderr = truncate(safeText(String(command.stderr ?? ""), run.forbidden, run.directory), perSide); if (stdout.truncated || stderr.truncated) limitations.push("validation output truncated to symmetric limit"); return { status: command.status as Json, exit_code: command.exit_code as Json, timeout: command.timeout as Json, failure_classification: command.failure_classification as Json, stdout_excerpt: stdout.text, stderr_excerpt: stderr.text }; });
  const diff = safeDiff(candidate.diff, changedPaths(candidate), limits.diff_chars); limitations.push(...diff.limitations);
  const gates = array(telemetry.hard_gates, "hard gates").map((raw) => { const gate = object(raw, "hard gate"); return { id: gate.id as Json, status: gate.status as Json, reason: safeText(String(gate.reason ?? ""), run.forbidden, run.directory) }; });
  const result: Record<string, Json> = { label: candidate.label, hard_gates: gates, deterministic_facts: { files_changed: metric(output.files_changed), lines_added: metric(output.lines_added), lines_deleted: metric(output.lines_deleted), validation_pass_count: metric(output.validation_pass_count), validation_fail_count: metric(output.validation_fail_count), process_timeout: metric(execution.process_timeout), pre_validation: { changed_paths: changedPaths(candidate).length, untracked_paths: array(object(changes.pre_validation, "pre validation").untracked_paths, "untracked paths").length }, evidence_completeness: object(telemetry.evidence_completeness, "evidence").status as Json }, validation, candidate_diff: diff.text, evidence_limitations: limitations };
  if (JSON.stringify(result).length > limits.candidate_chars) throw new Error("judge packet exceeds configured budget"); return result;
}

export function buildJudgePacket(run: LoadedRun, limits: PacketLimits = defaultPacketLimits): { packet: Record<string, Json>; identityMap: Record<string, string> } {
  const candidates = maskedCandidates(run), packetLimit = limits.packet_chars ?? 8_192 + limits.candidate_chars * candidates.length;
  const packet: Record<string, Json> = { schema_version: judgeSchemaVersion, task_contract: { objective: run.taskContract.objective as string, instructions: run.taskContract.instructions as Json, acceptance_criteria: run.taskContract.acceptance_criteria as Json, allowed_paths: run.taskContract.allowed_paths as Json, forbidden_paths: run.taskContract.forbidden_paths as Json, validation_commands: run.taskContract.validation_commands as Json }, criteria: [...criteria], candidates: candidates.map((candidate) => candidateInput(candidate, run, limits)), evidence_limitations: [], limits: { validation_output_chars: limits.validation_output_chars, diff_chars: limits.diff_chars, candidate_chars: limits.candidate_chars, packet_chars: packetLimit } };
  ensureSafe(packet, run.forbidden, run.directory); const serialized = JSON.stringify(packet); if (serialized.length > packetLimit) throw new Error("judge packet exceeds configured budget"); (packet.evidence_limitations as Json[]).push(`serialized packet ${serialized.length}/${packetLimit} characters`); return { packet, identityMap: Object.fromEntries(candidates.map((candidate) => [candidate.label, candidate.id])) };
}

function exact(value: Record<string, unknown>, keys: string[], label: string): void { if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) throw new Error(`${label} is invalid`); }
function bounded(value: unknown, label: string): string { const result = text(value, label); if (result.length > maxText) throw new Error(`${label} is invalid`); return result; }
export function validateJudgeResponse(value: unknown, labels: string[], eligible: Set<string>, forbidden: IdentityInventory | string[] = []): Record<string, unknown> {
  ensureSafe(value, forbidden); const result = object(value, "judge response"); exact(result, ["schema_version", "verdict", "recommended_labels", "confidence", "ranking", "criteria_by_candidate", "strengths_by_candidate", "risks_by_candidate", "limitations", "summary"], "judge response");
  if (result.schema_version !== judgeSchemaVersion || !["RECOMMENDATION", "TIE", "INCONCLUSIVE"].includes(String(result.verdict)) || !["low", "medium", "high"].includes(String(result.confidence))) throw new Error("judge response is invalid");
  const recommended = array(result.recommended_labels, "recommended labels").map((item) => bounded(item, "recommended label")); if (recommended.length > maxList || new Set(recommended).size !== recommended.length || recommended.some((label) => !eligible.has(label))) throw new Error("judge response is invalid");
  const ranking = array(result.ranking, "ranking").map((item) => object(item, "ranking item")); if (ranking.length !== eligible.size || new Set(ranking.map((item) => item.label)).size !== ranking.length) throw new Error("judge response is invalid");
  const ranks = ranking.map((item) => { exact(item, ["label", "rank", "tier", "rationale"], "ranking item"); if (!eligible.has(String(item.label)) || !Number.isInteger(item.rank) || (item.rank as number) < 1 || !ordinal.has(String(item.tier))) throw new Error("judge response is invalid"); bounded(item.rationale, "rationale"); return item; });
  const top = ranks.filter((item) => item.rank === 1).map((item) => String(item.label)), rest = ranks.filter((item) => item.rank !== 1).map((item) => item.rank as number).sort((a, b) => a - b);
  if (result.verdict === "RECOMMENDATION" && (recommended.length !== 1 || top.length !== 1 || top[0] !== recommended[0])) throw new Error("judge response is invalid");
  if (result.verdict === "TIE" && (recommended.length < 2 || recommended.length !== top.length || recommended.some((label) => !top.includes(label)))) throw new Error("judge response is invalid");
  if (result.verdict === "INCONCLUSIVE" && recommended.length !== 0) throw new Error("judge response is invalid");
  if (rest.some((rank, index) => rank !== index + 2) || new Set(rest).size !== rest.length) throw new Error("judge response is invalid");
  for (const section of ["criteria_by_candidate", "strengths_by_candidate", "risks_by_candidate"] as const) { const entries = object(result[section], section); exact(entries, labels, section); for (const label of labels) { if (section === "criteria_by_candidate") { const entry = object(entries[label], "criteria"); exact(entry, [...criteria], "criteria"); if (criteria.some((key) => !ordinal.has(String(entry[key])))) throw new Error("judge response is invalid"); } else { const list = array(entries[label], "findings"); if (list.length > maxList) throw new Error("judge response is invalid"); list.forEach((item) => bounded(item, "finding")); } } }
  const limitations = array(result.limitations, "limitations"); if (limitations.length > maxList) throw new Error("judge response is invalid"); limitations.forEach((item) => bounded(item, "limitation")); bounded(result.summary, "summary"); return result;
}

export class CodexJudgeAdapter implements JudgeAdapter {
  async doctor(_config: JudgeConfig): Promise<DoctorResult> { return new CodexExecAdapter().doctor(); }
  async adjudicate(request: JudgeRequest): Promise<JudgeExecution> { await mkdir(request.staging_directory, { recursive: true }); const packetPath = join(request.staging_directory, "masked-judge-input.json"), schemaPath = join(request.staging_directory, "judge-output-schema.json"), responsePath = join(request.staging_directory, "response.txt"); await Promise.all([writeFile(packetPath, json(request.packet)), writeFile(schemaPath, json(request.schema))]); const executable = await resolveCodexExecutable(); const args = ["exec", "--model", request.config.model, "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check", "--cd", request.staging_directory, "--output-schema", schemaPath, "--output-last-message", responsePath, "--config", 'approval_policy="never"', "--config", `model_reasoning_effort=${JSON.stringify(request.config.reasoning_effort)}`, request.prompt]; const execution: CandidateExecution = await runProcess(executable.path, args, request.staging_directory, request.config.timeout_ms, join(request.staging_directory, "stdout.log"), join(request.staging_directory, "stderr.log")); const [stdout, stderr, response] = await Promise.all([readFile(join(request.staging_directory, "stdout.log"), "utf8").catch(() => ""), readFile(join(request.staging_directory, "stderr.log"), "utf8").catch(() => ""), readFile(responsePath, "utf8").catch(() => "")]); return { started_at: execution.startedAt, completed_at: execution.completedAt, wall_clock_ms: execution.durationMs, exit_code: execution.exitCode, timeout: execution.timedOut, stdout, stderr, response_text: response, launch_error: execution.launchError ?? null, failure_classification: execution.failureKind ?? null, args: execution.args }; }
}

function schema(labels: string[], eligible: Set<string>): Record<string, Json> { const criterion = { type: "object", additionalProperties: false, required: [...criteria], properties: Object.fromEntries(criteria.map((key) => [key, { enum: [...ordinal] }])) }, byLabel = (entry: Json): Json => ({ type: "object", additionalProperties: false, required: labels, properties: Object.fromEntries(labels.map((label) => [label, entry])) }); return { type: "object", additionalProperties: false, required: ["schema_version", "verdict", "recommended_labels", "confidence", "ranking", "criteria_by_candidate", "strengths_by_candidate", "risks_by_candidate", "limitations", "summary"], properties: { schema_version: { const: judgeSchemaVersion }, verdict: { enum: ["RECOMMENDATION", "TIE", "INCONCLUSIVE"] }, recommended_labels: { type: "array", items: { enum: [...eligible] }, uniqueItems: true }, confidence: { enum: ["low", "medium", "high"] }, ranking: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "rank", "tier", "rationale"], properties: { label: { enum: [...eligible] }, rank: { type: "integer", minimum: 1 }, tier: { enum: [...ordinal] }, rationale: { type: "string", maxLength: maxText } } } }, criteria_by_candidate: byLabel(criterion), strengths_by_candidate: byLabel({ type: "array", maxItems: maxList, items: { type: "string", maxLength: maxText } }), risks_by_candidate: byLabel({ type: "array", maxItems: maxList, items: { type: "string", maxLength: maxText } }), limitations: { type: "array", maxItems: maxList, items: { type: "string", maxLength: maxText } }, summary: { type: "string", maxLength: maxText } } }; }
function prompt(labels: string[]): string { return `Evaluate opaque labels ${labels.join(", ")}. Deterministic hard gates are authoritative; excluded labels are not eligible. Return only schema ${judgeSchemaVersion} JSON. Do not infer identity or causal claims.`; }
function eligibility(candidate: CandidatePacket): "eligible" | "excluded" { return array(candidate.telemetry.hard_gates, "hard gates").every((raw) => object(raw, "hard gate").status === "passed") ? "eligible" : "excluded"; }
function safeExecution(execution: JudgeExecution | null, staging: string): JudgeExecution | null { if (!execution) return null; const redact = (value: string) => sanitizePaths(value).replaceAll(staging, "<path:judge-staging>"); return { ...execution, args: execution.args.map(redact), stdout: redact(execution.stdout), stderr: redact(execution.stderr), launch_error: execution.launch_error ? redact(execution.launch_error) : null }; }
function repairRequest(labels: string[], eligible: Set<string>, original: string, errors: string[]): Record<string, Json> { return { instruction: "Repair structure only. Preserve substantive judgments. Return only JSON.", labels, strict_schema: schema(labels, eligible), validation_errors: errors.map(() => "response failed strict validation"), malformed_original_response: original }; }
function parseSafe(response: string, labels: string[], eligible: Set<string>, run: LoadedRun): { verdict: Record<string, unknown> | null; error: string | null } { if (response.length > maxResponse) return { verdict: null, error: "response exceeded safe limit" }; try { ensureSafe(response, run.forbidden, run.directory); return { verdict: validateJudgeResponse(JSON.parse(response), labels, eligible, run.forbidden), error: null }; } catch { return { verdict: null, error: "response failed strict validation" }; } }
function excludedGates(candidate: CandidatePacket): unknown[] { return array(candidate.telemetry.hard_gates, "hard gates").filter((raw) => object(raw, "hard gate").status !== "passed").map((raw) => { const gate = object(raw, "hard gate"); return { id: gate.id, status: gate.status, reason: gate.reason }; }); }

export async function adjudicateRun(runDirectory: string, judge: JudgeAdapter, config: JudgeConfig = defaultJudgeConfig): Promise<Record<string, unknown>> {
  if (config.model !== "gpt-5.6-sol" || !["low", "high"].includes(config.reasoning_effort)) throw new Error("judge must use gpt-5.6-sol with low or high reasoning");
  const run = await loadPhase2Run(runDirectory); if (await stat(join(run.directory, "evaluation.json")).then(() => true).catch(() => false)) throw new Error("completed adjudication already exists");
  const { packet, identityMap } = buildJudgePacket(run), candidates = maskedCandidates(run), labels = candidates.map((candidate) => candidate.label), eligible = new Set(candidates.filter((candidate) => eligibility(candidate) === "eligible").map((candidate) => candidate.label));
  const judgeSchema = schema(labels, eligible), request = { schema_version: judgeSchemaVersion, config: { model: config.model, reasoning_effort: config.reasoning_effort, timeout_ms: config.timeout_ms }, labels, eligible_labels: [...eligible] };
  let execution: JudgeExecution | null = null, repair: JudgeExecution | null = null, verdict: Record<string, unknown> | null = null, error: string | null = null, staging = "", repairArtifact: Record<string, Json> | { status: "not_applicable" } = { status: "not_applicable" };
  if (eligible.size) {
    staging = await mkdtemp(join(tmpdir(), "arena-judge-"));
    try {
      await Promise.all([writeFile(join(staging, "masked-judge-input.json"), json(packet)), writeFile(join(staging, "judge-output-schema.json"), json(judgeSchema))]);
      execution = await judge.adjudicate({ staging_directory: staging, packet, schema: judgeSchema, prompt: prompt(labels), config });
      if (!execution.timeout && execution.exit_code === 0 && !execution.launch_error) {
        const parsed = parseSafe(execution.response_text, labels, eligible, run); verdict = parsed.verdict; error = parsed.error;
        if (!verdict && error) try {
          const repairData = repairRequest(labels, eligible, execution.response_text, [error]); ensureSafe(repairData, run.forbidden, run.directory); const repairPrompt = json(repairData); repairArtifact = { ...repairData, prompt: repairPrompt };
          repair = await judge.adjudicate({ staging_directory: staging, packet, schema: judgeSchema, prompt: repairPrompt, config });
          if (!repair.timeout && repair.exit_code === 0 && !repair.launch_error) { const repaired = parseSafe(repair.response_text, labels, eligible, run); verdict = repaired.verdict; error = repaired.error; }
        } catch { error = "response violated safety policy"; }
      } else error = "judge execution failed";
    } catch { error = "judge execution failed"; } finally { await rm(staging, { recursive: true, force: true }); }
  }
  const outcome: EvaluationOutcome = !eligible.size ? "NO_WINNER" : verdict ? verdict.verdict as JudgeVerdict : "INCONCLUSIVE", ranking = verdict ? array(verdict.ranking, "ranking") as Record<string, unknown>[] : [];
  const ordered = [...candidates.filter((candidate) => eligibility(candidate) === "eligible").sort((a, b) => Number(ranking.find((item) => item.label === a.label)?.rank ?? Number.MAX_SAFE_INTEGER) - Number(ranking.find((item) => item.label === b.label)?.rank ?? Number.MAX_SAFE_INTEGER)), ...candidates.filter((candidate) => eligibility(candidate) === "excluded").sort((a, b) => a.label.localeCompare(b.label))], recommended = verdict ? array(verdict.recommended_labels, "recommended labels") as string[] : [];
  const evaluation = { schema_version: judgeSchemaVersion, outcome, recommended_candidate_id: outcome === "RECOMMENDATION" ? identityMap[recommended[0]] : null, tied_candidate_ids: outcome === "TIE" ? recommended.map((label) => identityMap[label]) : [], candidates: ordered.map((candidate) => { const item = ranking.find((entry) => entry.label === candidate.label); return { candidate_id: candidate.id, label: candidate.label, eligibility: eligibility(candidate), hard_gate_status: metric(object(candidate.telemetry.output, "output").hard_gate_status), semantic_rank: item?.rank ?? null, semantic_tier: item?.tier ?? null, exclusion_gates: eligibility(candidate) === "excluded" ? excludedGates(candidate) : [] }; }), adjudication: verdict ?? { status: !eligible.size ? "not_invoked_no_eligible_candidates" : "inconclusive", error } };
  const responseArtifact = (value: string | undefined): string => { try { ensureSafe(value ?? "", run.forbidden, run.directory); return value ?? ""; } catch { return "<withheld: identity-or-path-policy>"; } };
  await Promise.all([atomicWrite(join(run.directory, "identity-map.json"), { schema_version: judgeSchemaVersion, labels: identityMap }), atomicWrite(join(run.directory, "masked-judge-input.json"), packet), atomicWrite(join(run.directory, "judge-request.json"), request), atomicWrite(join(run.directory, "judge-output-schema.json"), judgeSchema), atomicWrite(join(run.directory, "judge-original-response.txt"), responseArtifact(execution?.response_text)), atomicWrite(join(run.directory, "judge-original-response.json"), execution ? safeJson(responseArtifact(execution.response_text)) : { status: "not_applicable" }), atomicWrite(join(run.directory, "judge-repair-request.json"), repairArtifact), atomicWrite(join(run.directory, "judge-repaired-response.txt"), responseArtifact(repair?.response_text)), atomicWrite(join(run.directory, "judge-repaired-response.json"), repair ? safeJson(responseArtifact(repair.response_text)) : { status: "not_applicable" }), atomicWrite(join(run.directory, "judge-result.json"), { status: !eligible.size ? "not_invoked_no_eligible_candidates" : verdict ? "completed" : "inconclusive", original: safeExecution(execution, staging), repair: safeExecution(repair, staging), error }), atomicWrite(join(run.directory, "adjudication.json"), { schema_version: judgeSchemaVersion, labels, eligible_labels: [...eligible], verdict: verdict ?? null }), atomicWrite(join(run.directory, "evaluation.json"), evaluation)]); return evaluation;
}

const safeJson = (value: string): unknown => { try { return JSON.parse(value); } catch { return { status: "malformed" }; } };
export async function adjudicationDryRun(runDirectory: string, config: JudgeConfig = defaultJudgeConfig): Promise<Record<string, unknown>> {
  if (config.model !== "gpt-5.6-sol" || !["low", "high"].includes(config.reasoning_effort)) throw new Error("judge must use gpt-5.6-sol with low or high reasoning");
  const run = await loadPhase2Run(runDirectory), { packet } = buildJudgePacket(run), labels = (packet.candidates as Array<Record<string, Json>>).map((item) => String(item.label)), eligible = new Set(maskedCandidates(run).filter((candidate) => eligibility(candidate) === "eligible").map((candidate) => candidate.label)), preview = join(run.directory, "phase3-preview"), relativePreview = "phase3-preview";
  await rm(preview, { recursive: true, force: true }); await mkdir(preview, { recursive: true });
  const result = { packet_valid: true, preview_directory: relativePreview, labels, model: config.model, reasoning_effort: config.reasoning_effort, packet_size: JSON.stringify(packet).length, packet_limit: object(packet.limits, "limits").packet_chars, command_shape: ["exec", "--model", config.model, "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check", "--output-schema", "<path:redacted>", "--config", 'approval_policy="never"'] };
  await Promise.all([atomicWrite(join(preview, "masked-judge-input.json"), packet), atomicWrite(join(preview, "judge-output-schema.json"), schema(labels, eligible)), atomicWrite(join(preview, "dry-run.json"), result)]); return result;
}
