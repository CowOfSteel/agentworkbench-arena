import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { processInvocation } from "./adapters";

export interface CleanCheck { id: string; status: "passed" | "failed"; classification: string; }
export interface CleanVerification { status: "VERIFIED" | "FAILED"; checks: CleanCheck[]; }
interface CommandResult { exit_code: number | null; timeout: boolean; launch_error: string | null; stdout: string; }
export interface CleanVerifyOptions { root?: string; timeout_ms?: number; run?: (command: string, args: string[], cwd: string, timeoutMs: number) => Promise<CommandResult>; }

const rootDefault = resolve(__dirname, "..", "..");
const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const npm = (args: string[]) => ({ command: process.execPath, args: [npmCli, ...args] });

async function run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<CommandResult> {
  const invocation = processInvocation(command, args);
  return new Promise((resolveResult) => {
    const child = spawn(invocation.command, invocation.args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: process.platform === "win32" && invocation.command.toLowerCase().endsWith("cmd.exe") });
    let stdout = "", launchError: string | null = null, timedOut = false;
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk; });
    child.once("error", (error) => { launchError = error.message; });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.once("close", (exitCode) => { clearTimeout(timer); resolveResult({ exit_code: exitCode, timeout: timedOut, launch_error: launchError, stdout }); });
  });
}

const record = (checks: CleanCheck[], id: string, result: CommandResult, expectedFailure = false): boolean => {
  const passed = !result.timeout && !result.launch_error && (expectedFailure ? result.exit_code !== 0 : result.exit_code === 0);
  checks.push({ id, status: passed ? "passed" : "failed", classification: passed ? expectedFailure ? "expected_baseline_acceptance_failure" : "completed" : result.timeout ? "timeout" : result.launch_error ? "launch_failure" : expectedFailure && result.exit_code === 0 ? "unexpected_baseline_acceptance_pass" : "command_failure" });
  return passed;
};

/** Verifies the judge's offline path in a worktree created and removed by this call. */
export async function verifyClean(options: CleanVerifyOptions = {}): Promise<CleanVerification> {
  const root = options.root ?? rootDefault, timeout = options.timeout_ms ?? 300_000, execute = options.run ?? run, checks: CleanCheck[] = [];
  const temporary = await mkdtemp(join(tmpdir(), "arena-clean-")), worktree = join(temporary, "worktree"), install = join(temporary, "install");
  const invoke = async (id: string, command: string, args: string[], cwd = worktree, expectedFailure = false) => record(checks, id, await execute(command, args, cwd, timeout), expectedFailure);
  try {
    if (!await invoke("worktree", "git", ["worktree", "add", "--detach", worktree, "HEAD"], root)) return { status: "FAILED", checks };
    const installResult = npm(["ci", "--offline"]); if (!await invoke("npm_ci", installResult.command, installResult.args)) return { status: "FAILED", checks };
    for (const [id, args] of [["typecheck", ["run", "typecheck"]], ["build", ["run", "build"]], ["test", ["test"]], ["fixture_typecheck", ["run", "fixture:typecheck"]], ["fixture_test", ["run", "fixture:test"]], ["scheduler_typecheck", ["run", "scheduler:typecheck"]], ["scheduler_test", ["run", "scheduler:test"]]] as Array<[string, string[]]>) { const command = npm(args); if (!await invoke(id, command.command, command.args)) return { status: "FAILED", checks }; }
    const acceptance = npm(["run", "scheduler:acceptance"]); if (!await invoke("scheduler_baseline_acceptance", acceptance.command, acceptance.args, worktree, true)) return { status: "FAILED", checks };
    for (const [id, args] of [["demo", ["run", "demo"]], ["demo_verify", ["start", "--", "verify", "examples/demo-run"]]] as Array<[string, string[]]>) { const command = npm(args); if (!await invoke(id, command.command, command.args)) return { status: "FAILED", checks }; }
    if (!await invoke("built_cli_help", process.execPath, [join(worktree, "dist", "src", "index.js"), "--help"])) return { status: "FAILED", checks };
    const packed = npm(["pack", "--json", "--pack-destination", temporary]); const pack = await execute(packed.command, packed.args, worktree, timeout);
    if (!record(checks, "package_pack", pack)) return { status: "FAILED", checks };
    const archive = (JSON.parse(pack.stdout) as Array<{ filename: string }>)[0]?.filename; if (!archive) { checks.push({ id: "package_pack", status: "failed", classification: "package_archive_missing" }); return { status: "FAILED", checks }; }
    const installCommand = npm(["install", "--offline", "--global", "--prefix", install, join(temporary, archive)]); if (!await invoke("installed_cli", installCommand.command, installCommand.args, worktree)) return { status: "FAILED", checks };
    const bin = process.platform === "win32" ? join(install, "arena.cmd") : join(install, "bin", "arena"); if (!await invoke("installed_cli_help", bin, ["--help"], temporary)) return { status: "FAILED", checks };
    return { status: "VERIFIED", checks };
  } catch { checks.push({ id: "clean_verify", status: "failed", classification: "unexpected_failure" }); return { status: "FAILED", checks }; }
  finally {
    await execute("git", ["worktree", "remove", "--force", worktree], root, timeout).catch(() => undefined);
    await rm(temporary, { recursive: true, force: true });
  }
}

if (require.main === module) {
  verifyClean().then((result) => {
    for (const check of result.checks) console.log(`${check.status === "passed" ? "[ok]" : "[failed]"} ${check.id}: ${check.classification}`);
    console.log(result.status);
    process.exitCode = result.status === "VERIFIED" ? 0 : 1;
  }).catch(() => { console.error("clean verification failed"); process.exitCode = 1; });
}
