import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { CandidateAdapter, CandidateRequest, CandidateExecution, classifyFailure, codexArgs, extractOpenCodeText, openCodeArgs, openCodePermissionConfig, runProcess } from "../src/adapters";
import { validateFractionalPrice } from "../src/acceptance";
import { runDiagnostic, runTrial } from "../src/runner";
import { loadTrial, validateTrial } from "../src/trial";

const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

test("trial accepts a seventh candidate by configuration", async () => {
  const raw = parse(await readFile(join(process.cwd(), "examples", "bounded-fix", "trial.yml"), "utf8")) as { candidates: unknown[] } & Record<string, unknown>;
  assert.equal(validateTrial(raw).candidates.length, 6);
  const seventh = structuredClone(raw.candidates[0]) as Record<string, unknown>;
  seventh.id = "codex-luna-extra";
  assert.equal(validateTrial({ ...raw, candidates: [...raw.candidates, seventh] }).candidates.length, 7);
});

test("schema validates IDs and native arguments explicitly", async () => {
  const raw = parse(await readFile(join(process.cwd(), "examples", "bounded-fix", "trial.yml"), "utf8")) as { candidates: unknown[] } & Record<string, unknown>;
  assert.throws(() => validateTrial({ ...raw, candidates: raw.candidates.slice(0, 1) }), /at least two/);
  assert.throws(() => validateTrial({ ...raw, id: "../escape" }), /safe filesystem slug/);
  assert.throws(() => validateTrial({ ...raw, id: "CON" }), /safe filesystem slug/);
  assert.throws(() => validateTrial({ ...raw, id: "a".repeat(49) }), /safe filesystem slug/);
  const traversal = structuredClone(raw.candidates) as Array<Record<string, unknown>>;
  traversal[0].id = "one/two";
  assert.throws(() => validateTrial({ ...raw, candidates: traversal }), /safe filesystem slug/);
  const duplicate = structuredClone(raw.candidates) as Array<Record<string, unknown>>;
  duplicate[0].id = "same-id";
  duplicate[1].id = "SAME-ID";
  assert.throws(() => validateTrial({ ...raw, candidates: duplicate }), /case-insensitively/);

  const trial = validateTrial(raw);
  const request: CandidateRequest = { candidate: trial.candidates[0], worktree: "C:/worktree", artifactDirectory: "C:/artifacts", prompt: "task", timeoutMs: 1 };
  const codex = codexArgs(request);
  assert.deepEqual(codex.slice(0, 3), ["exec", "--json", "--output-last-message"]);
  assert.equal(codex[codex.indexOf("--sandbox") + 1], "workspace-write");
  assert.ok(codex.includes('model_reasoning_effort="low"'));
  assert.ok(codex.includes('approval_policy="never"'));
  assert.ok(!codex.includes("--dangerously-bypass-approvals-and-sandbox"));
  const openRequest = { ...request, candidate: trial.candidates[3] };
  const open = openCodeArgs(openRequest);
  assert.ok(open.includes("openai/gpt-5.6-luna"));
  assert.ok(open.includes("--pure"));
  assert.ok(open.includes("--auto"));
  assert.deepEqual(openCodePermissionConfig, {
    share: "disabled",
    permission: { "*": "allow", external_directory: "deny", question: "deny", webfetch: "deny", websearch: "deny" }
  });
  assert.equal(classifyFailure("completed successfully", false, 0), undefined);
  assert.equal(classifyFailure("completed successfully", false, 1), "candidate_task");
  assert.equal(classifyFailure("permission denied", false, 0), "permission");
  assert.equal(classifyFailure("", true), "timeout");
  assert.equal(extractOpenCodeText('{"type":"text","part":{"type":"text","text":"provider-neutral"}}'), "provider-neutral");
});

class FakeAdapter implements CandidateAdapter {
  async doctor() { return { adapter: "fake", ok: true }; }
  async execute(request: CandidateRequest): Promise<CandidateExecution> {
    await writeFile(join(request.worktree, "src", `${request.candidate.id}.txt`), "changed\n");
    await writeFile(join(request.artifactDirectory, "stdout.log"), '{"type":"text"}\nnot-json\n');
    await writeFile(join(request.artifactDirectory, "stderr.log"), "");
    await writeFile(join(request.artifactDirectory, "final-response.txt"), "done");
    return { args: ["fake", request.candidate.id], startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.001Z", durationMs: 1, exitCode: 0, timedOut: false };
  }
}

class RetryAdapter implements CandidateAdapter {
  private count = 0;
  async doctor() { return { adapter: "fake", ok: true }; }
  async execute(request: CandidateRequest): Promise<CandidateExecution> {
    this.count += 1;
    await writeFile(join(request.worktree, "src", this.count === 1 ? "first.txt" : "second.txt"), "changed\n");
    await writeFile(join(request.artifactDirectory, "stdout.log"), `stdout-${this.count}\n`);
    await writeFile(join(request.artifactDirectory, "stderr.log"), `stderr-${this.count}\n`);
    await writeFile(join(request.artifactDirectory, "final-response.txt"), `response-${this.count}\n`);
    return {
      args: ["fake", request.candidate.id],
      startedAt: `2026-01-01T00:00:0${this.count}.000Z`,
      completedAt: `2026-01-01T00:00:0${this.count}.001Z`,
      durationMs: 1,
      exitCode: this.count === 1 ? 1 : 0,
      timedOut: false,
      failureKind: this.count === 1 ? "transport" : undefined
    };
  }
}

class RedactingAdapter implements CandidateAdapter {
  async doctor() { return { adapter: "fake", ok: true }; }
  async execute(request: CandidateRequest): Promise<CandidateExecution> {
    await writeFile(join(request.artifactDirectory, "stdout.log"), "ordinary output\n");
    await writeFile(join(request.artifactDirectory, "stderr.log"), "");
    return {
      args: ["fake", "--config", "api_key=secret-config", request.prompt],
      startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.001Z", durationMs: 1, exitCode: 0, timedOut: false
    };
  }
}

async function makeRepository(parent: string): Promise<string> {
  const repository = join(parent, "repository");
  await mkdir(join(repository, "src"), { recursive: true });
  git(parent, ["init", repository]);
  await writeFile(join(repository, "package.json"), "{}\n");
  await writeFile(join(repository, "src", "base.txt"), "base\n");
  git(repository, ["config", "user.email", "arena@example.test"]);
  git(repository, ["config", "user.name", "Arena"]);
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "baseline"]);
  git(repository, ["tag", "baseline"]);
  return repository;
}

function makeTrial(repository: string, candidates = [
  { id: "one", adapter: "codex-exec" as const, harness: "fake", model: "fake" },
  { id: "two", adapter: "codex-exec" as const, harness: "fake", model: "fake" }
]) {
  return { id: "test", repository, baselineRef: "baseline", taskContract: "fix", allowedPaths: ["src"], forbiddenPaths: [], validationCommands: [["git", "status", "--short"]], timeoutMs: 1000, maxLaunchTransportRetries: 1, manualIntervention: "forbidden" as const, provenance: {}, candidates };
}

test("runner enumerates adapters generically and preserves inspectable evidence", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-phase1-"));
  const repository = await makeRepository(temporary);
  const output = join(temporary, "output");
  try {
    const result = await runTrial(makeTrial(repository), new Map([["codex-exec", new FakeAdapter()]]), output);
    assert.deepEqual(result.candidates.map((item) => item.candidateId), ["one", "two"]);
    const evidence = join(output, "candidates", "one");
    assert.match(await readFile(join(evidence, "raw-events.jsonl"), "utf8"), /not-json/);
    assert.match(await readFile(join(evidence, "candidate.diff"), "utf8"), /one.txt/);
    assert.equal(JSON.parse(await readFile(join(evidence, "execution.json"), "utf8")).artifact_availability["candidate.diff"], true);
    assert.equal(git(join(evidence, "worktree"), ["diff", "--cached"]).trim(), "");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("retry evidence remains separate and complete", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-retry-"));
  const repository = await makeRepository(temporary);
  const output = join(temporary, "output");
  try {
    const result = await runTrial(makeTrial(repository, [{ id: "retry", adapter: "codex-exec", harness: "fake", model: "fake" }, { id: "other", adapter: "codex-exec", harness: "fake", model: "fake" }]), new Map([["codex-exec", new RetryAdapter()]]), output);
    const evidence = join(output, "candidates", "retry");
    assert.equal(result.candidates[0].attempts.length, 2);
    assert.match(await readFile(join(evidence, "attempts", "attempt-1", "stdout.log"), "utf8"), /stdout-1/);
    assert.match(await readFile(join(evidence, "attempts", "attempt-1", "stderr.log"), "utf8"), /stderr-1/);
    assert.match(await readFile(join(evidence, "attempts", "attempt-1", "final-response.txt"), "utf8"), /response-1/);
    assert.match(await readFile(join(evidence, "attempts", "attempt-1", "raw-events.jsonl"), "utf8"), /stdout-1/);
    assert.match(await readFile(join(evidence, "attempts", "attempt-1", "execution.json"), "utf8"), /transport/);
    assert.match(await readFile(join(evidence, "attempts", "attempt-1", "candidate.diff"), "utf8"), /first.txt/);
    assert.equal(JSON.parse(await readFile(join(evidence, "attempts", "attempt-1", "retry-reset.json"), "utf8")).clean, true);
    assert.doesNotMatch(await readFile(join(evidence, "candidate.diff"), "utf8"), /first.txt/);
    assert.match(await readFile(join(evidence, "candidate.diff"), "utf8"), /second.txt/);
    assert.match(await readFile(join(evidence, "stdout.log"), "utf8"), /stdout-1/);
    assert.match(await readFile(join(evidence, "stdout.log"), "utf8"), /stdout-2/);
    assert.equal(JSON.parse(await readFile(join(evidence, "execution.json"), "utf8")).retry_count, 1);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("validation side effects are preserved separately from candidate evidence", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-validation-"));
  const repository = await makeRepository(temporary);
  const output = join(temporary, "output");
  try {
    const trial = makeTrial(repository);
    trial.validationCommands = [[process.execPath, "-e", "require('node:fs').writeFileSync('src/validation.txt', 'validation\\n')"]];
    await runTrial(trial, new Map([["codex-exec", new FakeAdapter()]]), output);
    const evidence = join(output, "candidates", "one");
    assert.match(await readFile(join(evidence, "candidate.diff"), "utf8"), /one.txt/);
    assert.doesNotMatch(await readFile(join(evidence, "candidate.diff"), "utf8"), /validation.txt/);
    assert.match(await readFile(join(evidence, "validation-side-effects.diff"), "utf8"), /validation.txt/);
    assert.ok(JSON.parse(await readFile(join(evidence, "post-validation-status.json"), "utf8")).changed_paths.includes("src/validation.txt"));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("execution records redact prompts and config values and store the task hash", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-redaction-"));
  const repository = await makeRepository(temporary);
  const output = join(temporary, "output");
  try {
    const trial = makeTrial(repository, [{ id: "secret", adapter: "codex-exec", harness: "fake", model: "fake" }, { id: "other", adapter: "codex-exec", harness: "fake", model: "fake" }]);
    trial.taskContract = "fix secret-token";
    await runTrial(trial, new Map([["codex-exec", new RedactingAdapter()]]), output);
    const recordText = await readFile(join(output, "candidates", "secret", "execution.json"), "utf8");
    const record = JSON.parse(recordText) as { task_contract_hash: string };
    assert.equal(record.task_contract_hash, createHash("sha256").update(trial.taskContract).digest("hex"));
    assert.doesNotMatch(recordText, /secret-token|secret-config/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("independent fractional-price acceptance rejects baseline and accepts the correct implementation", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-acceptance-"));
  try {
    const baselineArtifacts = join(temporary, "baseline-artifacts");
    await mkdir(baselineArtifacts);
    const baseline = await validateFractionalPrice(process.cwd(), baselineArtifacts);
    assert.equal(baseline.status, "failed");
    const source = join(temporary, "fixtures", "bounded-inventory", "src");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "inventory.ts"), "export function inventoryTotal(lines: Array<{ quantity: number; unitPrice: number }>): number { return Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100; }\n");
    const correct = await validateFractionalPrice(temporary);
    assert.equal(correct.status, "passed");
    assert.deepEqual(correct.cases.map((item) => [item.name, item.actual]), [["mixed-fractions", 2.83], ["round-final-total", 1.34]]);
    assert.equal(JSON.parse(await readFile(join(temporary, "acceptance.json"), "utf8")).status, "passed");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("acceptance worker has a scrubbed environment and strict timeout", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-acceptance-worker-"));
  const source = join(temporary, "fixtures", "bounded-inventory", "src");
  const secret = process.env.ARENA_ACCEPTANCE_TEST_SECRET;
  process.env.ARENA_ACCEPTANCE_TEST_SECRET = "must-not-reach-worker";
  try {
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "inventory.ts"), "if (process.env.ARENA_ACCEPTANCE_TEST_SECRET) throw new Error('secret leaked'); export function inventoryTotal(lines: Array<{ quantity: number; unitPrice: number }>): number { return Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100; }\n");
    assert.equal((await validateFractionalPrice(temporary)).status, "passed");
    await writeFile(join(source, "inventory.ts"), "while (true) {}\n");
    const timedOut = await validateFractionalPrice(temporary);
    assert.equal(timedOut.status, "failed");
    assert.equal(timedOut.error, "acceptance worker timed out");
  } finally {
    if (secret === undefined) delete process.env.ARENA_ACCEPTANCE_TEST_SECRET;
    else process.env.ARENA_ACCEPTANCE_TEST_SECRET = secret;
    await rm(temporary, { recursive: true, force: true });
  }
});

class ProbeAdapter implements CandidateAdapter {
  async doctor() { return { adapter: "fake", ok: true }; }
  async execute(request: CandidateRequest): Promise<CandidateExecution> {
    const probe = join(request.worktree, "fixtures", "bounded-inventory", "src");
    await mkdir(probe, { recursive: true });
    await writeFile(join(probe, "arena-write-probe.txt"), "phase1-write-probe\n");
    await Promise.all([writeFile(join(request.artifactDirectory, "stdout.log"), "probe\n"), writeFile(join(request.artifactDirectory, "stderr.log"), "")]);
    return { args: ["fake"], startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.001Z", durationMs: 1, exitCode: 0, timedOut: false };
  }
}

test("diagnostic records a bounded successful write probe", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-diagnostic-"));
  const repository = await makeRepository(temporary);
  try {
    const trial = makeTrial(repository);
    trial.allowedPaths.push("fixtures/bounded-inventory/src");
    const result = await runDiagnostic(trial, "one", new Map([["codex-exec", new ProbeAdapter()]]), join(temporary, "output"));
    assert.equal(result.passed, true);
    assert.equal(JSON.parse(await readFile(result.diagnosticPath, "utf8")).marker, true);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("Windows timeout waits for the complete process tree", { skip: process.platform !== "win32" }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-timeout-"));
  try {
    const marker = join(temporary, "late-marker.txt");
    const script = join(temporary, "parent.js");
    await writeFile(script, "const { spawn } = require('node:child_process'); const marker = process.argv[2]; spawn(process.execPath, ['-e', \"setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'late'), 250)\", marker], { stdio: 'ignore', windowsHide: true }); setTimeout(() => {}, 2000);\n");
    const execution = await runProcess(process.execPath, [script, marker], temporary, 50, join(temporary, "stdout.log"), join(temporary, "stderr.log"));
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(execution.timedOut, true);
    assert.equal(await readFile(marker, "utf8").catch(() => undefined), undefined);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
