import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { processInvocation, terminateProcessTree } from "./adapters";

export interface CleanCheck { id: string; status: "passed" | "failed"; classification: string; }
export interface CleanVerification { status: "VERIFIED" | "FAILED"; checks: CleanCheck[]; }
export interface CommandResult { exit_code: number | null; timeout: boolean; launch_error: string | null; stdout: string; stderr?: string; }
export interface CleanVerifyOptions { root?: string; timeout_ms?: number; run?: (command: string, args: string[], cwd: string, timeoutMs: number) => Promise<CommandResult>; }

const rootDefault = resolve(__dirname, "..", "..");
const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const npm = (args: string[]) => ({ command: process.execPath, args: [npmCli, ...args] });
const portable = (path: string): string => process.platform === "win32" ? path.replace(/\\/g, "/").toLowerCase() : path;

export async function runCleanCommand(command: string, args: string[], cwd: string, timeoutMs: number): Promise<CommandResult> {
  const invocation = processInvocation(command, args);
  return new Promise((finish) => {
    const child = spawn(invocation.command, invocation.args, { cwd, shell: invocation.shell, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: process.platform === "win32" && invocation.command.toLowerCase().endsWith("cmd.exe") });
    let stdout = "", stderr = "", launch_error: string | null = null, timeout = false, termination: Promise<void> | undefined;
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk; }); child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk; });
    child.once("error", (error) => { launch_error = error.message; });
    const timer = setTimeout(() => { timeout = true; termination = terminateProcessTree(child); }, timeoutMs);
    child.once("close", async (exit_code) => { clearTimeout(timer); await termination; finish({ exit_code, timeout, launch_error, stdout, stderr }); });
  });
}

const record = (checks: CleanCheck[], id: string, result: CommandResult): boolean => {
  const passed = !result.timeout && !result.launch_error && result.exit_code === 0;
  const code = result.stderr?.match(/npm (?:ERR!|error) code\s+([A-Z0-9_]+)/i)?.[1]?.toLowerCase();
  const baseline = id === "scheduler_baseline_contract" ? result.stdout.match(/\b(?:compile_timeout|compile_launch_failure|compile_failure|acceptance_timeout|acceptance_launch_failure|acceptance_infrastructure_failure|unexpected_acceptance_pass|canonical_test_inventory_mismatch|unexpected_behavioral_failure|expected_defective_baseline)\b/)?.[0] : undefined;
  checks.push({ id, status: passed ? "passed" : "failed", classification: passed ? "completed" : result.timeout ? "timeout" : result.launch_error ? "launch_failure" : baseline ? `baseline_contract_${baseline}` : code ? `command_failure_${code}` : "command_failure" });
  return passed;
};

async function registered(execute: CleanVerifyOptions["run"], root: string, worktree: string, timeout: number): Promise<boolean | null> {
  const result = await execute!("git", ["worktree", "list", "--porcelain"], root, timeout);
  if (result.timeout || result.launch_error || result.exit_code !== 0) return null;
  return result.stdout.split(/\r?\n/).some((line) => line.startsWith("worktree ") && portable(line.slice(9).trim()) === portable(worktree));
}

async function cleanupWorktree(execute: CleanVerifyOptions["run"], root: string, worktree: string, timeout: number, checks: CleanCheck[]): Promise<boolean> {
  const removal = await execute!("git", ["worktree", "remove", "--force", worktree], root, timeout);
  const removeOk = record(checks, "worktree_remove", removal);
  let present = await registered(execute, root, worktree, timeout);
  if (present === null) { checks.push({ id: "worktree_registration", status: "failed", classification: "worktree_registration_check_failed" }); return false; }
  if (present) {
    const prune = await execute!("git", ["worktree", "prune"], root, timeout);
    if (!record(checks, "worktree_prune", prune)) return false;
    present = await registered(execute, root, worktree, timeout);
  }
  if (present !== false) { checks.push({ id: "worktree_registration", status: "failed", classification: "worktree_still_registered" }); return false; }
  checks.push({ id: "worktree_registration", status: "passed", classification: "removed" });
  return removeOk;
}

/** Verifies the judge's offline path in a worktree created and removed by this call. */
export async function verifyClean(options: CleanVerifyOptions = {}): Promise<CleanVerification> {
  const root = options.root ?? rootDefault, timeout = options.timeout_ms ?? 300_000, execute = options.run ?? runCleanCommand, checks: CleanCheck[] = [];
  const temporary = await mkdtemp(join(tmpdir(), "arena-clean-")), worktree = join(temporary, "worktree"), install = join(temporary, "install");
  let status: CleanVerification["status"] = "VERIFIED", created = false, safeToRemove = true;
  const invoke = async (id: string, command: string, args: string[], cwd = worktree): Promise<boolean> => record(checks, id, await execute(command, args, cwd, timeout));
  try {
    if (!await invoke("worktree", "git", ["worktree", "add", "--detach", worktree, "HEAD"], root)) status = "FAILED";
    else created = true;
    if (status === "VERIFIED") { const command = npm(["ci", "--offline"]); if (!await invoke("npm_ci", command.command, command.args)) status = "FAILED"; }
    for (const [id, args] of [["typecheck", ["run", "typecheck"]], ["build", ["run", "build"]], ["test", ["test"]], ["fixture_typecheck", ["run", "fixture:typecheck"]], ["fixture_test", ["run", "fixture:test"]], ["scheduler_typecheck", ["run", "scheduler:typecheck"]], ["scheduler_test", ["run", "scheduler:test"]], ["scheduler_baseline_contract", ["run", "scheduler:baseline-contract"]]] as Array<[string, string[]]>) {
      if (status !== "VERIFIED") break; const command = npm(args); if (!await invoke(id, command.command, command.args)) status = "FAILED";
    }
    for (const [id, args] of [["demo", ["run", "demo"]], ["demo_verify", ["start", "--", "verify", "examples/demo-run"]]] as Array<[string, string[]]>) {
      if (status !== "VERIFIED") break; const command = npm(args); if (!await invoke(id, command.command, command.args)) status = "FAILED";
    }
    if (status === "VERIFIED" && !await invoke("built_cli_help", process.execPath, [join(worktree, "dist", "src", "index.js"), "--help"])) status = "FAILED";
    if (status === "VERIFIED") {
      const packed = npm(["pack", "--json", "--pack-destination", temporary]); const pack = await execute(packed.command, packed.args, worktree, timeout);
      if (!record(checks, "package_pack", pack)) status = "FAILED";
      const archive = pack.exit_code === 0 ? (JSON.parse(pack.stdout) as Array<{ filename: string }>)[0]?.filename : undefined;
      if (status === "VERIFIED" && !archive) { checks.push({ id: "package_pack", status: "failed", classification: "package_archive_missing" }); status = "FAILED"; }
      if (status === "VERIFIED") { const command = npm(["install", "--offline", "--prefix", install, join(temporary, archive!)]); if (!await invoke("installed_cli", command.command, command.args, worktree)) status = "FAILED"; }
      if (status === "VERIFIED") { const bin = process.platform === "win32" ? join(install, "node_modules", ".bin", "arena.cmd") : join(install, "node_modules", ".bin", "arena"); if (!await invoke("installed_cli_help", bin, ["--help"], temporary)) status = "FAILED"; }
    }
  } catch { checks.push({ id: "clean_verify", status: "failed", classification: "unexpected_failure" }); status = "FAILED"; }
  finally {
    if (created) { const removed = await cleanupWorktree(execute, root, worktree, timeout, checks); if (!removed) { status = "FAILED"; safeToRemove = false; } }
    if (safeToRemove) await rm(temporary, { recursive: true, force: true });
  }
  return { status, checks };
}

if (require.main === module) {
  verifyClean().then((result) => { for (const check of result.checks) console.log(`${check.status === "passed" ? "[ok]" : "[failed]"} ${check.id}: ${check.classification}`); console.log(result.status); process.exitCode = result.status === "VERIFIED" ? 0 : 1; }).catch(() => { console.error("clean verification failed"); process.exitCode = 1; });
}
