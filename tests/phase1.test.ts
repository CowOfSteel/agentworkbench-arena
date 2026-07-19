import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { CandidateAdapter, CandidateRequest, CandidateExecution, classifyFailure, codexArgs, openCodeArgs } from "../src/adapters";
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

test("schema rejects one candidate and adapter arguments are native arrays", async () => {
  const raw = parse(await readFile(join(process.cwd(), "examples", "bounded-fix", "trial.yml"), "utf8")) as { candidates: unknown[] } & Record<string, unknown>;
  assert.throws(() => validateTrial({ ...raw, candidates: raw.candidates.slice(0, 1) }), /at least two/);
  const trial = validateTrial(raw);
  const request: CandidateRequest = { candidate: trial.candidates[0], worktree: "C:/worktree", artifactDirectory: "C:/artifacts", prompt: "task", timeoutMs: 1 };
  assert.deepEqual(codexArgs(request).slice(0, 3), ["exec", "--json", "--output-last-message"]);
  assert.ok(codexArgs(request).includes('model_reasoning_effort="low"'));
  const openRequest = { ...request, candidate: trial.candidates[3] };
  assert.ok(openCodeArgs(openRequest).includes("openai/gpt-5.6-luna"));
  assert.ok(openCodeArgs(openRequest).includes("--pure"));
  assert.equal(classifyFailure("", true), "timeout");
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

test("runner enumerates adapters generically and preserves inspectable evidence", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-phase1-"));
  const repository = join(temporary, "repository");
  const output = join(temporary, "output");
  try {
    await writeFile(join(temporary, ".keep"), "");
    execFileSync("git", ["init", repository], { encoding: "utf8" });
    await writeFile(join(repository, "package.json"), "{}\n");
    await (await import("node:fs/promises")).mkdir(join(repository, "src"));
    await writeFile(join(repository, "src", "base.txt"), "base\n");
    git(repository, ["config", "user.email", "arena@example.test"]); git(repository, ["config", "user.name", "Arena"]);
    git(repository, ["add", "."]); git(repository, ["commit", "-m", "baseline"]); git(repository, ["tag", "baseline"]);
    const candidate = { id: "one", adapter: "codex-exec" as const, harness: "fake", model: "fake" };
    const trial = { id: "test", repository, baselineRef: "baseline", taskContract: "fix", allowedPaths: ["src"], forbiddenPaths: [], validationCommands: [["git", "status", "--short"]], timeoutMs: 1000, maxLaunchTransportRetries: 1 as const, manualIntervention: "forbidden" as const, provenance: {}, candidates: [candidate, { ...candidate, id: "two" }] };
    const result = await runTrial(trial, new Map([["codex-exec", new FakeAdapter()]]), output);
    assert.deepEqual(result.candidates.map((item) => item.candidateId), ["one", "two"]);
    const evidence = join(output, "candidates", "one");
    assert.match(await readFile(join(evidence, "raw-events.jsonl"), "utf8"), /not-json/);
    assert.match(await readFile(join(evidence, "final.diff"), "utf8"), /one.txt/);
    assert.equal(JSON.parse(await readFile(join(evidence, "execution.json"), "utf8")).artifact_availability["final.diff"], true);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
