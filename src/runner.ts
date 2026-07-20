import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { CandidateAdapter, CandidateExecution, argumentShape, openCodePermissionConfig } from "./adapters";
import { validateFractionalPrice } from "./acceptance";
import { Candidate, Trial } from "./trial";

const exec = promisify(execFile);
const git = async (repository: string, args: string[]): Promise<string> => (await exec("git", args, { cwd: repository, shell: false })).stdout.trim();
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const pathAllowed = (path: string, prefixes: string[]) => prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
const taskContractHash = (taskContract: string) => createHash("sha256").update(taskContract).digest("hex");

export interface CandidateAttemptResult { attempt: number; directory: string; execution: CandidateExecution; }
export interface CandidateResult { candidateId: string; directory: string; execution: CandidateExecution; retryCount: number; attempts: CandidateAttemptResult[]; }
export interface RunResult { directory: string; candidates: CandidateResult[]; }

async function collectPaths(worktree: string, baseline: string): Promise<string[]> {
  await git(worktree, ["add", "-N", "--all"]);
  const output = await git(worktree, ["diff", "--name-only", baseline]);
  return output ? output.split(/\r?\n/) : [];
}

async function collectDiff(worktree: string, baseline: string, artifactDirectory: string): Promise<void> {
  await git(worktree, ["add", "-N", "--all"]);
  const { stdout } = await exec("git", ["diff", "--binary", "--no-ext-diff", baseline], { cwd: worktree, shell: false, maxBuffer: 10 * 1024 * 1024 });
  await writeFile(join(artifactDirectory, "final.diff"), stdout);
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

function prompt(trial: Trial): string {
  return `${trial.taskContract}\n\nAllowed paths: ${trial.allowedPaths.join(", ")}.\nForbidden paths: ${trial.forbiddenPaths.join(", ")}.\nDo not request human input, change configuration, install dependencies, or use network services. Complete the task in this worktree and report the result.`;
}

async function captureEvents(artifactDirectory: string): Promise<void> {
  const stdout = await readFile(join(artifactDirectory, "stdout.log")).catch(() => Buffer.alloc(0));
  await writeFile(join(artifactDirectory, "raw-events.jsonl"), stdout);
}

async function appendAttemptEvidence(root: string, attemptDirectory: string, attempt: number): Promise<void> {
  const append = async (name: string, separator: boolean) => {
    const content = await readFile(join(attemptDirectory, name), "utf8").catch(() => "");
    if (!content) return;
    await appendFile(join(root, name), separator ? `\n===== attempt-${attempt} =====\n${content}` : content);
  };
  await append("stdout.log", true);
  await append("stderr.log", true);
  await append("raw-events.jsonl", false);
  await append("final-response.txt", true);
}

function storedExecution(execution: CandidateExecution, hash: string): Record<string, unknown> {
  return {
    started_at: execution.startedAt,
    completed_at: execution.completedAt,
    wall_clock_ms: execution.durationMs,
    process_exit_code: execution.exitCode,
    timeout: execution.timedOut,
    launch_or_transport_error: execution.launchError ?? null,
    failure_classification: execution.failureKind ?? null,
    argument_shape: argumentShape(execution.args, hash)
  };
}

async function writeAttemptExecution(attemptDirectory: string, candidate: Candidate, attempt: number, execution: CandidateExecution, hash: string): Promise<void> {
  await writeFile(join(attemptDirectory, "execution.json"), JSON.stringify({
    candidate_id: candidate.id,
    attempt,
    adapter: candidate.adapter,
    task_contract_hash: hash,
    worktree: "<path:worktree>",
    ...storedExecution(execution, hash)
  }, null, 2));
}

function executionFromRecord(record: Record<string, unknown>): CandidateExecution {
  return {
    args: [],
    startedAt: typeof record.started_at === "string" ? record.started_at : "",
    completedAt: typeof record.completed_at === "string" ? record.completed_at : "",
    durationMs: typeof record.wall_clock_ms === "number" ? record.wall_clock_ms : 0,
    exitCode: typeof record.process_exit_code === "number" ? record.process_exit_code : null,
    timedOut: record.timeout === true,
    launchError: typeof record.launch_or_transport_error === "string" ? record.launch_or_transport_error : undefined,
    failureKind: typeof record.failure_classification === "string" ? record.failure_classification as CandidateExecution["failureKind"] : undefined
  };
}

async function loadPriorCandidate(directory: string, candidate: Candidate): Promise<CandidateResult> {
  const candidateDirectory = join(directory, "candidates", candidate.id);
  const record = JSON.parse(await readFile(join(candidateDirectory, "execution.json"), "utf8")) as Record<string, unknown>;
  const finalExecution = executionFromRecord(record);
  const rawAttempts = Array.isArray(record.attempts) ? record.attempts : [];
  const attempts: CandidateAttemptResult[] = rawAttempts.length > 0
    ? rawAttempts.map((item, index) => {
      const attempt = item as Record<string, unknown>;
      const attemptDirectory = typeof attempt.directory === "string" ? join(candidateDirectory, attempt.directory) : join(candidateDirectory, "attempts", `attempt-${index + 1}`);
      return { attempt: typeof attempt.attempt === "number" ? attempt.attempt : index + 1, directory: attemptDirectory, execution: executionFromRecord((attempt.execution as Record<string, unknown> | undefined) ?? attempt) };
    })
    : [{ attempt: 1, directory: candidateDirectory, execution: finalExecution }];
  return {
    candidateId: candidate.id,
    directory: candidateDirectory,
    execution: finalExecution,
    retryCount: typeof record.retry_count === "number" ? record.retry_count : Math.max(0, attempts.length - 1),
    attempts
  };
}

async function candidateRun(
  trial: Trial, candidate: Candidate, repository: string, baseline: string, runDirectory: string, adapter: CandidateAdapter
): Promise<CandidateResult> {
  const artifactDirectory = join(runDirectory, "candidates", candidate.id);
  const attemptsDirectory = join(artifactDirectory, "attempts");
  const worktree = join(artifactDirectory, "worktree");
  const hash = taskContractHash(trial.taskContract);
  await mkdir(artifactDirectory, { recursive: true });
  await mkdir(attemptsDirectory, { recursive: true });
  await git(repository, ["worktree", "add", "--detach", worktree, baseline]);
  await Promise.all(["stdout.log", "stderr.log", "raw-events.jsonl", "final-response.txt"].map((name) => writeFile(join(artifactDirectory, name), "")));

  const attempts: CandidateAttemptResult[] = [];
  while (true) {
    const attempt = attempts.length + 1;
    const attemptDirectory = join(attemptsDirectory, `attempt-${attempt}`);
    await mkdir(attemptDirectory, { recursive: true });
    const request = { candidate, worktree, artifactDirectory: attemptDirectory, prompt: prompt(trial), timeoutMs: trial.timeoutMs };
    const execution = await adapter.execute(request);
    await captureEvents(attemptDirectory);
    await writeAttemptExecution(attemptDirectory, candidate, attempt, execution, hash);
    await appendAttemptEvidence(artifactDirectory, attemptDirectory, attempt);
    attempts.push({ attempt, directory: attemptDirectory, execution });
    if (!(execution.failureKind === "launch" || execution.failureKind === "transport") || attempts.length > trial.maxLaunchTransportRetries) break;
  }

  const execution = attempts.at(-1)!.execution;
  await collectDiff(worktree, baseline, artifactDirectory);
  const changedPaths = await collectPaths(worktree, baseline);
  const forbiddenChanges = changedPaths.filter((path) => pathAllowed(path, trial.forbiddenPaths) || !pathAllowed(path, trial.allowedPaths));
  const validation = await runValidation(worktree, trial.validationCommands, resolve(__dirname, "..", ".."));
  const acceptance = await validateFractionalPrice(worktree);
  await writeFile(join(artifactDirectory, "provenance.json"), JSON.stringify({
    trial_id: trial.id, candidate_id: candidate.id, task_contract_hash: hash, baseline_commit: baseline, adapter: candidate.adapter, harness: candidate.harness,
    provider: candidate.provider ?? null, model: candidate.model, attention: candidate.attention ?? null, agent: candidate.agent ?? null,
    profile: candidate.profile ?? null, permission_policy: candidate.adapter === "codex-exec" ? { approval_policy: "never", sandbox_mode: "workspace-write" } : openCodePermissionConfig,
    trial_provenance: trial.provenance, candidate_tool_provenance: candidate.toolProvenance ?? null
  }, null, 2));

  const summary = {
    candidate_id: candidate.id,
    adapter: candidate.adapter,
    task_contract_hash: hash,
    argument_shape: argumentShape(execution.args, hash),
    started_at: attempts[0].execution.startedAt,
    completed_at: execution.completedAt,
    wall_clock_ms: attempts.reduce((total, item) => total + item.execution.durationMs, 0),
    process_exit_code: execution.exitCode,
    timeout: execution.timedOut,
    launch_or_transport_error: execution.launchError ?? null,
    failure_classification: execution.failureKind ?? null,
    retry_count: attempts.length - 1,
    worktree: "<path:worktree>",
    changed_paths: changedPaths,
    forbidden_path_changes: forbiddenChanges,
    acceptance_validation: acceptance,
    validation,
    attempts: attempts.map((item) => ({ attempt: item.attempt, directory: `attempts/attempt-${item.attempt}`, execution: storedExecution(item.execution, hash) })),
    artifact_availability: {}
  };
  const executionPath = join(artifactDirectory, "execution.json");
  await writeFile(executionPath, JSON.stringify(summary, null, 2));
  const artifactAvailability: Record<string, boolean> = {};
  for (const name of ["provenance.json", "raw-events.jsonl", "stdout.log", "stderr.log", "final-response.txt", "final.diff", "execution.json"]) {
    artifactAvailability[name] = await readFile(join(artifactDirectory, name)).then(() => true).catch(() => false);
  }
  for (const attempt of attempts) {
    for (const name of ["opencode-config.json", "raw-events.jsonl", "stdout.log", "stderr.log", "final-response.txt", "execution.json"]) {
      artifactAvailability[`attempts/attempt-${attempt.attempt}/${name}`] = await readFile(join(attempt.directory, name)).then(() => true).catch(() => false);
    }
  }
  const executionRecord = JSON.parse(await readFile(executionPath, "utf8")) as Record<string, unknown>;
  executionRecord.artifact_availability = artifactAvailability;
  await writeFile(executionPath, JSON.stringify(executionRecord, null, 2));
  return { candidateId: candidate.id, directory: artifactDirectory, execution, retryCount: attempts.length - 1, attempts };
}

export async function runTrial(trial: Trial, adapters: Map<string, CandidateAdapter>, resumeDirectory?: string): Promise<RunResult> {
  const repository = resolve(trial.repository);
  const baseline = await git(repository, ["rev-parse", trial.baselineRef]);
  const directory = resumeDirectory ? resolve(resumeDirectory) : resolve("runs", `${trial.id}-${stamp()}`);
  await mkdir(join(directory, "candidates"), { recursive: true });
  const results: CandidateResult[] = [];
  for (const candidate of trial.candidates) {
    const prior = join(directory, "candidates", candidate.id, "execution.json");
    if (resumeDirectory && await readFile(prior).then(() => true).catch(() => false)) {
      results.push(await loadPriorCandidate(directory, candidate));
      continue;
    }
    const adapter = adapters.get(candidate.adapter);
    if (!adapter) throw new Error(`no adapter registered for ${candidate.adapter}`);
    results.push(await candidateRun(trial, candidate, repository, baseline, directory, adapter));
  }
  await writeFile(join(directory, "run.json"), JSON.stringify({ trial_id: trial.id, baseline, candidate_count: trial.candidates.length, candidates: results.map((result) => ({ id: result.candidateId, directory: basename(result.directory) })) }, null, 2));
  return { directory, candidates: results };
}
