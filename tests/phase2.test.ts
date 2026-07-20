import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CandidateAdapter, CandidateExecution, CandidateRequest } from "../src/adapters";
import { interventionGate, phase3PacketReady, runTrial } from "../src/runner";
import { Candidate, Trial } from "../src/trial";
import { aggregateGateStatus, available, configurationHash, extractNativeTelemetry, unavailable } from "../src/telemetry";

const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

async function repository(parent: string): Promise<string> {
  const root = join(parent, "repository");
  await mkdir(join(root, "src"), { recursive: true });
  git(parent, ["init", root]);
  await Promise.all([writeFile(join(root, "package.json"), "{\"dependencies\":{\"before\":\"1.0.0\"}}\n"), writeFile(join(root, "src", "base.txt"), "base\n")]);
  git(root, ["config", "user.email", "arena@example.test"]); git(root, ["config", "user.name", "Arena"]); git(root, ["add", "."]); git(root, ["commit", "-m", "baseline"]); git(root, ["tag", "baseline"]);
  return root;
}

function trial(repositoryPath: string): Trial {
  const candidates: Candidate[] = ["one", "two"].map((id) => ({ id, adapter: "codex-exec", harness: "codex", model: "fake", toolProvenance: { explicitly_enabled: ["tool-b", "tool-a"] } }));
  return { id: "phase2", repository: repositoryPath, baselineRef: "baseline", taskContract: "fix", allowedPaths: ["src"], forbiddenPaths: [], validationCommands: [[process.execPath, "-e", "process.stdout.write('checked'); process.stderr.write('diagnostic')"]], timeoutMs: 1_000, validationTimeoutMs: 1_000, dependencyPolicy: "no_changes", maxLaunchTransportRetries: 1, manualIntervention: "forbidden", provenance: {}, candidates };
}

class Adapter implements CandidateAdapter {
  async doctor() { return { adapter: "fake", ok: true }; }
  async execute(request: CandidateRequest): Promise<CandidateExecution> {
    await writeFile(join(request.worktree, "src", `${request.candidate.id}.txt`), "changed\n");
    await writeFile(join(request.artifactDirectory, "stdout.log"), '{"type":"turn.started"}\n{"type":"item.completed","item":{"type":"command_execution"}}\n{"type":"turn.completed","tokens":{"input":12,"cached":3,"output":4}}\nunknown\n');
    await writeFile(join(request.artifactDirectory, "stderr.log"), "");
    await writeFile(join(request.artifactDirectory, "final-response.txt"), "done\n");
    return { args: ["fake"], startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.010Z", durationMs: 10, exitCode: 0, timedOut: false };
  }
}

class MutationAdapter extends Adapter {
  constructor(private readonly mutate: (request: CandidateRequest) => Promise<void>) { super(); }
  async execute(request: CandidateRequest): Promise<CandidateExecution> { await this.mutate(request); return super.execute(request); }
}

class OutcomeAdapter implements CandidateAdapter {
  constructor(private readonly outcome: "empty" | "timeout" | "launch" | "acceptance") {}
  async doctor() { return { adapter: "fake", ok: true }; }
  async execute(request: CandidateRequest): Promise<CandidateExecution> {
    if (this.outcome === "acceptance") {
      const source = join(request.worktree, "fixtures", "bounded-inventory", "src");
      await mkdir(source, { recursive: true });
      await writeFile(join(source, "inventory.ts"), "export function inventoryTotal(): number { return 0; }\n");
    }
    await writeFile(join(request.artifactDirectory, "stdout.log"), "");
    await writeFile(join(request.artifactDirectory, "stderr.log"), "");
    return { args: ["fake"], startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.010Z", durationMs: 10, exitCode: this.outcome === "launch" ? null : 0, timedOut: this.outcome === "timeout", failureKind: this.outcome === "launch" ? "launch" : this.outcome === "timeout" ? "timeout" : undefined, launchError: this.outcome === "launch" ? "launch failed" : undefined };
  }
}

class CleanAdapter implements CandidateAdapter {
  async doctor() { return { adapter: "fake", ok: true }; }
  async execute(request: CandidateRequest): Promise<CandidateExecution> {
    const source = join(request.worktree, "fixtures", "bounded-inventory", "src");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "inventory.ts"), "export function inventoryTotal(lines: Array<{ quantity: number; unitPrice: number }>): number { return Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100; }\n");
    await writeFile(join(request.artifactDirectory, "stdout.log"), '{"type":"turn.started"}\n{"type":"turn.completed"}\n');
    await writeFile(join(request.artifactDirectory, "stderr.log"), "");
    return { args: ["fake"], startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.010Z", durationMs: 10, exitCode: 0, timedOut: false };
  }
}

class InterventionAdapter extends CleanAdapter {
  async execute(request: CandidateRequest): Promise<CandidateExecution> {
    const execution = await super.execute(request);
    await writeFile(join(request.artifactDirectory, "stdout.log"), '{"type":"turn.started"}\n{"type":"permission.denied"}\n{"type":"turn.completed"}\n');
    return execution;
  }
}

async function outcomeTelemetry(outcome: ConstructorParameters<typeof OutcomeAdapter>[0], configure?: (value: Trial) => void): Promise<Record<string, unknown>> {
  const temporary = await mkdtemp(join(tmpdir(), `arena-outcome-${outcome}-`));
  try {
    const source = await repository(temporary);
    const fixture = trial(source);
    if (outcome === "acceptance") fixture.allowedPaths.push("fixtures/bounded-inventory/src");
    configure?.(fixture);
    const result = await runTrial(fixture, new Map([["codex-exec", new OutcomeAdapter(outcome)]]), join(temporary, "output"));
    return JSON.parse(await readFile(join(result.directory, "candidates", "one", "telemetry.json"), "utf8"));
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

test("dependency facts distinguish additions, removals, versions, section movement, lockfiles, malformed manifests, and no change", async () => {
  const cases: Array<[string, (request: CandidateRequest) => Promise<void>, string, string]> = [
    ["addition", async (request) => writeFile(join(request.worktree, "package.json"), '{"dependencies":{"before":"1.0.0","added":"1.0.0"}}'), "added", "failed"],
    ["removal", async (request) => writeFile(join(request.worktree, "package.json"), '{"dependencies":{}}'), "removed", "failed"],
    ["version", async (request) => writeFile(join(request.worktree, "package.json"), '{"dependencies":{"before":"2.0.0"}}'), "changed", "failed"],
    ["movement", async (request) => writeFile(join(request.worktree, "package.json"), '{"devDependencies":{"before":"1.0.0"}}'), "changed", "failed"],
    ["lockfile", async (request) => writeFile(join(request.worktree, "package-lock.json"), "{}\n"), "lockfile_changed", "failed"],
    ["malformed", async (request) => writeFile(join(request.worktree, "package.json"), "{"), "unresolved_comparison", "unavailable"],
    ["unchanged", async () => {}, "semantic_dependency_state_changed", "passed"]
  ];
  for (const [name, mutate, fact, gateStatus] of cases) {
    const temporary = await mkdtemp(join(tmpdir(), `arena-dependencies-${name}-`));
    try {
      const source = await repository(temporary);
      const result = await runTrial(trial(source), new Map([["codex-exec", new MutationAdapter(mutate)]]), join(temporary, "output"));
      const telemetry = JSON.parse(await readFile(join(result.directory, "candidates", "one", "telemetry.json"), "utf8"));
      if (name === "unchanged") assert.equal(telemetry.change_analysis.dependencies[fact], false);
      else assert.ok(telemetry.change_analysis.dependencies[fact] === true || telemetry.change_analysis.dependencies[fact].length > 0 || telemetry.change_analysis.dependencies[fact]);
      assert.equal(telemetry.hard_gates.find((gate: { id: string }) => gate.id === "dependency_policy").status, gateStatus);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
});

test("runner records validation failures and timeouts as deterministic gate failures", async () => {
  const failed = await outcomeTelemetry("empty", (fixture) => { fixture.validationCommands = [[process.execPath, "-e", "process.exit(2)"]]; });
  assert.equal((failed.hard_gates as Array<{ id: string; status: string }>).find((gate) => gate.id === "required_validation_passed")?.status, "failed");
  const timedOut = await outcomeTelemetry("empty", (fixture) => { fixture.validationTimeoutMs = 10; fixture.validationCommands = [[process.execPath, "-e", "setTimeout(() => {}, 1000)"]]; });
  const commands = (timedOut as { change_analysis: unknown; evidence_completeness: unknown; hard_gates: unknown; }).hard_gates as Array<{ id: string; status: string }>;
  assert.equal(commands.find((gate) => gate.id === "required_validation_passed")?.status, "failed");
});

test("runner gates timeout, empty results, failed launch evidence, and acceptance failure", async () => {
  const timeout = await outcomeTelemetry("timeout");
  assert.equal((timeout.hard_gates as Array<{ id: string; status: string }>).find((gate) => gate.id === "process_timeout")?.status, "failed");
  const empty = await outcomeTelemetry("empty");
  assert.equal((empty.hard_gates as Array<{ id: string; status: string }>).find((gate) => gate.id === "nonempty_candidate_result")?.status, "failed");
  const launch = await outcomeTelemetry("launch");
  assert.equal((launch.hard_gates as Array<{ id: string; status: string }>).find((gate) => gate.id === "required_evidence_complete")?.status, "passed");
  const acceptance = await outcomeTelemetry("acceptance");
  assert.equal((acceptance.hard_gates as Array<{ id: string; status: string }>).find((gate) => gate.id === "acceptance_validator")?.status, "failed");
});

test("native extraction preserves unknown and malformed evidence without inventing metrics", () => {
  const codex = extractNativeTelemetry("codex", '{"type":"turn.started"}\n{"type":"item.completed","item":{"type":"command_execution"}}\n???\n{"type":"future.event"}\n');
  assert.equal(codex.extracted.turn_count.value, 1);
  assert.equal(codex.extracted.command_count.value, 1);
  assert.equal(codex.extracted.input_tokens.availability, "unavailable");
  assert.equal(codex.malformed_lines.length, 1);
  assert.equal(codex.unknown_events.length, 1);
  const opencode = extractNativeTelemetry("opencode", '{"type":"step_start"}\n{"type":"tool_use"}\n');
  assert.equal(opencode.extracted.turn_count.value, 1);
  assert.equal(opencode.extracted.tool_call_count.value, 1);
});

test("native event-derived counters are unavailable without directly observed events", () => {
  for (const [harness, raw] of [["codex", ""], ["codex", "bad"], ["codex", '{"type":"future.event"}\n'], ["other", '{"type":"turn.started"}\n']] as const) {
    const telemetry = extractNativeTelemetry(harness, raw);
    for (const metric of ["turn_count", "tool_call_count", "command_count", "approval_count", "permission_denials", "user_questions", "error_count"]) assert.equal(telemetry.extracted[metric].availability, "unavailable");
  }
  assert.equal(extractNativeTelemetry("codex", '{"type":"turn.started"}\n').extracted.turn_count.value, 1);
});

test("complete native streams establish clean intervention zero only at real terminals", () => {
  const codex = extractNativeTelemetry("codex", '{"type":"turn.started"}\n{"type":"turn.completed"}\n');
  assert.equal(codex.stream_complete, true);
  assert.equal(codex.extracted.permission_denials.value, 0);
  assert.equal(codex.extracted.user_questions.value, 0);
  const openCode = extractNativeTelemetry("opencode", '{"type":"step_finish","part":{"reason":"stop"}}\n');
  assert.equal(openCode.stream_complete, true);
  assert.equal(openCode.extracted.permission_denials.value, 0);
  assert.equal(openCode.extracted.user_questions.value, 0);
  const truncated = extractNativeTelemetry("opencode", '{"type":"step_finish","part":{"reason":"tool-calls"}}\n');
  assert.equal(truncated.stream_complete, false);
  assert.equal(truncated.extracted.permission_denials.availability, "unavailable");
  const denied = extractNativeTelemetry("codex", '{"type":"turn.completed"}\n{"type":"permission.denied"}\n');
  assert.equal(denied.extracted.permission_denials.value, 1);
});

test("hard gate aggregation gives failure strict precedence", () => {
  assert.equal(aggregateGateStatus(["passed", "passed"]), "passed");
  assert.equal(aggregateGateStatus(["passed", "unavailable"]), "unavailable");
  assert.equal(aggregateGateStatus(["passed", "failed"]), "failed");
  assert.equal(aggregateGateStatus(["failed", "unavailable"]), "failed");
});

test("intervention gate distinguishes pass, failure, and unavailable evidence", () => {
  const base = { manual_prompt_corrections: 0, manual_file_edits: 0, aborts: 0, permission_denials: available(0), user_questions: available(0) };
  assert.equal(interventionGate("forbidden", base, 1).status, "passed");
  assert.equal(interventionGate("forbidden", { ...base, manual_file_edits: 1 }, 0).status, "failed");
  assert.equal(interventionGate("forbidden", { ...base, permission_denials: available(1, "codex-jsonl") }, 0).status, "failed");
  assert.equal(interventionGate("forbidden", { ...base, user_questions: unavailable<number>() }, 0).status, "unavailable");
});

test("phase three packet readiness validates evidence rather than hard-gate outcome", () => {
  const ready = { telemetry: { finalization_status: "complete", hard_gates: [{ status: "failed" }], evidence_completeness: { status: "complete", artifacts: [] }, provenance: { task_contract_hash: "task", configuration_hash: "config" } }, validation: { commands: [] }, artifactDirectory: "candidates/one" };
  assert.equal(phase3PacketReady(ready), true);
  assert.equal(phase3PacketReady({ ...ready, telemetry: { ...ready.telemetry, finalization_status: "pending" } }), false);
  assert.equal(phase3PacketReady({ ...ready, artifactDirectory: "C:/private" }), false);
});

test("configuration hashes are stable for equivalent tool order and change with relevant limits", () => {
  const fixture = trial(".");
  const first = fixture.candidates[0];
  const reordered = { ...first, toolProvenance: { explicitly_enabled: ["tool-a", "tool-b"] } };
  assert.equal(configurationHash(first, fixture), configurationHash(reordered, fixture));
  assert.notEqual(configurationHash(first, fixture), configurationHash(first, { ...fixture, timeoutMs: 2_000 }));
});

test("Phase 2 run writes canonical artifacts, portable validation, facts, gates, and manifest", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-phase2-"));
  try {
    const source = await repository(temporary);
    const result = await runTrial(trial(source), new Map([["codex-exec", new Adapter()]]), join(temporary, "output"));
    assert.equal(result.candidates.length, 2);
    const candidate = join(result.directory, "candidates", "one");
    const telemetry = JSON.parse(await readFile(join(candidate, "telemetry.json"), "utf8"));
    const validation = JSON.parse(await readFile(join(candidate, "validation.json"), "utf8"));
    const manifest = JSON.parse(await readFile(join(result.directory, "manifest.json"), "utf8"));
    assert.equal(telemetry.execution.wall_clock_ms.value, 10);
    assert.equal(telemetry.execution.retry_overhead_ms.value, 0);
    assert.equal(telemetry.usage.input_tokens.value, 12);
    assert.equal(telemetry.change_analysis.pre_validation.lines_added, 1);
    assert.equal(telemetry.hard_gates.find((gate: { id: string }) => gate.id === "allowed_path_policy").status, "passed");
    assert.deepEqual(telemetry.hard_gates.map((gate: { id: string }) => gate.id), ["required_validation_completed", "required_validation_passed", "allowed_path_policy", "dependency_policy", "worktree_recoverable", "nonempty_candidate_result", "process_timeout", "required_evidence_complete", "intervention_policy", "acceptance_validator"]);
    assert.equal(telemetry.hard_gates.find((gate: { id: string }) => gate.id === "dependency_policy").status, "passed");
    assert.equal(validation.commands[0].working_directory, "<path:worktree>");
    assert.equal(validation.commands[0].stdout, "checked");
    assert.equal(validation.commands[0].stderr, "diagnostic");
    assert.equal(manifest.candidates[0].artifact_directory, "candidates/one");
    assert.ok(!JSON.stringify(manifest).includes(source));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("clean complete candidate passes intervention and all hard gates", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-clean-complete-"));
  try {
    const source = await repository(temporary);
    const fixture = trial(source);
    fixture.allowedPaths.push("fixtures/bounded-inventory/src");
    const result = await runTrial(fixture, new Map([["codex-exec", new CleanAdapter()]]), join(temporary, "output"));
    const telemetry = JSON.parse(await readFile(join(result.directory, "candidates", "one", "telemetry.json"), "utf8"));
    assert.equal(telemetry.intervention.permission_denials.value, 0);
    assert.equal(telemetry.intervention.user_questions.value, 0);
    assert.equal(telemetry.execution.human_intervention_count.value, 0);
    assert.equal(telemetry.hard_gates.find((gate: { id: string }) => gate.id === "intervention_policy").status, "passed");
    assert.equal(telemetry.output.hard_gate_status.value, "passed");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("completed native intervention evidence fails the gate and counts the intervention", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-complete-intervention-"));
  try {
    const source = await repository(temporary);
    const fixture = trial(source);
    fixture.allowedPaths.push("fixtures/bounded-inventory/src");
    const result = await runTrial(fixture, new Map([["codex-exec", new InterventionAdapter()]]), join(temporary, "output"));
    const telemetry = JSON.parse(await readFile(join(result.directory, "candidates", "one", "telemetry.json"), "utf8"));
    assert.equal(telemetry.execution.human_intervention_count.value, 1);
    assert.equal(telemetry.hard_gates.find((gate: { id: string }) => gate.id === "intervention_policy").status, "failed");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
