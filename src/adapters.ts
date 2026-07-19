import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Candidate } from "./trial";

export type FailureKind = "launch" | "transport" | "authentication" | "unsupported_configuration" | "permission" | "candidate_task" | "timeout";

export interface DoctorResult { adapter: string; ok: boolean; version?: string; error?: string; }
export interface CandidateRequest { candidate: Candidate; worktree: string; artifactDirectory: string; prompt: string; timeoutMs: number; }
export interface CandidateExecution {
  args: string[]; startedAt: string; completedAt: string; durationMs: number; exitCode: number | null;
  timedOut: boolean; failureKind?: FailureKind; launchError?: string; finalResponse?: string;
}
export interface CandidateAdapter { doctor(): Promise<DoctorResult>; execute(request: CandidateRequest): Promise<CandidateExecution>; }

export function codexArgs(request: CandidateRequest): string[] {
  const options = request.candidate.adapterOptions ?? {};
  const overrides = (options.config_overrides ?? {}) as Record<string, unknown>;
  const args = ["exec", "--json", "--output-last-message", join(request.artifactDirectory, "final-response.txt"), "--cd", request.worktree,
    "--model", request.candidate.model, "--sandbox", request.candidate.permissionPolicy ?? "workspace-write", "--ignore-user-config", "--ignore-rules", "--strict-config"];
  if (request.candidate.profile) args.push("--profile", request.candidate.profile);
  for (const [key, value] of Object.entries(overrides)) args.push("--config", `${key}=${JSON.stringify(value)}`);
  return [...args, request.prompt];
}

export function openCodeArgs(request: CandidateRequest): string[] {
  const model = request.candidate.provider ? `${request.candidate.provider}/${request.candidate.model}` : request.candidate.model;
  const args = ["run", "--pure", "--format", "json", "--dir", request.worktree, "--model", model];
  if (request.candidate.attention) args.push("--variant", request.candidate.attention);
  if (request.candidate.agent) args.push("--agent", request.candidate.agent);
  return [...args, request.prompt];
}

const isTransport = (message: string) => /ECONN|ENOTFOUND|ETIMEDOUT|network|socket|transport|connection reset/i.test(message);
export const classifyFailure = (message: string, timedOut: boolean, exitCode: number | null = 0): FailureKind | undefined => {
  if (timedOut) return "timeout";
  if (/auth|login|credential|unauthorized|forbidden/i.test(message)) return "authentication";
  if (/unsupported|unknown model|invalid model|variant/i.test(message)) return "unsupported_configuration";
  if (/permission|approval|denied|sandbox/i.test(message)) return "permission";
  if (isTransport(message)) return "transport";
  return message || exitCode !== 0 ? "candidate_task" : undefined;
};

async function run(command: string, args: string[], cwd: string, timeoutMs: number, stdoutPath: string, stderrPath: string): Promise<CandidateExecution> {
  const { spawn } = await import("node:child_process");
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  await mkdir(dirname(stdoutPath), { recursive: true });
  await Promise.all([writeFile(stdoutPath, ""), writeFile(stderrPath, "")]);
  return new Promise((resolve) => {
    let launchError: string | undefined;
    let timedOut = false;
    const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let writes = Promise.resolve();
    const write = (path: string, chunk: Buffer) => { writes = writes.then(() => appendFile(path, chunk)); };
    child.stdout?.on("data", (chunk: Buffer) => write(stdoutPath, chunk));
    child.stderr?.on("data", (chunk: Buffer) => write(stderrPath, chunk));
    child.once("error", (error) => { launchError = error.message; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      if (process.platform === "win32" && child.pid) void import("node:child_process").then(({ execFile }) => execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => undefined));
    }, timeoutMs);
    child.once("close", async (exitCode) => {
      clearTimeout(timer);
      await writes;
      const stderr = await readFile(stderrPath, "utf8").catch(() => "");
      const stdout = await readFile(stdoutPath, "utf8").catch(() => "");
      const completed = Date.now();
      resolve({ args, startedAt, completedAt: new Date(completed).toISOString(), durationMs: completed - started, exitCode,
        timedOut, launchError, failureKind: launchError ? "launch" : classifyFailure(`${stderr}\n${stdout}`, timedOut, exitCode) });
    });
  });
}

async function version(command: string, adapter = command): Promise<DoctorResult> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => execFile(command, ["--version"], { shell: false }, (error, stdout) =>
    resolve(error ? { adapter, ok: false, error: error.message } : { adapter, ok: true, version: stdout.trim() })));
}

async function openCodeCommand(): Promise<string> {
  if (process.platform !== "win32") return "opencode";
  const { execFile } = await import("node:child_process");
  const shims = await new Promise<string[]>((resolve) => execFile("where.exe", ["opencode"], { shell: false }, (_error, stdout) => resolve(stdout.split(/\r?\n/).filter(Boolean))));
  for (const shim of shims) {
    const executable = join(dirname(shim), "node_modules", "opencode-ai", "bin", "opencode.exe");
    if (await access(executable).then(() => true).catch(() => false)) return executable;
  }
  return "opencode";
}

export class CodexExecAdapter implements CandidateAdapter {
  async doctor(): Promise<DoctorResult> { return version("codex"); }
  async execute(request: CandidateRequest): Promise<CandidateExecution> {
    const args = codexArgs(request);
    return run("codex", args, request.worktree, request.timeoutMs, join(request.artifactDirectory, "stdout.log"), join(request.artifactDirectory, "stderr.log"));
  }
}

export class OpenCodeRunAdapter implements CandidateAdapter {
  async doctor(): Promise<DoctorResult> { return version(await openCodeCommand(), "opencode"); }
  async execute(request: CandidateRequest): Promise<CandidateExecution> {
    const args = openCodeArgs(request);
    const execution = await run(await openCodeCommand(), args, request.worktree, request.timeoutMs, join(request.artifactDirectory, "stdout.log"), join(request.artifactDirectory, "stderr.log"));
    const raw = await readFile(join(request.artifactDirectory, "stdout.log"), "utf8").catch(() => "");
    const final = raw.split(/\r?\n/).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } })
      .filter((event) => event.type === "text" && typeof event.part?.text === "string").map((event) => event.part.text).at(-1);
    if (final) { await appendFile(join(request.artifactDirectory, "final-response.txt"), final); execution.finalResponse = final; }
    return execution;
  }
}

export function argumentShape(args: string[]): string[] { return args.map((arg) => basename(arg) === arg ? arg : `<path:${basename(arg)}>`); }
