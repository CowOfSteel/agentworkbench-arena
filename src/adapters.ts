import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Candidate } from "./trial";

export type FailureKind = "launch" | "transport" | "authentication" | "unsupported_configuration" | "permission" | "candidate_task" | "timeout";

export interface DoctorResult {
  adapter: string; ok: boolean; version?: string; error?: string;
  executable_status?: "available" | "unavailable" | "version_unavailable";
  authentication?: { existing_cli_state: "usable" | "unavailable"; optional_access_token: "present" | "absent" };
}
export interface CandidateRequest { candidate: Candidate; worktree: string; artifactDirectory: string; prompt: string; timeoutMs: number; }
export interface CandidateExecution {
  args: string[]; startedAt: string; completedAt: string; durationMs: number; exitCode: number | null;
  timedOut: boolean; failureKind?: FailureKind; launchError?: string; finalResponse?: string;
  adapterProvenance?: {
    executable: { source: "trial" | "environment" | "arena_config" | "path"; path: string; version?: string; versionError?: string };
    configuration_isolation?: "partial";
    ambient?: { instructions_detected: boolean; plugins_detected: boolean; ignore_flags: { user_config: boolean; rules: boolean } };
  };
}
export interface CandidateAdapter { doctor(candidate?: Candidate): Promise<DoctorResult>; execute(request: CandidateRequest): Promise<CandidateExecution>; }

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
    "--model", request.candidate.model, "--sandbox", "workspace-write", "--ephemeral"];
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

export interface RunProcessOptions { env?: NodeJS.ProcessEnv; redactions?: string[]; }

interface ProcessInvocation { command: string; args: string[]; shell: boolean; }

export function processInvocation(command: string, args: string[], platform = process.platform): ProcessInvocation {
  if (platform === "win32" && extname(command).toLowerCase() === ".cmd") {
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const line = [quote(command), ...args.map(quote)].join(" ");
    return { command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], shell: false };
  }
  return { command, args, shell: false };
}

function redact(text: string, redactions: string[] = []): string {
  return redactions.filter(Boolean).reduce((value, secret) => value.replaceAll(secret, "<redacted>"), text);
}

async function redactFile(path: string, redactions: string[]): Promise<void> {
  if (redactions.length === 0) return;
  const content = await readFile(path, "utf8").catch(() => undefined);
  if (content !== undefined) await writeFile(path, redact(content, redactions));
}

export async function runProcess(command: string, args: string[], cwd: string, timeoutMs: number, stdoutPath: string, stderrPath: string, options: RunProcessOptions = {}): Promise<CandidateExecution> {
  const { spawn } = await import("node:child_process");
  const started = performance.now();
  const startedAt = new Date().toISOString();
  await mkdir(dirname(stdoutPath), { recursive: true });
  await Promise.all([writeFile(stdoutPath, ""), writeFile(stderrPath, "")]);
  return new Promise((resolve) => {
    let launchError: string | undefined;
    let timedOut = false;
    let termination: Promise<void> | undefined;
    const invocation = processInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, { cwd, shell: invocation.shell, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], env: options.env, windowsHide: true, windowsVerbatimArguments: process.platform === "win32" && invocation.command.toLowerCase().endsWith("cmd.exe") });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => { launchError = error.message; });
    const timer = setTimeout(() => {
      timedOut = true;
      termination = terminateProcessTree(child);
    }, timeoutMs);
    child.once("close", async (exitCode) => {
      clearTimeout(timer);
      await termination;
      await Promise.all([
        writeFile(stdoutPath, redact(Buffer.concat(stdout).toString("utf8"), options.redactions)),
        writeFile(stderrPath, redact(Buffer.concat(stderr).toString("utf8"), options.redactions))
      ]);
      const [stderrText, stdoutText] = await Promise.all([readFile(stderrPath, "utf8").catch(() => ""), readFile(stdoutPath, "utf8").catch(() => "")]);
      const completed = performance.now();
      resolve({ args, startedAt, completedAt: new Date().toISOString(), durationMs: Math.round(completed - started), exitCode,
        timedOut, launchError, failureKind: launchError ? "launch" : classifyFailure(`${stderrText}\n${stdoutText}`, timedOut, exitCode) });
    });
  });
}

interface CommandStatus { ok: boolean; stdout: string; error?: string; unavailable: boolean; }

async function commandStatus(command: string, args: string[]): Promise<CommandStatus> {
  if (process.platform === "win32" && isAbsolute(command) && extname(command).toLowerCase() === ".cmd" && !await access(command).then(() => true).catch(() => false)) {
    return { ok: false, stdout: "", error: `${command} is unavailable`, unavailable: true };
  }
  const { spawn } = await import("node:child_process");
  const invocation = processInvocation(command, args);
  return new Promise((resolve) => {
    let stdout = "";
    let launchError: string | undefined;
    const child = spawn(invocation.command, invocation.args, { shell: invocation.shell, stdio: ["ignore", "pipe", "ignore"], windowsHide: true, windowsVerbatimArguments: process.platform === "win32" && invocation.command.toLowerCase().endsWith("cmd.exe") });
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk; });
    child.once("error", (error) => { launchError = error.message; });
    child.once("close", (exitCode) => resolve(launchError || exitCode !== 0
      ? { ok: false, stdout: stdout.trim(), error: launchError ?? `${command} ${args.join(" ")} exited ${exitCode}`, unavailable: Boolean(launchError) }
      : { ok: true, stdout: stdout.trim(), unavailable: false }));
  });
}

export async function executableVersion(command: string, adapter = command): Promise<DoctorResult> {
  const result = await commandStatus(command, ["--version"]);
  return result.ok
    ? { adapter, ok: true, version: result.stdout, executable_status: "available" }
    : { adapter, ok: false, error: result.error, executable_status: result.unavailable ? "unavailable" : "version_unavailable" };
}

export interface CodexExecutable { source: "trial" | "environment" | "arena_config" | "path"; path: string; }
const defaultArenaConfigPath = resolve(__dirname, "..", "..", ".arena", "config.json");

export async function resolveCodexExecutable(candidate?: Candidate, environment: NodeJS.ProcessEnv = process.env, arenaConfigPath = defaultArenaConfigPath): Promise<CodexExecutable> {
  const trial = candidate?.adapterOptions?.codex_executable;
  if (typeof trial === "string" && trial.trim()) return { source: "trial", path: trial };
  if (environment.ARENA_CODEX_EXECUTABLE?.trim()) return { source: "environment", path: environment.ARENA_CODEX_EXECUTABLE };
  const config = await readFile(arenaConfigPath, "utf8").then(JSON.parse).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (config?.codex_executable !== undefined && (typeof config.codex_executable !== "string" || !config.codex_executable.trim())) {
    throw new Error(`${arenaConfigPath} codex_executable must be a non-empty string`);
  }
  return config?.codex_executable ? { source: "arena_config", path: config.codex_executable } : { source: "path", path: "codex" };
}

export function sanitizeExecutablePath(path: string, home = homedir()): string {
  if (!isAbsolute(path)) return path;
  const equal = process.platform === "win32" ? (left: string, right: string) => left.toLowerCase() === right.toLowerCase() : (left: string, right: string) => left === right;
  const normalizedHome = resolve(home);
  const normalizedPath = resolve(path);
  if (equal(normalizedPath, normalizedHome)) return "<user-home>";
  const prefix = `${normalizedHome}${process.platform === "win32" ? "\\" : "/"}`;
  if (equal(normalizedPath.slice(0, prefix.length), prefix)) return `<user-home>${normalizedPath.slice(normalizedHome.length)}`;
  return path;
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
  constructor(private readonly arenaConfigPath = defaultArenaConfigPath) {}
  async doctor(candidate?: Candidate): Promise<DoctorResult> {
    const executable = await resolveCodexExecutable(candidate, process.env, this.arenaConfigPath);
    const version = await executableVersion(executable.path, "codex");
    const path = sanitizeExecutablePath(executable.path);
    if (!version.ok) return { ...version, error: version.error?.replaceAll(executable.path, path) };
    const login = await commandStatus(executable.path, ["login", "status"]);
    const accessTokenPresent = Boolean(process.env.CODEX_ACCESS_TOKEN);
    const existingCliState = login.ok ? "usable" : "unavailable";
    return {
      adapter: "codex", ok: login.ok || accessTokenPresent, version: version.version, executable_status: "available",
      authentication: { existing_cli_state: existingCliState, optional_access_token: accessTokenPresent ? "present" : "absent" },
      ...(!login.ok && !accessTokenPresent ? { error: "Codex authentication unavailable; run codex login." } : {})
    };
  }
  async execute(request: CandidateRequest): Promise<CandidateExecution> {
    const args = codexArgs(request);
    const stdoutPath = join(request.artifactDirectory, "stdout.log");
    const stderrPath = join(request.artifactDirectory, "stderr.log");
    const executable = await resolveCodexExecutable(request.candidate, process.env, this.arenaConfigPath);
    const version = await executableVersion(executable.path, "codex");
    const sanitizedPath = sanitizeExecutablePath(executable.path);
    const versionError = version.error?.replaceAll(executable.path, sanitizedPath);
    const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
    const instructionPaths: string[] = [];
    for (let directory = resolve(request.worktree); ; directory = dirname(directory)) {
      instructionPaths.push(join(directory, "AGENTS.md"));
      const parent = dirname(directory);
      if (parent === directory) break;
    }
    const [instructionsDetected, userInstructionsDetected, userPluginsDetected, workspacePluginsDetected] = await Promise.all([
      Promise.all(instructionPaths.map((path) => access(path).then(() => true).catch(() => false))).then((found) => found.some(Boolean)),
      access(join(codexHome, "AGENTS.md")).then(() => true).catch(() => false),
      access(join(codexHome, "plugins")).then(() => true).catch(() => false),
      access(join(request.worktree, ".codex", "plugins")).then(() => true).catch(() => false)
    ]);
    const provenance = {
      executable: { source: executable.source, path: sanitizedPath, ...(version.ok ? { version: version.version } : { versionError }) },
      configuration_isolation: "partial" as const,
      ambient: { instructions_detected: instructionsDetected || userInstructionsDetected, plugins_detected: userPluginsDetected || workspacePluginsDetected, ignore_flags: { user_config: false, rules: false } }
    };
    const accessToken = process.env.CODEX_ACCESS_TOKEN;
    const execution = await runProcess(executable.path, args, request.worktree, request.timeoutMs, stdoutPath, stderrPath, { redactions: accessToken ? [accessToken] : [] });
    await redactFile(join(request.artifactDirectory, "final-response.txt"), accessToken ? [accessToken] : []);
    if (execution.launchError) execution.launchError = execution.launchError.replaceAll(executable.path, sanitizedPath);
    execution.adapterProvenance = provenance;
    return execution;
  }
}

export class OpenCodeRunAdapter implements CandidateAdapter {
  async doctor(): Promise<DoctorResult> { return executableVersion(await openCodeCommand(), "opencode"); }
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
