import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CandidateAdapter, CandidateExecution, CandidateRequest } from "../src/adapters";
import { runTrial } from "../src/runner";
import { Candidate, Trial } from "../src/trial";
import { configurationHash, extractNativeTelemetry } from "../src/telemetry";

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
