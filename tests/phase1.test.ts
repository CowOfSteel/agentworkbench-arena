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
import { runTrial } from "../src/runner";
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
    assert.match(await readFile(join(evidence, "final.diff"), "utf8"), /one.txt/);
    assert.equal(JSON.parse(await readFile(join(evidence, "execution.json"), "utf8")).artifact_availability["final.diff"], true);
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
    assert.match(await readFile(join(evidence, "stdout.log"), "utf8"), /stdout-1/);
    assert.match(await readFile(join(evidence, "stdout.log"), "utf8"), /stdout-2/);
    assert.equal(JSON.parse(await readFile(join(evidence, "execution.json"), "utf8")).retry_count, 1);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("resume returns prior candidate results and writes all candidates", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-resume-"));
  const repository = await makeRepository(temporary);
  const output = join(temporary, "output");
  try {
    const trial = makeTrial(repository);
    await runTrial(trial, new Map([["codex-exec", new FakeAdapter()]]), output);
    const refusingAdapter: CandidateAdapter = { doctor: async () => ({ adapter: "fake", ok: true }), execute: async () => { throw new Error("resume must not execute prior candidates"); } };
    const resumed = await runTrial(trial, new Map([["codex-exec", refusingAdapter]]), output);
    assert.deepEqual(resumed.candidates.map((candidate) => candidate.candidateId), ["one", "two"]);
    assert.deepEqual(JSON.parse(await readFile(join(output, "run.json"), "utf8")).candidates.map((candidate: { id: string }) => candidate.id), ["one", "two"]);
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
  const baseline = await validateFractionalPrice(process.cwd());
  assert.equal(baseline.status, "failed");
  const temporary = await mkdtemp(join(tmpdir(), "arena-acceptance-"));
  try {
    const source = join(temporary, "fixtures", "bounded-inventory", "src");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "inventory.ts"), "export function inventoryTotal(lines: Array<{ quantity: number; unitPrice: number }>): number { return Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100; }\n");
    const correct = await validateFractionalPrice(temporary);
    assert.equal(correct.status, "passed");
    assert.equal(correct.actual, 2.83);
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
