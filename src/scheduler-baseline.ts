import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { processInvocation } from "./adapters";

export interface BaselineCommandResult { exit_code: number | null; timeout: boolean; launch_error: string | null; stdout: string; stderr: string; }
export interface BaselineContractResult { status: "VERIFIED" | "FAILED"; classification: string; }
export interface BaselineVerifierOptions { root?: string; timeout_ms?: number; run?: (command: string, args: string[], cwd: string, timeoutMs: number) => Promise<BaselineCommandResult>; }

const rootDefault = resolve(__dirname, "..", "..");
const expected = [
  ["canonical scheduler acceptance: FIFO and concurrency never exceed the limit", "passed"],
  ["canonical scheduler acceptance: duplicate IDs, cancellation, and terminal ID reuse", "failed"],
  ["canonical scheduler acceptance: retries, drain, and final errors are deterministic", "failed"]
] as const;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<BaselineCommandResult> {
  const invocation = processInvocation(command, args);
  return new Promise((finish) => {
    const child = spawn(invocation.command, invocation.args, { cwd, shell: invocation.shell, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: process.platform === "win32" && invocation.command.toLowerCase().endsWith("cmd.exe") });
    let stdout = "", stderr = "", launch_error: string | null = null, timeout = false;
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk; }); child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk; });
    child.once("error", (error) => { launch_error = error.message; });
    const timer = setTimeout(() => { timeout = true; child.kill(); }, timeoutMs);
    child.once("close", (exit_code) => { clearTimeout(timer); finish({ exit_code, timeout, launch_error, stdout, stderr }); });
  });
}

/** Proves the intentionally defective scheduler baseline failed through its named behavioral assertions. */
export async function verifySchedulerBaseline(options: BaselineVerifierOptions = {}): Promise<BaselineContractResult> {
  const root = options.root ?? rootDefault, execute = options.run ?? run, timeout = options.timeout_ms ?? 30_000;
  const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
  const compile = await execute(process.execPath, [tsc, "-p", "fixtures/concurrency-scheduler/tsconfig.json"], root, timeout);
  if (compile.timeout) return { status: "FAILED", classification: "compile_timeout" };
  if (compile.launch_error) return { status: "FAILED", classification: "compile_launch_failure" };
  if (compile.exit_code !== 0) return { status: "FAILED", classification: "compile_failure" };
  const acceptance = await execute(process.execPath, ["--test", "--test-reporter=tap", "fixtures/concurrency-scheduler/acceptance/scheduler.acceptance.test.js"], root, timeout);
  if (acceptance.timeout) return { status: "FAILED", classification: "acceptance_timeout" };
  if (acceptance.launch_error) return { status: "FAILED", classification: "acceptance_launch_failure" };
  const output = `${acceptance.stdout}\n${acceptance.stderr}`;
  if (/ERR_MODULE_NOT_FOUND|Cannot find module|SyntaxError|npm ERR!|node:internal\/modules/i.test(output)) return { status: "FAILED", classification: "acceptance_infrastructure_failure" };
  if (acceptance.exit_code === 0) return { status: "FAILED", classification: "unexpected_acceptance_pass" };
  if (!expected.every(([name, status]) => new RegExp(`${status === "passed" ? "(?:[✔✓]\\s+|ok\\s+\\d+\\s+-\\s+)" : "(?:[✖×]\\s+|not ok\\s+\\d+\\s+-\\s+)"}${escape(name)}`).test(output))) return { status: "FAILED", classification: "canonical_test_inventory_mismatch" };
  if (!/tests\s+3\b/i.test(output) || !/pass\s+1\b/i.test(output) || !/fail\s+2\b/i.test(output) || (output.match(/ERR_ASSERTION/g) ?? []).length < 2) return { status: "FAILED", classification: "unexpected_behavioral_failure" };
  return { status: "VERIFIED", classification: "expected_defective_baseline" };
}

if (require.main === module) {
  verifySchedulerBaseline().then((result) => { console.log(result.classification); process.exitCode = result.status === "VERIFIED" ? 0 : 1; }).catch(() => { console.error("baseline contract verification failed"); process.exitCode = 1; });
}
