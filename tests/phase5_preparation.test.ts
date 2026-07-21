import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { codexArgs, openCodeArgs } from "../src/adapters";
import { validateConfiguredAcceptance } from "../src/acceptance";
import { responseCharacterLimit } from "../src/adjudication";
import { previewTrial } from "../src/preview";
import { configurationHash, reasoningProvenance, trialSnapshot } from "../src/telemetry";
import { loadTrial, validateTrial } from "../src/trial";
import { topologyFromTrial } from "../src/topology";
import { parse } from "yaml";

const root = resolve(__dirname, "..", "..");
const request = (candidate: any) => ({ candidate, worktree: "worktree", artifactDirectory: "artifacts", prompt: "task", timeoutMs: 1_000 });

test("native effort fields preserve harness literals, conflicts, mapping, snapshots, and topology", async () => {
  const base = { id: "one", adapter: "codex-exec" as const, harness: "codex", model: "gpt-5.6-luna", nativeReasoningEffort: "xhigh", displayName: "Luna Extra High via Codex", displayVariant: "Extra High", providerRoute: "codex-authenticated" };
  assert.deepEqual(codexArgs(request(base)).filter((item) => item.includes("model_reasoning_effort")), ['model_reasoning_effort="xhigh"']);
  const open = { ...base, id: "two", adapter: "opencode-run" as const, harness: "opencode", provider: "deepseek", providerRoute: "opencode-direct-deepseek-api", nativeReasoningEffort: "xhigh", attention: "legacy", adapterOptions: { native_variant: "xhigh" } };
  assert.deepEqual(openCodeArgs(request(open)).slice(-3, -1), ["--variant", "xhigh"]);
  assert.deepEqual(reasoningProvenance(open), { requested_harness_variant: "xhigh", native_reasoning_effort: "xhigh", effective_provider_reasoning_effort: "max", evidence_source: "documented_deepseek_compatibility_mapping" });
  const raw = { id: "native", repository: "repo", baseline_ref: "base", task_contract: "task", allowed_paths: ["src"], forbidden_paths: ["acceptance"], validation_commands: [[process.execPath, "-e", ""]], validation_timeout_ms: 1, dependency_policy: "no_changes", timeout_ms: 1, retry_policy: { max_launch_transport_retries: 1 }, manual_intervention: "forbidden", provenance: {}, candidates: [{ id: "one", adapter: "codex-exec", harness: "codex", model: "gpt-5.6-luna", native_reasoning_effort: "xhigh", display_name: "Luna Extra High via Codex", display_variant: "Extra High", provider_route: "codex-authenticated" }, { id: "three", adapter: "codex-exec", harness: "codex", model: "gpt-5.6-luna", native_reasoning_effort: "xhigh", display_name: "Luna Extra High via Codex", display_variant: "Extra High", provider_route: "other-route" }] };
  const trial = validateTrial(raw);
  assert.notEqual(configurationHash(trial.candidates[0], trial), configurationHash(trial.candidates[1], trial));
  assert.equal((trialSnapshot(trial).candidates as any)[0].display_name, "Luna Extra High via Codex");
  assert.throws(() => validateTrial({ ...raw, candidates: [{ ...raw.candidates[0], id: "bad", adapter_options: { config_overrides: { model_reasoning_effort: "high" } } }, { ...raw.candidates[1], id: "other" }] }), /conflicts/);
  const topology = topologyFromTrial(trial); assert.ok(topology.varied_dimensions.some((item) => item.dimension === "provider_route")); assert.equal(topology.varied_dimensions.some((item) => item.dimension === "attention"), false);
});

test("six-label response ceiling stays bounded and the flagship remains intentionally blocked", async () => {
  assert.equal(responseCharacterLimit(6), 16_000); assert.equal(responseCharacterLimit(27), 32_000); assert.equal(responseCharacterLimit(100), 32_000);
  const trial = await loadTrial(resolve(root, "examples", "concurrency-scheduler-phase5.yml")), preview = previewTrial(trial);
  assert.equal(trial.candidates.length, 6); assert.equal(preview.topology.distinct_configuration_count, 6); assert.ok(preview.placeholder_warnings.some((value) => value.startsWith("REPLACE_"))); assert.ok(preview.topology.varied_dimensions.some((item) => item.dimension === "provider_route")); assert.equal(preview.topology.controlled_sweeps.length, 0);
});

test("scheduler fixture typechecks, exposes the class API, and keeps canonical acceptance forbidden", async () => {
  execFileSync(process.execPath, [resolve(root, "node_modules", "typescript", "bin", "tsc"), "-p", resolve(root, "fixtures", "concurrency-scheduler", "tsconfig.json"), "--noEmit"], { stdio: "inherit" });
  const [source, trial] = await Promise.all([readFile(resolve(root, "fixtures", "concurrency-scheduler", "src", "scheduler.ts"), "utf8"), readFile(resolve(root, "examples", "concurrency-scheduler-phase5.yml"), "utf8")]);
  assert.match(source, /class TaskScheduler/); assert.match(source, /schedule<T>/); assert.match(source, /cancel\(/); assert.match(source, /drain\(/); assert.ok((parse(trial).forbidden_paths as string[]).includes("fixtures/concurrency-scheduler/acceptance"));
});

test("configured canonical acceptance uses an argument array and retains its own evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arena-configured-acceptance-"));
  try {
    const result = await validateConfiguredAcceptance(directory, directory, [process.execPath, "-e", "process.stdout.write('accepted')"], 1_000, root);
    assert.equal(result.validator, "configured-command"); assert.equal(result.status, "passed"); assert.equal(result.stdout, "accepted"); assert.equal(JSON.parse(await readFile(join(directory, "acceptance.json"), "utf8")).args[0], process.execPath);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
