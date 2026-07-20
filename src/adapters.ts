import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Candidate } from "./trial";

export type FailureKind = "launch" | "transport" | "authentication" | "unsupported_configuration" | "permission" | "candidate_task" | "timeout";

export interface DoctorResult { adapter: string; ok: boolean; version?: string; error?: string; }
export interface CandidateRequest { candidate: Candidate; worktree: string; artifactDirectory: string; prompt: string; timeoutMs: number; }
export interface CandidateExecution {
  args: string[]; startedAt: string; completedAt: string; durationMs: number; exitCode: number | null;
  timedOut: boolean; failureKind?: FailureKind; launchError?: string; finalResponse?: string;
}
export interface CandidateAdapter { doctor(): Promise<DoctorResult>; execute(request: CandidateRequest): Promise<CandidateExecution>; }

export const openCodePermissionConfig = {
  share: "disabled",
  permission: {
    "*": "allow",
    external_directory: "deny",
    question: "deny",
    webfetch: "deny",
    websearch: "deny"
  }
} as const;

export function codexArgs(request: CandidateRequest): string[] {
  const options = request.candidate.adapterOptions ?? {};
  const overrides = (options.config_overrides ?? {}) as Record<string, unknown>;
  const args = ["exec", "--json", "--output-last-message", join(request.artifactDirectory, "final-response.txt"), "--cd", request.worktree,
    "--model", request.candidate.model, "--sandbox", "workspace-write", "--ignore-user-config", "--ignore-rules", "--strict-config"];
  if (request.candidate.profile) args.push("--profile", request.candidate.profile);
  for (const [key, value] of Object.entries(overrides)) args.push("--config", `${key}=${JSON.stringify(value)}`);
  args.push("--config", 'approval_policy="never"');
  return [...args, request.prompt];
}

export function openCodeArgs(request: CandidateRequest): string[] {
  const model = request.candidate.provider ? `${request.candidate.provider}/${request.candidate.model}` : request.candidate.model;
  const args = ["run", "--pure", "--auto", "--format", "json", "--dir", request.worktree, "--model", model];
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
  return exitCode !== 0 ? "candidate_task" : undefined;
};

async function terminateProcessTree(child: import("node:child_process").ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolve) => execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => resolve()));
    return;
  }
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
}

export interface RunProcessOptions { env?: NodeJS.ProcessEnv; }

export async function runProcess(command: string, args: string[], cwd: string, timeoutMs: number, stdoutPath: string, stderrPath: string, options: RunProcessOptions = {}): Promise<CandidateExecution> {
  const { spawn } = await import("node:child_process");
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  await mkdir(dirname(stdoutPath), { recursive: true });
  await Promise.all([writeFile(stdoutPath, ""), writeFile(stderrPath, "")]);
  return new Promise((resolve) => {
    let launchError: string | undefined;
    let timedOut = false;
    let termination: Promise<void> | undefined;
    const child = spawn(command, args, { cwd, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], env: options.env });
    let writes = Promise.resolve();
    const write = (path: string, chunk: Buffer) => { writes = writes.then(() => appendFile(path, chunk)); };
    child.stdout?.on("data", (chunk: Buffer) => write(stdoutPath, chunk));
    child.stderr?.on("data", (chunk: Buffer) => write(stderrPath, chunk));
    child.once("error", (error) => { launchError = error.message; });
    const timer = setTimeout(() => {
      timedOut = true;
      termination = terminateProcessTree(child);
    }, timeoutMs);
    child.once("close", async (exitCode) => {
      clearTimeout(timer);
      await termination;
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
    return runProcess("codex", args, request.worktree, request.timeoutMs, join(request.artifactDirectory, "stdout.log"), join(request.artifactDirectory, "stderr.log"));
  }
}

export class OpenCodeRunAdapter implements CandidateAdapter {
  async doctor(): Promise<DoctorResult> { return version(await openCodeCommand(), "opencode"); }
  async execute(request: CandidateRequest): Promise<CandidateExecution> {
    const args = openCodeArgs(request);
    const configPath = join(request.artifactDirectory, "opencode-config.json");
    const config = JSON.stringify(openCodePermissionConfig, null, 2);
    await writeFile(configPath, config);
    const execution = await runProcess(await openCodeCommand(), args, request.worktree, request.timeoutMs, join(request.artifactDirectory, "stdout.log"), join(request.artifactDirectory, "stderr.log"), {
      env: { ...process.env, OPENCODE_CONFIG: configPath, OPENCODE_CONFIG_CONTENT: config }
    });
    const raw = await readFile(join(request.artifactDirectory, "stdout.log"), "utf8").catch(() => "");
    const final = extractOpenCodeText(raw);
    if (final) { await writeFile(join(request.artifactDirectory, "final-response.txt"), final); execution.finalResponse = final; }
    return execution;
  }
}

export function extractOpenCodeText(raw: string): string | undefined {
  return raw.split(/\r?\n/).flatMap((line) => {
    try { return [JSON.parse(line) as { type?: string; part?: { type?: string; text?: unknown } }]; } catch { return []; }
  }).flatMap((event) => event.type === "text" && typeof event.part?.text === "string" ? [event.part.text] : [])
    .at(-1);
}

export function argumentShape(args: string[], taskContractHash: string): string[] {
  const pathFlags = new Set(["--output-last-message", "--cd", "--dir"]);
  const safeValueFlags = new Set(["--model", "--sandbox", "--profile", "--variant", "--agent"]);
  return args.map((arg, index) => {
    if (index === args.length - 1) return `<task-contract:${taskContractHash}>`;
    if (pathFlags.has(args[index - 1] ?? "")) return "<path:redacted>";
    if (args[index - 1] === "--config") return "<config:redacted>";
    if (safeValueFlags.has(args[index - 1] ?? "")) return arg;
    if (arg.startsWith("--") || ["exec", "run", "json"].includes(arg)) return arg;
    return "<argument:redacted>";
  });
}
