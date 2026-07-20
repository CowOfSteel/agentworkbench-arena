import { createHash } from "node:crypto";
import { appendFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, delimiter, dirname, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { CandidateAdapter, CandidateExecution, argumentShape, openCodePermissionConfig, runProcess } from "./adapters";
import { FractionalPriceAcceptance, validateFractionalPrice } from "./acceptance";
import { Candidate, Trial } from "./trial";
import { aggregateGateStatus, available, configurationHash, extractNativeTelemetry, GateStatus, Metric, telemetrySchemaVersion, trialSnapshot, unavailable } from "./telemetry";

const exec = promisify(execFile);
const git = async (repository: string, args: string[]): Promise<string> => (await exec("git", args, { cwd: repository, shell: false })).stdout.trim();
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const pathAllowed = (path: string, prefixes: string[]) => prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
const taskContractHash = (taskContract: string) => createHash("sha256").update(taskContract).digest("hex");
const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";

export interface CandidateAttemptResult { attempt: number; directory: string; execution: CandidateExecution; }
export interface CandidateResult { candidateId: string; directory: string; execution: CandidateExecution; retryCount: number; attempts: CandidateAttemptResult[]; hardGateStatus?: "passed" | "failed" | "unavailable"; }
export interface RunResult { directory: string; candidates: CandidateResult[]; }
export interface DiagnosticResult { directory: string; candidate: CandidateResult; passed: boolean; diagnosticPath: string; }

interface WorktreeStatus {
  git_status: string;
  changed_paths: string[];
  tracked_changes: string[];
  untracked_or_ignored_paths: string[];
  untracked_paths: string[];
  ignored_paths: string[];
  lines_added: number;
  lines_deleted: number;
}

async function gitOutput(repository: string, args: string[]): Promise<string> {
  try { return (await exec("git", args, { cwd: repository, shell: false, maxBuffer: 10 * 1024 * 1024 })).stdout; }
  catch (error) { return String((error as { stdout?: string | Buffer }).stdout ?? ""); }
}

async function files(root: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else found.push(path);
    }
  };
  await visit(root);
  return found;
}

async function trackedFiles(worktree: string): Promise<Set<string>> {
  const output = await gitOutput(worktree, ["ls-files", "-z"]);
  return new Set(output.split("\0").filter(Boolean).map((path) => path.replace(/\\/g, "/")));
}

async function worktreeStatus(worktree: string, baseline: string): Promise<WorktreeStatus> {
  const [status, tracked, known, untrackedOutput, ignoredOutput, numstat] = await Promise.all([
    gitOutput(worktree, ["status", "--porcelain=v1", "--ignored", "--untracked-files=all"]),
    gitOutput(worktree, ["diff", "--name-only", baseline]),
    trackedFiles(worktree),
    gitOutput(worktree, ["ls-files", "--others", "--exclude-standard", "-z"]),
    gitOutput(worktree, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"]),
    gitOutput(worktree, ["diff", "--numstat", baseline])
  ]);
  const all = await files(worktree);
  const untracked = all.map((path) => relative(worktree, path).replace(/\\/g, "/")).filter((path) => !known.has(path));
  const trackedChanges = tracked.split(/\r?\n/).filter(Boolean);
  const untrackedPaths = untrackedOutput.split("\0").filter(Boolean).sort();
  const ignoredPaths = ignoredOutput.split("\0").filter(Boolean).sort();
  const [trackedLinesAdded, linesDeleted] = numstat.split(/\r?\n/).filter(Boolean).reduce(([added, deleted], line) => {
    const [a, d] = line.split("\t");
    return [added + (Number.isFinite(Number(a)) ? Number(a) : 0), deleted + (Number.isFinite(Number(d)) ? Number(d) : 0)];
  }, [0, 0]);
  const untrackedLinesAdded = await Promise.all(untrackedPaths.map(async (path) => (await readFile(join(worktree, path), "utf8").catch(() => "")).split(/\r?\n/).filter(Boolean).length));
  return { git_status: status, changed_paths: [...new Set([...trackedChanges, ...untracked])].sort(), tracked_changes: trackedChanges, untracked_or_ignored_paths: untracked.sort(), untracked_paths: untrackedPaths, ignored_paths: ignoredPaths, lines_added: trackedLinesAdded + untrackedLinesAdded.reduce((total, value) => total + value, 0), lines_deleted: linesDeleted };
}

async function noIndexDiff(before: string | undefined, after: string | undefined, cwd: string): Promise<string> {
  return gitOutput(cwd, ["diff", "--no-index", "--binary", "--no-ext-diff", "--", before ?? nullDevice, after ?? nullDevice]);
}

async function captureCandidateDiff(worktree: string, baseline: string): Promise<string> {
  const [tracked, known] = await Promise.all([
    gitOutput(worktree, ["diff", "--binary", "--no-ext-diff", baseline]),
    trackedFiles(worktree)
  ]);
  const additions = await Promise.all((await files(worktree)).map(async (path) => {
    const name = relative(worktree, path).replace(/\\/g, "/");
    return known.has(name) ? "" : noIndexDiff(undefined, path, worktree);
  }));
  return `${tracked}${additions.join("")}`;
}

async function captureCandidateState(worktree: string, baseline: string, directory: string, statusName: string): Promise<WorktreeStatus> {
  const [diff, status] = await Promise.all([captureCandidateDiff(worktree, baseline), worktreeStatus(worktree, baseline)]);
  await Promise.all([writeFile(join(directory, "candidate.diff"), diff), writeFile(join(directory, statusName), JSON.stringify(status, null, 2))]);
  return status;
}

async function validationSideEffects(snapshot: string, worktree: string): Promise<string> {
  const before = new Map((await files(snapshot)).map((path) => [relative(snapshot, path).replace(/\\/g, "/"), path]));
  const after = new Map((await files(worktree)).map((path) => [relative(worktree, path).replace(/\\/g, "/"), path]));
  const patches: string[] = [];
  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const [oldPath, newPath] = [before.get(name), after.get(name)];
    if (oldPath && newPath && createHash("sha256").update(await readFile(oldPath)).digest("hex") === createHash("sha256").update(await readFile(newPath)).digest("hex")) continue;
    patches.push(await noIndexDiff(oldPath, newPath, worktree));
  }
  return patches.join("");
}

interface ValidationResult {
  args: string[]; working_directory: "<path:worktree>"; started_at: string; completed_at: string; wall_clock_ms: number;
  exit_code: number | null; timeout: boolean; stdout: string; stderr: string; launch_error: string | null;
  failure_classification: "command_failure" | "launch_failure" | "timeout" | null; status: "passed" | "failed";
}

async function runValidation(worktree: string, commands: string[][], timeoutMs: number, arenaRoot: string, artifactDirectory: string): Promise<{ results: ValidationResult[]; wallClockMs: number }> {
  const results: ValidationResult[] = [];
  const started = performance.now();
  const path = `${join(arenaRoot, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`;
  for (const [index, args] of commands.entries()) {
    const command = process.platform === "win32" && args[0] === "npm" ? process.execPath : args[0];
    const commandArgs = process.platform === "win32" && args[0] === "npm"
      ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), ...args.slice(1)] : args.slice(1);
    const stdoutPath = join(artifactDirectory, `validation-${index + 1}-stdout.log`);
    const stderrPath = join(artifactDirectory, `validation-${index + 1}-stderr.log`);
    const execution = await runProcess(command, commandArgs, worktree, timeoutMs, stdoutPath, stderrPath, { env: { ...process.env, PATH: path } });
    const [stdout, stderr] = await Promise.all([readFile(stdoutPath, "utf8").catch(() => ""), readFile(stderrPath, "utf8").catch(() => "")]);
    const failure = execution.timedOut ? "timeout" : execution.launchError ? "launch_failure" : execution.exitCode === 0 ? null : "command_failure";
    results.push({ args, working_directory: "<path:worktree>", started_at: execution.startedAt, completed_at: execution.completedAt, wall_clock_ms: execution.durationMs, exit_code: execution.exitCode, timeout: execution.timedOut, stdout, stderr, launch_error: execution.launchError ?? null, failure_classification: failure, status: failure ? "failed" : "passed" });
  }
  return { results, wallClockMs: Math.round(performance.now() - started) };
}

function prompt(trial: Trial, taskContract = trial.taskContract): string {
  return `${taskContract}\n\nAllowed paths: ${trial.allowedPaths.join(", ")}.\nForbidden paths: ${trial.forbiddenPaths.join(", ")}.\nDo not request human input, change configuration, install dependencies, or use network services. Complete the task in this worktree and report the result.`;
}

async function captureEvents(artifactDirectory: string): Promise<void> {
  const stdout = await readFile(join(artifactDirectory, "stdout.log")).catch(() => Buffer.alloc(0));
  await writeFile(join(artifactDirectory, "raw-events.jsonl"), stdout);
}

async function appendAttemptEvidence(root: string, attemptDirectory: string, attempt: number): Promise<void> {
  const append = async (name: string, separator: boolean) => {
    const content = await readFile(join(attemptDirectory, name), "utf8").catch(() => "");
    if (content) await appendFile(join(root, name), separator ? `\n===== attempt-${attempt} =====\n${content}` : content);
  };
  await append("stdout.log", true); await append("stderr.log", true); await append("raw-events.jsonl", false); await append("final-response.txt", true);
}

function storedExecution(execution: CandidateExecution, hash: string): Record<string, unknown> {
  return { started_at: execution.startedAt, completed_at: execution.completedAt, wall_clock_ms: execution.durationMs, process_exit_code: execution.exitCode, timeout: execution.timedOut, launch_or_transport_error: execution.launchError ?? null, failure_classification: execution.failureKind ?? null, argument_shape: argumentShape(execution.args, hash) };
}

async function writeAttemptExecution(attemptDirectory: string, candidate: Candidate, attempt: number, execution: CandidateExecution, hash: string): Promise<void> {
  await writeFile(join(attemptDirectory, "execution.json"), JSON.stringify({ candidate_id: candidate.id, attempt, adapter: candidate.adapter, task_contract_hash: hash, worktree: "<path:worktree>", ...storedExecution(execution, hash) }, null, 2));
}

async function resetForRetry(worktree: string, baseline: string, attemptDirectory: string): Promise<void> {
  await git(worktree, ["reset", "--hard", baseline]);
  await git(worktree, ["clean", "-fdx"]);
  const status = await worktreeStatus(worktree, baseline);
  const head = await git(worktree, ["rev-parse", "HEAD"]);
  const verification = { baseline, head, ...status, clean: head === baseline && status.changed_paths.length === 0 };
  await writeFile(join(attemptDirectory, "retry-reset.json"), JSON.stringify(verification, null, 2));
  if (!verification.clean) throw new Error("disposable worktree did not return to the baseline before retry");
}

export interface DependencyRecord { package: string; before: { section: string; value: string } | null; after: { section: string; value: string } | null; }
export interface DependencyFacts { package_manifest_changed: boolean; dependency_sections_changed: boolean; lockfile_changed: boolean; semantic_dependency_state_changed: boolean; added: DependencyRecord[]; removed: DependencyRecord[]; changed: DependencyRecord[]; unresolved_comparison: string | null; }
export async function dependencyFacts(worktree: string, baseline: string, status: WorktreeStatus): Promise<DependencyFacts> {
  const packagePath = "package.json";
  const baselinePackage = await gitOutput(worktree, ["show", `${baseline}:${packagePath}`]);
  const candidatePackage = await readFile(join(worktree, packagePath), "utf8").catch(() => undefined);
  const package_manifest_changed = status.tracked_changes.includes(packagePath);
  const lockfile_changed = status.changed_paths.some((path) => /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(path));
  if (!baselinePackage && candidatePackage === undefined) return { package_manifest_changed, dependency_sections_changed: false, lockfile_changed, semantic_dependency_state_changed: false, added: [], removed: [], changed: [], unresolved_comparison: "package.json is unavailable at both baseline and candidate" };
  try {
    const dependencies = (text: string | undefined): Map<string, { section: string; value: string }> => {
      const parsed = JSON.parse(text ?? "{}") as Record<string, unknown>;
      return new Map(["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap((section) => Object.entries((parsed[section] as Record<string, string> | undefined) ?? {}).map(([name, version]) => [name, { section, value: String(version) }])));
    };
    const before = dependencies(baselinePackage);
    const after = dependencies(candidatePackage);
    const added = [...after.keys()].filter((name) => !before.has(name)).sort().map((name) => ({ package: name, before: null, after: after.get(name)! }));
    const removed = [...before.keys()].filter((name) => !after.has(name)).sort().map((name) => ({ package: name, before: before.get(name)!, after: null }));
    const changed = [...before.keys()].filter((name) => after.has(name) && (before.get(name)!.section !== after.get(name)!.section || before.get(name)!.value !== after.get(name)!.value)).sort().map((name) => ({ package: name, before: before.get(name)!, after: after.get(name)! }));
    const dependency_sections_changed = changed.some((item) => item.before!.section !== item.after!.section) || package_manifest_changed && (added.length > 0 || removed.length > 0 || changed.length > 0);
    return { package_manifest_changed, dependency_sections_changed, lockfile_changed, semantic_dependency_state_changed: added.length > 0 || removed.length > 0 || changed.length > 0, added, removed, changed, unresolved_comparison: null };
  } catch (error) { return { package_manifest_changed, dependency_sections_changed: false, lockfile_changed, semantic_dependency_state_changed: false, added: [], removed: [], changed: [], unresolved_comparison: error instanceof Error ? error.message : String(error) }; }
}

interface Gate { id: string; status: GateStatus; reason: string; evidence_references: string[]; observed_values: Record<string, unknown>; }
interface Artifact { path: string; status: "present" | "missing" | "unavailable" | "not_applicable"; reason?: string; }
export interface InterventionFacts { manual_prompt_corrections: number; manual_file_edits: number; aborts: number; permission_denials: Metric<number>; user_questions: Metric<number>; }
export function interventionGate(policy: Trial["manualIntervention"], facts: InterventionFacts, retryCount: number): Gate {
  const observed_values = { ...facts, transport_retries: retryCount };
  if (policy !== "forbidden") return { id: "intervention_policy", status: "unavailable", reason: "unsupported intervention policy", observed_values, evidence_references: ["provenance.json", "raw-events.jsonl"] };
  if (facts.manual_prompt_corrections > 0 || facts.manual_file_edits > 0 || facts.aborts > 0 || facts.permission_denials.value !== null && facts.permission_denials.value > 0 || facts.user_questions.value !== null && facts.user_questions.value > 0) return { id: "intervention_policy", status: "failed", reason: "prohibited intervention was observed", observed_values, evidence_references: ["provenance.json", "raw-events.jsonl"] };
  if (facts.permission_denials.availability === "unavailable" || facts.user_questions.availability === "unavailable") return { id: "intervention_policy", status: "unavailable", reason: "native intervention evidence is unavailable", observed_values, evidence_references: ["provenance.json", "raw-events.jsonl"] };
  return { id: "intervention_policy", status: "passed", reason: "no prohibited intervention was observed", observed_values, evidence_references: ["provenance.json", "raw-events.jsonl"] };
}
const portableRelative = (value: unknown): value is string => typeof value === "string" && value.length > 0 && !/^(?:[A-Za-z]:)?[\\/]/.test(value) && !value.split(/[\\/]/).includes("..");
export function phase3PacketReady(packet: { telemetry: unknown; validation: unknown; artifactDirectory: unknown }): boolean {
  const telemetry = packet.telemetry as Record<string, unknown> | null;
  const validation = packet.validation as Record<string, unknown> | null;
  const provenance = telemetry?.provenance as Record<string, unknown> | undefined;
  const evidence = telemetry?.evidence_completeness as Record<string, unknown> | undefined;
  return Boolean(telemetry && validation && telemetry.finalization_status === "complete" && Array.isArray(telemetry.hard_gates) && telemetry.hard_gates.length > 0 && evidence?.status === "complete" && Array.isArray(evidence.artifacts) && Array.isArray(validation.commands) && provenance?.task_contract_hash && provenance.configuration_hash && portableRelative(packet.artifactDirectory));
}
async function candidatePacketReady(directory: string, relativeDirectory: string): Promise<boolean> {
  const [telemetry, validation] = await Promise.all([readFile(join(directory, "telemetry.json"), "utf8").then(JSON.parse).catch(() => null), readFile(join(directory, "validation.json"), "utf8").then(JSON.parse).catch(() => null)]);
  return phase3PacketReady({ telemetry, validation, artifactDirectory: relativeDirectory });
}

async function artifactInventory(directory: string, attempts: CandidateAttemptResult[], execution: CandidateExecution): Promise<Artifact[]> {
  const names = ["provenance.json", "raw-events.jsonl", "raw-telemetry.json", "telemetry.json", "stdout.log", "stderr.log", "final-response.txt", "candidate.diff", "validation.json", "pre-validation-status.json", "post-validation-status.json", "validation-side-effects.diff"];
  const artifacts = await Promise.all(names.map(async (path) => ({ path, status: await readFile(join(directory, path)).then(() => "present" as const).catch(() => path === "final-response.txt" && execution.failureKind === "launch" ? "not_applicable" as const : "missing" as const) })));
  artifacts.push({ path: "attempts", status: attempts.length ? "present" : "missing" });
  return artifacts;
}

function gatesFor(input: { trial: Trial; validation: ValidationResult[]; forbidden: string[]; dependencies: DependencyFacts; recoverable: boolean; changed: boolean; execution: CandidateExecution; artifacts: Artifact[]; acceptance?: FractionalPriceAcceptance; retryCount: number; intervention: InterventionFacts; }): Gate[] {
  const validationComplete = input.validation.length > 0 && input.validation.every((item) => item.started_at && item.completed_at);
  const validationPassed = validationComplete && input.validation.every((item) => item.status === "passed");
  const dependency = input.trial.dependencyPolicy === "allow_changes" ? "passed" : input.dependencies.lockfile_changed || input.dependencies.semantic_dependency_state_changed ? "failed" : input.dependencies.unresolved_comparison ? "unavailable" : "passed";
  const evidence = input.artifacts.every((item) => item.status === "present" || item.status === "not_applicable") ? "passed" : "failed";
  const acceptance = !input.acceptance || input.acceptance.status === "not_applicable" ? "unavailable" : input.acceptance.status;
  const make = (id: string, status: GateStatus, reason: string, observed_values: Record<string, unknown>, evidence_references: string[]): Gate => ({ id, status, reason, observed_values, evidence_references });
  return [
    make("required_validation_completed", validationComplete ? "passed" : "failed", validationComplete ? "all configured commands completed" : "one or more configured commands did not complete", { count: input.validation.length }, ["validation.json"]),
    make("required_validation_passed", validationPassed ? "passed" : "failed", validationPassed ? "all configured commands passed" : "one or more configured commands failed", { results: input.validation.map((item) => item.status) }, ["validation.json"]),
    make("allowed_path_policy", input.forbidden.length ? "failed" : "passed", input.forbidden.length ? "candidate changed forbidden paths" : "candidate changes are within allowed paths", { forbidden_paths: input.forbidden }, ["pre-validation-status.json", "candidate.diff"]),
    make("dependency_policy", dependency, dependency === "passed" ? "dependency policy satisfied" : dependency === "unavailable" ? "dependency comparison unavailable" : "dependency changes are prohibited", { ...input.dependencies }, ["pre-validation-status.json"]),
    make("worktree_recoverable", input.recoverable ? "passed" : "failed", input.recoverable ? "Git worktree and baseline remain readable" : "Git worktree recovery prerequisites failed", {}, ["pre-validation-status.json"]),
    make("nonempty_candidate_result", input.changed ? "passed" : "failed", input.changed ? "candidate produced a pre-validation change" : "candidate produced no pre-validation change", { changed: input.changed }, ["candidate.diff"]),
    make("process_timeout", input.execution.timedOut ? "failed" : "passed", input.execution.timedOut ? "candidate process timed out" : "candidate process did not time out", { timeout: input.execution.timedOut }, ["execution.json"]),
    make("required_evidence_complete", evidence, evidence === "passed" ? "required evidence inventory is complete" : "required evidence inventory is incomplete", { artifacts: input.artifacts }, ["telemetry.json"]),
    interventionGate(input.trial.manualIntervention, input.intervention, input.retryCount),
    make("acceptance_validator", acceptance, acceptance === "passed" ? "acceptance validator passed" : acceptance === "unavailable" ? "acceptance validator is not applicable" : "acceptance validator failed", { status: input.acceptance?.status ?? "not_applicable" }, ["acceptance.json"])
  ];
}

interface CandidateRunOptions { taskContract?: string; validationCommands?: string[][]; acceptance?: boolean; }

async function candidateRun(trial: Trial, candidate: Candidate, repository: string, baseline: string, runDirectory: string, adapter: CandidateAdapter, options: CandidateRunOptions = {}): Promise<CandidateResult> {
  const pipelineStarted = performance.now();
  const artifactDirectory = join(runDirectory, "candidates", candidate.id);
  const attemptsDirectory = join(artifactDirectory, "attempts");
  const worktree = join(artifactDirectory, "worktree");
  const contract = options.taskContract ?? trial.taskContract;
  const hash = taskContractHash(contract);
  await mkdir(attemptsDirectory, { recursive: true });
  await git(repository, ["worktree", "add", "--detach", worktree, baseline]);
  await Promise.all(["stdout.log", "stderr.log", "raw-events.jsonl", "final-response.txt"].map((name) => writeFile(join(artifactDirectory, name), "")));

  const attempts: CandidateAttemptResult[] = [];
  let retryResetMs = 0;
  while (true) {
    const attempt = attempts.length + 1;
    const attemptDirectory = join(attemptsDirectory, `attempt-${attempt}`);
    await mkdir(attemptDirectory, { recursive: true });
    const execution = await adapter.execute({ candidate, worktree, artifactDirectory: attemptDirectory, prompt: prompt(trial, contract), timeoutMs: trial.timeoutMs });
    await captureEvents(attemptDirectory);
    await writeAttemptExecution(attemptDirectory, candidate, attempt, execution, hash);
    await captureCandidateState(worktree, baseline, attemptDirectory, "status.json");
    await appendAttemptEvidence(artifactDirectory, attemptDirectory, attempt);
    attempts.push({ attempt, directory: attemptDirectory, execution });
    if (!(execution.failureKind === "launch" || execution.failureKind === "transport") || attempts.length > trial.maxLaunchTransportRetries) break;
    const resetStarted = performance.now();
    await resetForRetry(worktree, baseline, attemptDirectory);
    retryResetMs += performance.now() - resetStarted;
  }

  const execution = attempts.at(-1)!.execution;
  const preValidation = await captureCandidateState(worktree, baseline, artifactDirectory, "pre-validation-status.json");
  const snapshot = join(artifactDirectory, "pre-validation-worktree");
  await cp(worktree, snapshot, { recursive: true, filter: (path) => basename(path) !== ".git" });
  const validationRun = await runValidation(worktree, options.validationCommands ?? trial.validationCommands, trial.validationTimeoutMs, resolve(__dirname, "..", ".."), artifactDirectory);
  const validation = validationRun.results;
  const acceptance: FractionalPriceAcceptance | undefined = options.acceptance === false ? undefined : await validateFractionalPrice(worktree, artifactDirectory);
  const postValidation = await worktreeStatus(worktree, baseline);
  const sideEffects = await validationSideEffects(snapshot, worktree);
  await Promise.all([
    writeFile(join(artifactDirectory, "validation.json"), JSON.stringify({ schema_version: telemetrySchemaVersion, commands: validation, wall_clock_ms: validationRun.wallClockMs }, null, 2)),
    writeFile(join(artifactDirectory, "post-validation-status.json"), JSON.stringify(postValidation, null, 2)),
    writeFile(join(artifactDirectory, "validation-side-effects.diff"), sideEffects)
  ]);
  await rm(snapshot, { recursive: true, force: true });
  const forbiddenChanges = preValidation.changed_paths.filter((path) => pathAllowed(path, trial.forbiddenPaths) || !pathAllowed(path, trial.allowedPaths));
  const validationForbiddenChanges = postValidation.changed_paths.filter((path) => pathAllowed(path, trial.forbiddenPaths) || !pathAllowed(path, trial.allowedPaths));
  const dependencies = await dependencyFacts(worktree, baseline, preValidation);
  const recoverable = (await git(worktree, ["rev-parse", "--is-inside-work-tree"]).catch(() => "false")) === "true" && Boolean(await git(worktree, ["rev-parse", "--verify", `${baseline}^{commit}`]).catch(() => ""));
  await writeFile(join(artifactDirectory, "provenance.json"), JSON.stringify({ trial_id: trial.id, candidate_id: candidate.id, task_contract_hash: hash, baseline_commit: baseline, adapter: candidate.adapter, harness: candidate.harness, provider: candidate.provider ?? null, model: candidate.model, attention: candidate.attention ?? null, agent: candidate.agent ?? null, profile: candidate.profile ?? null, permission_policy: candidate.adapter === "codex-exec" ? { approval_policy: "never", sandbox_mode: "workspace-write" } : openCodePermissionConfig, adapter_execution: { executable: execution.adapterProvenance?.executable ?? null, configuration_isolation: execution.adapterProvenance?.configuration_isolation ?? null, ambient: execution.adapterProvenance?.ambient ?? null, arguments: argumentShape(execution.args, hash) }, trial_provenance: trial.provenance, candidate_tool_provenance: candidate.toolProvenance ?? null }, null, 2));

  const summary: Record<string, unknown> = { candidate_id: candidate.id, adapter: candidate.adapter, task_contract_hash: hash, argument_shape: argumentShape(execution.args, hash), started_at: attempts[0].execution.startedAt, completed_at: execution.completedAt, wall_clock_ms: attempts.reduce((total, item) => total + item.execution.durationMs, 0), process_exit_code: execution.exitCode, timeout: execution.timedOut, launch_or_transport_error: execution.launchError ?? null, failure_classification: execution.failureKind ?? null, retry_count: attempts.length - 1, worktree: "<path:worktree>", changed_paths: preValidation.changed_paths, forbidden_path_changes: forbiddenChanges, validation_forbidden_path_changes: validationForbiddenChanges, dependency_facts: dependencies, acceptance_validation: acceptance ?? null, validation, validation_side_effects: sideEffects.length > 0, attempts: attempts.map((item) => ({ attempt: item.attempt, directory: `attempts/attempt-${item.attempt}`, execution: storedExecution(item.execution, hash) })), artifact_availability: {} };
  const executionPath = join(artifactDirectory, "execution.json");
  await writeFile(executionPath, JSON.stringify(summary, null, 2));
  const availability: Record<string, boolean> = {};
  for (const name of ["provenance.json", "raw-events.jsonl", "raw-telemetry.json", "telemetry.json", "stdout.log", "stderr.log", "final-response.txt", "candidate.diff", "pre-validation-status.json", "validation.json", "post-validation-status.json", "validation-side-effects.diff", "acceptance.json", "execution.json"]) availability[name] = await readFile(join(artifactDirectory, name)).then(() => true).catch(() => false);
  for (const attempt of attempts) for (const name of ["opencode-config.json", "raw-events.jsonl", "stdout.log", "stderr.log", "final-response.txt", "candidate.diff", "status.json", "execution.json", "retry-reset.json"]) availability[`attempts/attempt-${attempt.attempt}/${name}`] = await readFile(join(attempt.directory, name)).then(() => true).catch(() => false);
  summary.artifact_availability = availability;
  await writeFile(executionPath, JSON.stringify(summary, null, 2));
  const rawTelemetry = extractNativeTelemetry(candidate.harness, await readFile(join(artifactDirectory, "raw-events.jsonl"), "utf8").catch(() => ""));
  await writeFile(join(artifactDirectory, "raw-telemetry.json"), JSON.stringify(rawTelemetry, null, 2));
  await writeFile(join(artifactDirectory, "telemetry.json"), JSON.stringify({ schema_version: telemetrySchemaVersion, finalization_status: "pending" }, null, 2));
  const artifacts = await artifactInventory(artifactDirectory, attempts, execution);
  const native = rawTelemetry.extracted;
  const intervention = { manual_prompt_corrections: 0, manual_file_edits: 0, aborts: 0, permission_denials: execution.failureKind === "permission" ? available(1) : native.permission_denials as Metric<number>, user_questions: native.user_questions as Metric<number> };
  const humanInterventionCount = intervention.permission_denials.availability === "available" && intervention.user_questions.availability === "available"
    ? available(intervention.manual_prompt_corrections + intervention.manual_file_edits + intervention.aborts + intervention.permission_denials.value! + intervention.user_questions.value!)
    : unavailable<number>("intervention-evidence-unavailable");
  const gates = gatesFor({ trial, validation, forbidden: forbiddenChanges, dependencies, recoverable, changed: preValidation.changed_paths.length > 0, execution, artifacts, acceptance, retryCount: attempts.length - 1, intervention });
  const hardGateStatus = aggregateGateStatus(gates.map((gate) => gate.status));
  const telemetry = {
    schema_version: telemetrySchemaVersion,
    finalization_status: "complete",
    provenance: { trial_id: trial.id, run_id: basename(runDirectory), candidate_id: candidate.id, task_contract_hash: hash, baseline_commit: baseline, adapter: candidate.adapter, harness: candidate.harness, provider: candidate.provider ?? null, model: candidate.model, attention: candidate.attention ?? null, agent: candidate.agent ?? null, profile: candidate.profile ?? null, configuration_hash: configurationHash(candidate, trial), started_at: attempts[0].execution.startedAt, completed_at: execution.completedAt },
    execution: { status: execution.failureKind ?? (execution.exitCode === 0 ? "completed" : "failed"), wall_clock_ms: available(attempts.reduce((total, item) => total + item.execution.durationMs, 0)), attempt_execution_ms: available(execution.durationMs), retry_overhead_ms: available(Math.round(retryResetMs + attempts.slice(0, -1).reduce((total, item) => total + item.execution.durationMs, 0))), validation_wall_clock_ms: available(validationRun.wallClockMs), total_pipeline_ms: available(Math.round(performance.now() - pipelineStarted)), process_exit_code: execution.exitCode === null ? unavailable<number>() : available(execution.exitCode), process_timeout: available(execution.timedOut), turn_count: native.turn_count, tool_call_count: native.tool_call_count, command_count: native.command_count, retry_count: available(attempts.length - 1), approval_count: native.approval_count, human_intervention_count: humanInterventionCount, error_count: native.error_count },
    usage: { input_tokens: native.input_tokens, cached_input_tokens: native.cached_input_tokens, uncached_input_tokens: unavailable<number>(), output_tokens: native.output_tokens, provider_reported_cost: native.provider_reported_cost, provider_reported_currency: unavailable<string>(), estimated_cost: unavailable<number>(), estimated_cost_currency: unavailable<string>(), subscription_consumption: unavailable<string>(), quota_percent_before: unavailable<number>(), quota_percent_after: unavailable<number>(), usage_source: available(`${candidate.harness}-jsonl`, "native") },
    intervention: { permission_requests: native.approval_count, permission_denials: intervention.permission_denials, user_questions: intervention.user_questions, manual_prompt_corrections: available(0), manual_file_edits: available(0), aborts: available(0), transport_retries: available(attempts.length - 1) },
    output: { files_changed: available(preValidation.changed_paths.length), lines_added: available(preValidation.lines_added), lines_deleted: available(preValidation.lines_deleted), dependencies_added: dependencies.unresolved_comparison ? unavailable<string[]>() : available(dependencies.added), dependencies_removed: dependencies.unresolved_comparison ? unavailable<string[]>() : available(dependencies.removed), untracked_files: available(preValidation.untracked_paths), validation_pass_count: available(validation.filter((item) => item.status === "passed").length), validation_fail_count: available(validation.filter((item) => item.status === "failed").length), hard_gate_status: available(hardGateStatus) },
    change_analysis: { pre_validation: preValidation, validation_side_effects: { present: sideEffects.length > 0, forbidden_paths: validationForbiddenChanges }, dependencies },
    hard_gates: gates,
    evidence_completeness: { status: artifacts.every((item) => item.status === "present" || item.status === "not_applicable") ? "complete" : "incomplete", artifacts }
  };
  await writeFile(join(artifactDirectory, "telemetry.json"), JSON.stringify(telemetry, null, 2));
  return { candidateId: candidate.id, directory: artifactDirectory, execution, retryCount: attempts.length - 1, attempts, hardGateStatus };
}

export async function runTrial(trial: Trial, adapters: Map<string, CandidateAdapter>, outputDirectory?: string): Promise<RunResult> {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const repository = resolve(trial.repository);
  const baseline = await git(repository, ["rev-parse", trial.baselineRef]);
  const directory = outputDirectory ? resolve(outputDirectory) : resolve("runs", `${trial.id}-${stamp()}`);
  await mkdir(join(directory, "candidates"), { recursive: true });
  const snapshot = trialSnapshot(trial);
  const snapshotHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  await writeFile(join(directory, "trial-snapshot.json"), JSON.stringify(snapshot, null, 2));
  const candidates: CandidateResult[] = [];
  for (const candidate of trial.candidates) {
    const adapter = adapters.get(candidate.adapter);
    if (!adapter) throw new Error(`no adapter registered for ${candidate.adapter}`);
    candidates.push(await candidateRun(trial, candidate, repository, baseline, directory, adapter));
  }
  const completedAt = new Date().toISOString();
  const candidatePackets = await Promise.all(candidates.map(async (result) => ({ result, artifactDirectory: `candidates/${result.candidateId}`, ready: await candidatePacketReady(result.directory, `candidates/${result.candidateId}`) })));
  const manifest = { schema_version: telemetrySchemaVersion, run_id: basename(directory), trial_id: trial.id, comparison_mode: "practical-configuration-comparison", run_status: "completed", started_at: startedAt, completed_at: completedAt, total_pipeline_ms: Math.round(performance.now() - started), arena_git_commit: await git(process.cwd(), ["rev-parse", "HEAD"]).catch(() => null), baseline_commit: baseline, task_contract_hash: taskContractHash(trial.taskContract), normalized_trial_snapshot_hash: snapshotHash, candidate_count: trial.candidates.length, candidates: candidatePackets.map(({ result, artifactDirectory, ready }) => ({ candidate_id: result.candidateId, configuration_hash: configurationHash(trial.candidates.find((candidate) => candidate.id === result.candidateId)!, trial), artifact_directory: artifactDirectory, completion_status: result.execution.failureKind ?? (result.execution.exitCode === 0 ? "completed" : "failed"), hard_gate_status: result.hardGateStatus ?? "unavailable", evidence_completeness: `${artifactDirectory}/telemetry.json`, deterministic_packet_ready: ready })), manifest_finalization_status: "complete", phase_3_readiness: candidatePackets.every((candidate) => candidate.ready) ? "ready_for_audit" : "not_ready" };
  await Promise.all([
    writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2)),
    writeFile(join(directory, "run.json"), JSON.stringify({ compatibility: "secondary; use manifest.json", trial_id: trial.id, baseline, candidate_count: trial.candidates.length, task_contract_hash: taskContractHash(trial.taskContract), candidates: candidates.map((candidate) => ({ id: candidate.candidateId, directory: basename(candidate.directory) })) }, null, 2))
  ]);
  return { directory, candidates };
}

export async function runDiagnostic(trial: Trial, candidateId: string, adapters: Map<string, CandidateAdapter>, outputDirectory?: string): Promise<DiagnosticResult> {
  const candidate = trial.candidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error(`unknown candidate: ${candidateId}`);
  const adapter = adapters.get(candidate.adapter);
  if (!adapter) throw new Error(`no adapter registered for ${candidate.adapter}`);
  const repository = resolve(trial.repository);
  const baseline = await git(repository, ["rev-parse", trial.baselineRef]);
  const directory = outputDirectory ? resolve(outputDirectory) : resolve("runs", `${trial.id}-diagnostic-${candidateId}-${stamp()}`);
  await mkdir(join(directory, "candidates"), { recursive: true });
  const taskContract = "Create only fixtures/bounded-inventory/src/arena-write-probe.txt containing exactly phase1-write-probe followed by a newline, then terminate.";
  const diagnosticTrial = { ...trial, timeoutMs: Math.min(trial.timeoutMs, 60_000) };
  const result = await candidateRun(diagnosticTrial, candidate, repository, baseline, directory, adapter, { taskContract, validationCommands: [], acceptance: false });
  const [marker, record] = await Promise.all([
    readFile(join(result.directory, "worktree", "fixtures", "bounded-inventory", "src", "arena-write-probe.txt"), "utf8").catch(() => undefined),
    readFile(join(result.directory, "execution.json"), "utf8").then((text) => JSON.parse(text) as { forbidden_path_changes: string[]; validation_side_effects: boolean })
  ]);
  const passed = marker === "phase1-write-probe\n" && result.execution.exitCode === 0 && !result.execution.timedOut && !result.execution.failureKind && record.forbidden_path_changes.length === 0 && !record.validation_side_effects;
  const diagnosticPath = join(directory, "diagnostic.json");
  await writeFile(diagnosticPath, JSON.stringify({ candidate_id: candidate.id, baseline, passed, marker: marker === "phase1-write-probe\n", clean_termination: result.execution.exitCode === 0 && !result.execution.timedOut && !result.execution.failureKind, forbidden_path_changes: record.forbidden_path_changes, validation_side_effects: record.validation_side_effects }, null, 2));
  return { directory, candidate: result, passed, diagnosticPath };
}
