import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { CandidateAdapter, CandidateExecution, argumentShape } from "./adapters";
import { Candidate, Trial } from "./trial";

const exec = promisify(execFile);
const git = async (repository: string, args: string[]): Promise<string> => (await exec("git", args, { cwd: repository, shell: false })).stdout.trim();
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const pathAllowed = (path: string, prefixes: string[]) => prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

export interface CandidateResult { candidateId: string; directory: string; execution: CandidateExecution; retryCount: number; }
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

async function candidateRun(
  trial: Trial, candidate: Candidate, repository: string, baseline: string, runDirectory: string, adapter: CandidateAdapter
): Promise<CandidateResult> {
  const artifactDirectory = join(runDirectory, "candidates", candidate.id);
  const worktree = join(artifactDirectory, "worktree");
  await mkdir(artifactDirectory, { recursive: true });
  await git(repository, ["worktree", "add", "--detach", worktree, baseline]);
  const request = { candidate, worktree, artifactDirectory, prompt: prompt(trial), timeoutMs: trial.timeoutMs };
  let execution = await adapter.execute(request);
  let retryCount = 0;
  if ((execution.failureKind === "launch" || execution.failureKind === "transport") && trial.maxLaunchTransportRetries === 1) {
    retryCount = 1;
    await appendFile(join(artifactDirectory, "stderr.log"), "\n[arena] retrying classified launch/transport failure once\n");
    execution = await adapter.execute(request);
  }
  await captureEvents(artifactDirectory);
  await collectDiff(worktree, baseline, artifactDirectory);
  const changedPaths = await collectPaths(worktree, baseline);
  const forbiddenChanges = changedPaths.filter((path) => pathAllowed(path, trial.forbiddenPaths) || !pathAllowed(path, trial.allowedPaths));
  const validation = await runValidation(worktree, trial.validationCommands, resolve(__dirname, "..", ".."));
  await writeFile(join(artifactDirectory, "provenance.json"), JSON.stringify({
    trial_id: trial.id, candidate_id: candidate.id, baseline_commit: baseline, adapter: candidate.adapter, harness: candidate.harness,
    provider: candidate.provider ?? null, model: candidate.model, attention: candidate.attention ?? null, agent: candidate.agent ?? null,
    profile: candidate.profile ?? null, permission_policy: candidate.permissionPolicy ?? null, trial_provenance: trial.provenance,
    candidate_tool_provenance: candidate.toolProvenance ?? null
  }, null, 2));
  await writeFile(join(artifactDirectory, "execution.json"), JSON.stringify({
    candidate_id: candidate.id, adapter: candidate.adapter, argument_shape: argumentShape(execution.args), started_at: execution.startedAt,
    completed_at: execution.completedAt, wall_clock_ms: execution.durationMs, process_exit_code: execution.exitCode,
    timeout: execution.timedOut, launch_or_transport_error: execution.launchError ?? null, failure_classification: execution.failureKind ?? null,
    retry_count: retryCount, worktree, changed_paths: changedPaths, forbidden_path_changes: forbiddenChanges,
    validation, artifact_availability: {}
  }, null, 2));
  const artifactAvailability: Record<string, boolean> = {};
  for (const name of ["provenance.json", "raw-events.jsonl", "stdout.log", "stderr.log", "final-response.txt", "final.diff", "execution.json"]) {
    artifactAvailability[name] = await readFile(join(artifactDirectory, name)).then(() => true).catch(() => false);
  }
  const executionPath = join(artifactDirectory, "execution.json");
  const executionRecord = JSON.parse(await readFile(executionPath, "utf8")) as Record<string, unknown>;
  executionRecord.artifact_availability = artifactAvailability;
  await writeFile(executionPath, JSON.stringify(executionRecord, null, 2));
  return { candidateId: candidate.id, directory: artifactDirectory, execution, retryCount };
}

export async function runTrial(trial: Trial, adapters: Map<string, CandidateAdapter>, resumeDirectory?: string): Promise<RunResult> {
  const repository = resolve(trial.repository);
  const baseline = await git(repository, ["rev-parse", trial.baselineRef]);
  const directory = resumeDirectory ? resolve(resumeDirectory) : resolve("runs", `${trial.id}-${stamp()}`);
  await mkdir(join(directory, "candidates"), { recursive: true });
  const results: CandidateResult[] = [];
  for (const candidate of trial.candidates) {
    const prior = join(directory, "candidates", candidate.id, "execution.json");
    if (resumeDirectory && await readFile(prior).then(() => true).catch(() => false)) continue;
    const adapter = adapters.get(candidate.adapter);
    if (!adapter) throw new Error(`no adapter registered for ${candidate.adapter}`);
    results.push(await candidateRun(trial, candidate, repository, baseline, directory, adapter));
  }
  await writeFile(join(directory, "run.json"), JSON.stringify({ trial_id: trial.id, baseline, candidate_count: trial.candidates.length, candidates: results.map((result) => ({ id: result.candidateId, directory: basename(result.directory) })) }, null, 2));
  return { directory, candidates: results };
}
