import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { adjudicateRun, adjudicationDryRun, buildJudgePacket, defaultJudgeConfig, JudgeAdapter, JudgeExecution, loadPhase2Run } from "../src/adjudication";
import { CandidateAdapter, CandidateExecution, CandidateRequest } from "../src/adapters";
import { runTrial } from "../src/runner";
import { Candidate, Trial } from "../src/trial";

const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

async function repository(parent: string): Promise<string> {
  const root = join(parent, "repository"); await mkdir(join(root, "src"), { recursive: true }); git(parent, ["init", root]);
  await writeFile(join(root, "package.json"), "{}\n"); await writeFile(join(root, "src", "base.ts"), "export const base = 1;\n");
  git(root, ["config", "user.email", "arena@example.test"]); git(root, ["config", "user.name", "Arena"]); git(root, ["add", "."]); git(root, ["commit", "-m", "baseline"]); git(root, ["tag", "baseline"]); return root;
}
function trial(repositoryPath: string, count = 2): Trial {
  const candidates: Candidate[] = Array.from({ length: count }, (_, index) => ({ id: `candidate-${index + 1}`, adapter: "codex-exec", harness: "codex", model: "fake" }));
  return { id: "phase3", repository: repositoryPath, baselineRef: "baseline", taskContract: "fix", allowedPaths: ["src", "fixtures/bounded-inventory/src"], forbiddenPaths: [], validationCommands: [[process.execPath, "-e", "process.stdout.write('ok')"]], timeoutMs: 1_000, validationTimeoutMs: 1_000, dependencyPolicy: "allow_changes", maxLaunchTransportRetries: 1, manualIntervention: "forbidden", provenance: {}, candidates };
}
class CleanAdapter implements CandidateAdapter {
  async doctor() { return { adapter: "fake", ok: true }; }
  async execute(request: CandidateRequest): Promise<CandidateExecution> {
    await writeFile(join(request.worktree, "src", "result.ts"), "export const result = true;\n");
    await mkdir(join(request.worktree, "fixtures", "bounded-inventory", "src"), { recursive: true }); await writeFile(join(request.worktree, "fixtures", "bounded-inventory", "src", "inventory.ts"), "export function inventoryTotal(lines: Array<{ quantity: number; unitPrice: number }>): number { return Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100; }\n");
    await writeFile(join(request.artifactDirectory, "stdout.log"), '{"type":"turn.completed"}\n'); await writeFile(join(request.artifactDirectory, "stderr.log"), ""); await writeFile(join(request.artifactDirectory, "final-response.txt"), "done\n");
    return { args: ["fake"], startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.010Z", durationMs: 10, exitCode: 0, timedOut: false };
  }
}
class EmptyAdapter extends CleanAdapter { async execute(request: CandidateRequest): Promise<CandidateExecution> { await writeFile(join(request.artifactDirectory, "stdout.log"), '{"type":"turn.completed"}\n'); await writeFile(join(request.artifactDirectory, "stderr.log"), ""); return { args: ["fake"], startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.010Z", durationMs: 10, exitCode: 0, timedOut: false }; } }
function response(labels: string[]) {
  const criteria = Object.fromEntries(labels.map((label) => [label, { acceptance_coverage: "strong", maintainability: "adequate", architecture_fit: "adequate", regression_risk: "adequate", unnecessary_complexity: "adequate", evidence_quality: "strong" }]));
  return { schema_version: "3.0", verdict: "RECOMMENDATION", recommended_labels: [labels[0]], confidence: "low", ranking: labels.map((label, index) => ({ label, rank: index + 1, tier: "adequate", rationale: "bounded evidence" })), criteria_by_candidate: criteria, strengths_by_candidate: Object.fromEntries(labels.map((label) => [label, []])), risks_by_candidate: Object.fromEntries(labels.map((label) => [label, []])), limitations: [], summary: "bounded" };
}
class FakeJudge implements JudgeAdapter {
  calls = 0; constructor(private readonly replies: string[]) {}
  async doctor() { return { adapter: "fake", ok: true }; }
  async adjudicate(request: { prompt: string }): Promise<JudgeExecution> { const response_text = this.replies[this.calls++] ?? "{}"; assert.doesNotMatch(request.prompt, /candidate-\d/); return { started_at: "2026-01-01T00:00:00.000Z", completed_at: "2026-01-01T00:00:00.010Z", wall_clock_ms: 10, exit_code: 0, timeout: false, stdout: "", stderr: "", response_text, launch_error: null, failure_classification: null, args: ["fake"] }; }
}
class FailedJudge extends FakeJudge { async adjudicate(): Promise<JudgeExecution> { this.calls++; return { started_at: "2026-01-01T00:00:00.000Z", completed_at: "2026-01-01T00:00:00.010Z", wall_clock_ms: 10, exit_code: null, timeout: true, stdout: "", stderr: "", response_text: "", launch_error: null, failure_classification: "timeout", args: ["fake"] }; } }
async function phase2Run(adapter: CandidateAdapter = new CleanAdapter(), count = 2): Promise<{ temporary: string; directory: string }> {
  const temporary = await mkdtemp(join(tmpdir(), "arena-phase3-")); const source = await repository(temporary); const result = await runTrial(trial(source, count), new Map([["codex-exec", adapter]]), join(temporary, "run")); return { temporary, directory: result.directory };
}

test("labels and masking work beyond twenty-six candidates without identity leakage", () => {
  for (const count of [2, 6, 7, 26, 27]) {
    const ids = Array.from({ length: count }, (_, index) => `candidate-${index + 1}`);
    const run = { manifest: { run_id: "run", trial_id: "trial", task_contract_hash: "task", normalized_trial_snapshot_hash: "snapshot" }, snapshot: { allowed_paths: [], forbidden_paths: [], validation_commands: [] }, candidates: ids.map((id) => ({ id, label: "", telemetry: { output: { files_changed: { value: 0 }, lines_added: { value: 0 }, lines_deleted: { value: 0 }, validation_pass_count: { value: 0 }, validation_fail_count: { value: 0 } }, execution: { process_timeout: { value: false } }, change_analysis: { pre_validation: { changed_paths: [], untracked_paths: [] } }, evidence_completeness: { status: "complete" }, hard_gates: [] }, validation: { commands: [] }, diff: "" })) } as any;
    const first = buildJudgePacket(run); const second = buildJudgePacket(run);
    const labels = (first.packet.candidates as Array<{ label: string }>).map((candidate) => candidate.label);
    assert.equal(labels.length, count); assert.equal(new Set(labels).size, count); assert.deepEqual(first.identityMap, second.identityMap); assert.equal(labels.includes("AA"), count >= 27); assert.doesNotMatch(JSON.stringify(first.packet), /candidate-\d/);
  }
});

test("adjudication writes masked artifacts, repair evidence, and revealed evaluation only after fake judging", async () => {
  const { temporary, directory } = await phase2Run();
  try {
    const run = await loadPhase2Run(directory); assert.deepEqual(run.candidates.map((candidate) => (candidate.telemetry.hard_gates as Array<{ status: string }>).map((gate) => gate.status)), Array.from({ length: 2 }, () => Array.from({ length: 10 }, () => "passed"))); const { packet } = buildJudgePacket(run); const labels = (packet.candidates as Array<{ label: string }>).map((candidate) => candidate.label);
    const judge = new FakeJudge(["malformed", JSON.stringify(response(labels))]); const evaluation = await adjudicateRun(directory, judge);
    assert.equal(evaluation.outcome, "RECOMMENDATION"); assert.equal(judge.calls, 2); assert.doesNotMatch(await readFile(join(directory, "masked-judge-input.json"), "utf8"), /candidate-\d/);
    assert.equal(JSON.parse(await readFile(join(directory, "judge-result.json"), "utf8")).status, "completed"); assert.equal(JSON.parse(await readFile(join(directory, "evaluation.json"), "utf8")).candidates.length, 2);
    await assert.rejects(() => adjudicateRun(directory, judge), /already exists/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("ineligible candidates produce deterministic no-winner without a judge call", async () => {
  const { temporary, directory } = await phase2Run(new EmptyAdapter());
  try { const judge = new FakeJudge([]); const evaluation = await adjudicateRun(directory, judge); assert.equal(evaluation.outcome, "NO_WINNER"); assert.equal(judge.calls, 0); assert.equal(JSON.parse(await readFile(join(directory, "judge-result.json"), "utf8")).status, "not_invoked_no_eligible_candidates"); }
  finally { await rm(temporary, { recursive: true, force: true }); }
});

test("judge execution failure is inconclusive and is not repaired", async () => {
  const { temporary, directory } = await phase2Run();
  try { const judge = new FailedJudge([]); const evaluation = await adjudicateRun(directory, judge); assert.equal(evaluation.outcome, "INCONCLUSIVE"); assert.equal(judge.calls, 1); }
  finally { await rm(temporary, { recursive: true, force: true }); }
});

test("packet validation and dry run reject unsafe evidence and never invoke a judge", async () => {
  const { temporary, directory } = await phase2Run();
  try {
    const safe = await adjudicationDryRun(directory); assert.equal(safe.reasoning_effort, "low"); assert.equal((await adjudicationDryRun(directory, { ...defaultJudgeConfig, reasoning_effort: "high" })).reasoning_effort, "high"); assert.match(JSON.stringify(safe.command_shape), /read-only/); assert.match(JSON.stringify(safe.command_shape), /ephemeral/);
    const manifestPath = join(directory, "manifest.json"); const manifest = JSON.parse(await readFile(manifestPath, "utf8")); manifest.candidate_count = 3; await writeFile(manifestPath, JSON.stringify(manifest)); await assert.rejects(() => loadPhase2Run(directory), /count mismatch/);
    await assert.rejects(() => adjudicationDryRun(directory, { ...defaultJudgeConfig, reasoning_effort: "xhigh" as "low" }), /low or high/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
