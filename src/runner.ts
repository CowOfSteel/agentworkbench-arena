import { createHash } from "node:crypto";
import { appendFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, delimiter, dirname, join, relative, resolve } from "node:path";
import { CandidateAdapter, CandidateExecution, argumentShape, openCodePermissionConfig } from "./adapters";
import { FractionalPriceAcceptance, validateFractionalPrice } from "./acceptance";
import { Candidate, Trial } from "./trial";

const exec = promisify(execFile);
const git = async (repository: string, args: string[]): Promise<string> => (await exec("git", args, { cwd: repository, shell: false })).stdout.trim();
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const pathAllowed = (path: string, prefixes: string[]) => prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
const taskContractHash = (taskContract: string) => createHash("sha256").update(taskContract).digest("hex");
const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";

export interface CandidateAttemptResult { attempt: number; directory: string; execution: CandidateExecution; }
export interface CandidateResult { candidateId: string; directory: string; execution: CandidateExecution; retryCount: number; attempts: CandidateAttemptResult[]; }
export interface RunResult { directory: string; candidates: CandidateResult[]; }
export interface DiagnosticResult { directory: string; candidate: CandidateResult; passed: boolean; diagnosticPath: string; }

interface WorktreeStatus {
  git_status: string;
  changed_paths: string[];
  tracked_changes: string[];
  untracked_or_ignored_paths: string[];
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
  const [status, tracked, known] = await Promise.all([
    gitOutput(worktree, ["status", "--porcelain=v1", "--ignored", "--untracked-files=all"]),
    gitOutput(worktree, ["diff", "--name-only", baseline]),
    trackedFiles(worktree)
  ]);
  const all = await files(worktree);
  const untracked = all.map((path) => relative(worktree, path).replace(/\\/g, "/")).filter((path) => !known.has(path));
  const trackedChanges = tracked.split(/\r?\n/).filter(Boolean);
  return { git_status: status, changed_paths: [...new Set([...trackedChanges, ...untracked])].sort(), tracked_changes: trackedChanges, untracked_or_ignored_paths: untracked.sort() };
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

async function runValidation(worktree: string, commands: string[][], arenaRoot: string): Promise<Array<{ args: string[]; exitCode: number | null; error?: string }>> {
  const results: Array<{ args: string[]; exitCode: number | null; error?: string }> = [];
  const path = `${join(arenaRoot, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`;
  for (const args of commands) {
    const command = process.platform === "win32" && args[0] === "npm" ? process.execPath : args[0];
    const commandArgs = process.platform === "win32" && args[0] === "npm"
      ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), ...args.slice(1)] : args.slice(1);
    try { await exec(command, commandArgs, { cwd: worktree, shell: false, env: { ...process.env, PATH: path } }); results.push({ args, exitCode: 0 }); }
    catch (error) { const failure = error as { code?: number; message: string }; results.push({ args, exitCode: typeof failure.code === "number" ? failure.code : null, error: failure.message }); }
  }
  return results;
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

interface CandidateRunOptions { taskContract?: string; validationCommands?: string[][]; acceptance?: boolean; }

async function candidateRun(trial: Trial, candidate: Candidate, repository: string, baseline: string, runDirectory: string, adapter: CandidateAdapter, options: CandidateRunOptions = {}): Promise<CandidateResult> {
  const artifactDirectory = join(runDirectory, "candidates", candidate.id);
  const attemptsDirectory = join(artifactDirectory, "attempts");
  const worktree = join(artifactDirectory, "worktree");
  const contract = options.taskContract ?? trial.taskContract;
  const hash = taskContractHash(contract);
  await mkdir(attemptsDirectory, { recursive: true });
  await git(repository, ["worktree", "add", "--detach", worktree, baseline]);
  await Promise.all(["stdout.log", "stderr.log", "raw-events.jsonl", "final-response.txt"].map((name) => writeFile(join(artifactDirectory, name), "")));

  const attempts: CandidateAttemptResult[] = [];
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
    await resetForRetry(worktree, baseline, attemptDirectory);
  }

  const execution = attempts.at(-1)!.execution;
  const preValidation = await captureCandidateState(worktree, baseline, artifactDirectory, "pre-validation-status.json");
  const snapshot = join(artifactDirectory, "pre-validation-worktree");
  await cp(worktree, snapshot, { recursive: true, filter: (path) => basename(path) !== ".git" });
  const validation = await runValidation(worktree, options.validationCommands ?? trial.validationCommands, resolve(__dirname, "..", ".."));
  const acceptance: FractionalPriceAcceptance | undefined = options.acceptance === false ? undefined : await validateFractionalPrice(worktree, artifactDirectory);
  const postValidation = await worktreeStatus(worktree, baseline);
  const sideEffects = await validationSideEffects(snapshot, worktree);
  await Promise.all([
    writeFile(join(artifactDirectory, "validation.json"), JSON.stringify(validation, null, 2)),
    writeFile(join(artifactDirectory, "post-validation-status.json"), JSON.stringify(postValidation, null, 2)),
    writeFile(join(artifactDirectory, "validation-side-effects.diff"), sideEffects)
  ]);
  await rm(snapshot, { recursive: true, force: true });
  const forbiddenChanges = preValidation.changed_paths.filter((path) => pathAllowed(path, trial.forbiddenPaths) || !pathAllowed(path, trial.allowedPaths));
  const validationForbiddenChanges = postValidation.changed_paths.filter((path) => pathAllowed(path, trial.forbiddenPaths) || !pathAllowed(path, trial.allowedPaths));
  await writeFile(join(artifactDirectory, "provenance.json"), JSON.stringify({ trial_id: trial.id, candidate_id: candidate.id, task_contract_hash: hash, baseline_commit: baseline, adapter: candidate.adapter, harness: candidate.harness, provider: candidate.provider ?? null, model: candidate.model, attention: candidate.attention ?? null, agent: candidate.agent ?? null, profile: candidate.profile ?? null, permission_policy: candidate.adapter === "codex-exec" ? { approval_policy: "never", sandbox_mode: "workspace-write" } : openCodePermissionConfig, adapter_execution: { executable: execution.adapterProvenance?.executable ?? null, arguments: argumentShape(execution.args, hash) }, trial_provenance: trial.provenance, candidate_tool_provenance: candidate.toolProvenance ?? null }, null, 2));

  const summary: Record<string, unknown> = { candidate_id: candidate.id, adapter: candidate.adapter, task_contract_hash: hash, argument_shape: argumentShape(execution.args, hash), started_at: attempts[0].execution.startedAt, completed_at: execution.completedAt, wall_clock_ms: attempts.reduce((total, item) => total + item.execution.durationMs, 0), process_exit_code: execution.exitCode, timeout: execution.timedOut, launch_or_transport_error: execution.launchError ?? null, failure_classification: execution.failureKind ?? null, retry_count: attempts.length - 1, worktree: "<path:worktree>", changed_paths: preValidation.changed_paths, forbidden_path_changes: forbiddenChanges, validation_forbidden_path_changes: validationForbiddenChanges, acceptance_validation: acceptance ?? null, validation, validation_side_effects: sideEffects.length > 0, attempts: attempts.map((item) => ({ attempt: item.attempt, directory: `attempts/attempt-${item.attempt}`, execution: storedExecution(item.execution, hash) })), artifact_availability: {} };
  const executionPath = join(artifactDirectory, "execution.json");
  await writeFile(executionPath, JSON.stringify(summary, null, 2));
  const availability: Record<string, boolean> = {};
  for (const name of ["provenance.json", "raw-events.jsonl", "stdout.log", "stderr.log", "final-response.txt", "candidate.diff", "pre-validation-status.json", "validation.json", "post-validation-status.json", "validation-side-effects.diff", "acceptance.json", "execution.json"]) availability[name] = await readFile(join(artifactDirectory, name)).then(() => true).catch(() => false);
  for (const attempt of attempts) for (const name of ["opencode-config.json", "raw-events.jsonl", "stdout.log", "stderr.log", "final-response.txt", "candidate.diff", "status.json", "execution.json", "retry-reset.json"]) availability[`attempts/attempt-${attempt.attempt}/${name}`] = await readFile(join(attempt.directory, name)).then(() => true).catch(() => false);
  if (candidate.adapter === "codex-exec") for (const attempt of attempts) availability[`attempts/attempt-${attempt.attempt}/codex-home/config.toml`] = await readFile(join(attempt.directory, "codex-home", "config.toml")).then(() => true).catch(() => false);
  summary.artifact_availability = availability;
  await writeFile(executionPath, JSON.stringify(summary, null, 2));
  return { candidateId: candidate.id, directory: artifactDirectory, execution, retryCount: attempts.length - 1, attempts };
}

export async function runTrial(trial: Trial, adapters: Map<string, CandidateAdapter>, outputDirectory?: string): Promise<RunResult> {
  const repository = resolve(trial.repository);
  const baseline = await git(repository, ["rev-parse", trial.baselineRef]);
  const directory = outputDirectory ? resolve(outputDirectory) : resolve("runs", `${trial.id}-${stamp()}`);
  await mkdir(join(directory, "candidates"), { recursive: true });
  const candidates: CandidateResult[] = [];
  for (const candidate of trial.candidates) {
    const adapter = adapters.get(candidate.adapter);
    if (!adapter) throw new Error(`no adapter registered for ${candidate.adapter}`);
    candidates.push(await candidateRun(trial, candidate, repository, baseline, directory, adapter));
  }
  await writeFile(join(directory, "run.json"), JSON.stringify({ trial_id: trial.id, baseline, candidate_count: trial.candidates.length, task_contract_hash: taskContractHash(trial.taskContract), candidates: candidates.map((candidate) => ({ id: candidate.candidateId, directory: basename(candidate.directory) })) }, null, 2));
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
