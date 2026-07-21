import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runProcess } from "./adapters";

export interface FractionalPriceCase {
  name: string;
  expected: number;
  actual?: number;
  passed: boolean;
}

export interface FractionalPriceAcceptance {
  validator: "fractional-price";
  status: "passed" | "failed" | "not_applicable";
  cases: FractionalPriceCase[];
  error?: string;
  stdout: string;
  stderr: string;
}

export interface CommandAcceptance {
  validator: "configured-command";
  status: "passed" | "failed";
  args: string[];
  started_at: string;
  completed_at: string;
  wall_clock_ms: number;
  exit_code: number | null;
  timeout: boolean;
  stdout: string;
  stderr: string;
  launch_error: string | null;
  failure_classification: "command_failure" | "launch_failure" | "timeout" | null;
}
export type AcceptanceResult = FractionalPriceAcceptance | CommandAcceptance;

const sourceRelativePath = join("fixtures", "bounded-inventory", "src", "inventory.ts");
const cases = [
  { name: "mixed-fractions", lines: [{ quantity: 2, unitPrice: 1.25 }, { quantity: 1, unitPrice: 0.33 }], expected: 2.83 },
  { name: "round-final-total", lines: [{ quantity: 3, unitPrice: 0.334 }, { quantity: 1, unitPrice: 0.334 }], expected: 1.34 }
];

const worker = `
const fs = require("node:fs");
const ts = require(process.argv[2]);
const originalWrite = process.stdout.write.bind(process.stdout);
const candidateStdout = [];
try {
  process.stdout.write = (chunk) => { candidateStdout.push(String(chunk)); return true; };
  const source = fs.readFileSync(process.argv[1], "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} };
  new Function("module", "exports", output)(moduleRecord, moduleRecord.exports);
  const inventoryTotal = moduleRecord.exports.inventoryTotal;
  if (typeof inventoryTotal !== "function") throw new Error("inventoryTotal export is missing");
  const cases = JSON.parse(process.argv[3]);
  const results = cases.map(({ name, lines, expected }) => {
    const actual = inventoryTotal(lines);
    return { name, expected, actual, passed: Object.is(actual, expected) };
  });
  process.stdout.write = originalWrite;
  originalWrite(JSON.stringify({ cases: results, candidate_stdout: candidateStdout.join("") }));
} catch (error) {
  process.stdout.write = originalWrite;
  originalWrite(JSON.stringify({ cases: [], error: error instanceof Error ? error.message : String(error), candidate_stdout: candidateStdout.join("") }));
  process.exitCode = 1;
}
`;

function acceptanceEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: dirname(process.execPath) };
  if (process.platform === "win32") {
    for (const key of ["SYSTEMROOT", "WINDIR", "ComSpec"]) if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

export async function validateFractionalPrice(worktree: string, artifactDirectory = worktree): Promise<FractionalPriceAcceptance> {
  const sourcePath = join(worktree, sourceRelativePath);
  if (!await readFile(sourcePath, "utf8").then(() => true).catch(() => false)) {
    const result = { validator: "fractional-price" as const, status: "not_applicable" as const, cases: [], stdout: "", stderr: "" };
    await writeFile(join(artifactDirectory, "acceptance.json"), JSON.stringify(result, null, 2));
    return result;
  }

  const stdoutPath = join(artifactDirectory, "acceptance-stdout.log");
  const stderrPath = join(artifactDirectory, "acceptance-stderr.log");
  const execution = await runProcess(process.execPath, ["-e", worker, sourcePath, require.resolve("typescript"), JSON.stringify(cases)], worktree, 1_500, stdoutPath, stderrPath, { env: acceptanceEnvironment() });
  const [stdout, stderr] = await Promise.all([
    readFile(stdoutPath, "utf8").catch(() => ""),
    readFile(stderrPath, "utf8").catch(() => "")
  ]);
  let result: FractionalPriceAcceptance;
  if (execution.timedOut) {
    result = { validator: "fractional-price", status: "failed", cases: [], error: "acceptance worker timed out", stdout, stderr };
  } else {
    try {
      const parsed = JSON.parse(stdout) as { cases?: FractionalPriceCase[]; error?: string };
      if (!Array.isArray(parsed.cases)) throw new Error("acceptance worker did not emit cases");
      result = { validator: "fractional-price", status: !parsed.error && parsed.cases.every((item) => item.passed) ? "passed" : "failed", cases: parsed.cases, error: parsed.error, stdout, stderr };
    } catch (error) {
      result = { validator: "fractional-price", status: "failed", cases: [], error: error instanceof Error ? error.message : String(error), stdout, stderr };
    }
  }
  await writeFile(join(artifactDirectory, "acceptance.json"), JSON.stringify(result, null, 2));
  return result;
}

/** Runs a trial-owned canonical acceptance command without shell composition. */
export async function validateConfiguredAcceptance(worktree: string, artifactDirectory: string, args: string[], timeoutMs: number, arenaRoot: string): Promise<CommandAcceptance> {
  const command = process.platform === "win32" && args[0] === "npm" ? process.execPath : args[0];
  const commandArgs = process.platform === "win32" && args[0] === "npm"
    ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), ...args.slice(1)] : args.slice(1);
  const stdoutPath = join(artifactDirectory, "acceptance-stdout.log"), stderrPath = join(artifactDirectory, "acceptance-stderr.log");
  const execution = await runProcess(command, commandArgs, worktree, timeoutMs, stdoutPath, stderrPath, { env: { ...process.env, PATH: `${join(arenaRoot, "node_modules", ".bin")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}` } });
  const [stdout, stderr] = await Promise.all([readFile(stdoutPath, "utf8").catch(() => ""), readFile(stderrPath, "utf8").catch(() => "")]);
  const failure = execution.timedOut ? "timeout" : execution.launchError ? "launch_failure" : execution.exitCode === 0 ? null : "command_failure";
  const result: CommandAcceptance = { validator: "configured-command", status: failure ? "failed" : "passed", args, started_at: execution.startedAt, completed_at: execution.completedAt, wall_clock_ms: execution.durationMs, exit_code: execution.exitCode, timeout: execution.timedOut, stdout, stderr, launch_error: execution.launchError ?? null, failure_classification: failure };
  await writeFile(join(artifactDirectory, "acceptance.json"), JSON.stringify(result, null, 2));
  return result;
}
