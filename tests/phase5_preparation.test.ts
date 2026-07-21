import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { codexArgs, openCodeArgs, openCodeEnvironment, processInvocation } from "../src/adapters";
import { validateConfiguredAcceptance } from "../src/acceptance";
import { responseCharacterLimit } from "../src/adjudication";
import { previewTrial } from "../src/preview";
import { configurationHash, reasoningProvenance, trialSnapshot } from "../src/telemetry";
import { loadTrial, validateTrial } from "../src/trial";
import { topologyFromTrial } from "../src/topology";
import { doctorTrial } from "../src/doctor";
import { runCleanCommand, verifyClean } from "../src/clean-verify";
import { verifySchedulerBaseline } from "../src/scheduler-baseline";
import { sanitizeSample } from "../src/sanitize";
import { generateReport } from "../src/report";
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
  const flagship = parse(await readFile(resolve(root, "examples", "concurrency-scheduler-phase5.yml"), "utf8")), trial = validateTrial(flagship), preview = previewTrial(trial);
  assert.equal(trial.candidates.length, 6); assert.equal(preview.topology.distinct_configuration_count, 6); assert.ok(preview.placeholder_warnings.some((value) => value.startsWith("REPLACE_"))); assert.ok(preview.topology.varied_dimensions.some((item) => item.dimension === "provider_route")); assert.equal(preview.topology.controlled_sweeps.length, 0); assert.equal(trial.diagnosticProbe?.path, "fixtures/concurrency-scheduler/src/arena-write-probe.txt");
  assert.throws(() => validateTrial({ ...flagship, diagnostic_probe: { path: "../unsafe", content: "no" } }), /safe relative/);
});

test("scheduler fixture typechecks, exposes the class API, and keeps canonical acceptance forbidden", async () => {
  execFileSync(process.execPath, [resolve(root, "node_modules", "typescript", "bin", "tsc"), "-p", resolve(root, "fixtures", "concurrency-scheduler", "tsconfig.json"), "--noEmit"], { stdio: "inherit" });
  const [source, trial] = await Promise.all([readFile(resolve(root, "fixtures", "concurrency-scheduler", "src", "scheduler.ts"), "utf8"), readFile(resolve(root, "examples", "concurrency-scheduler-phase5.yml"), "utf8")]);
  assert.match(source, /class TaskScheduler/); assert.match(source, /schedule<T>/); assert.match(source, /cancel\(/); assert.match(source, /drain\(/); assert.ok((parse(trial).forbidden_paths as string[]).includes("fixtures/concurrency-scheduler/acceptance"));
});

test("canonical scheduler acceptance is complete, fast, and intentionally fails the defective baseline", async () => {
  const acceptance = await readFile(resolve(root, "fixtures", "concurrency-scheduler", "acceptance", "scheduler.acceptance.test.js"), "utf8");
  assert.match(acceptance, /signals\[0\]\?\.aborted/); assert.match(acceptance, /duplicate IDs, cancellation, and terminal ID reuse/); assert.match(acceptance, /retries, drain, and final errors/);
  const result = spawnSync(process.execPath, ["--test", resolve(root, "fixtures", "concurrency-scheduler", "acceptance", "scheduler.acceptance.test.js")], { cwd: root, timeout: 5_000 });
  assert.equal(result.signal, null);
});

test("configured canonical acceptance uses an argument array and retains its own evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arena-configured-acceptance-"));
  try {
    const result = await validateConfiguredAcceptance(directory, directory, [process.execPath, "-e", "process.stdout.write('accepted')"], 1_000, root);
    assert.equal(result.validator, "configured-command"); assert.equal(result.status, "passed"); assert.equal(result.stdout, "accepted"); assert.equal(JSON.parse(await readFile(join(directory, "acceptance.json"), "utf8")).args[0], process.execPath);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("route-aware doctor reports all candidates, deduplicates routes, and never runs a task", async () => {
  const raw = await loadTrial(resolve(root, "examples", "concurrency-scheduler-phase5.yml"));
  const adapters: any = new Map([["codex-exec", { doctor: async () => ({ adapter: "codex", ok: true, executable_status: "available", authentication: { existing_cli_state: "usable", optional_access_token: "absent" } }) }], ["opencode-run", { doctor: async () => ({ adapter: "opencode", ok: true, executable_status: "available", authentication: { existing_cli_state: "usable", optional_access_token: "absent" }, configuration_layering: { status: "composed", reason: "fixture" } }) }]]);
  let calls = 0;
  const dependencies = { openCodeCommand: async () => "fake-opencode", commandStatus: async (_command: string, args: string[]) => { calls++; return args[0] === "auth" ? { ok: true, stdout: "OpenAI\nOpenCode Go\nDeepSeek", unavailable: false } : { ok: true, stdout: `${args[1]}/deepseek-v4-flash\n${args[1]}/gpt-5.6-terra`, unavailable: false }; } };
  const blocked = await doctorTrial(raw, adapters, dependencies);
  assert.equal(blocked.candidates.length, 6); assert.equal(blocked.provider_routes.length, 4); assert.equal(blocked.readiness, "blocked"); assert.ok(blocked.candidates.filter((candidate) => candidate.adapter === "opencode-run").every((candidate) => candidate.failure_classification === "unresolved_placeholder"));
  const ready = { ...raw, candidates: raw.candidates.map((candidate) => candidate.adapter === "opencode-run" ? { ...candidate, adapterOptions: { native_variant: "max" } } : candidate) };
  const report = await doctorTrial(ready, adapters, dependencies);
  assert.equal(report.readiness, "ready"); assert.ok(calls > 0); assert.ok(report.candidates.every((candidate) => candidate.command_shape.at(-1)?.startsWith("<task-contract:"))); assert.ok(report.candidates.filter((candidate) => candidate.adapter === "opencode-run").every((candidate) => candidate.variant_syntax === "declared_unverified" && candidate.warnings.some((warning) => /diagnostic/.test(warning))));
  const unavailable = await doctorTrial(ready, adapters, { ...dependencies, commandStatus: async (_command: string, args: string[]) => args[0] === "models" ? { ok: false, stdout: "", error: "offline", unavailable: false } : { ok: true, stdout: "OpenAI\nOpenCode Go\nDeepSeek", unavailable: false } });
  assert.ok(unavailable.candidates.some((candidate) => candidate.failure_classification === "model_discovery_unavailable"));
});

test("doctor checks candidate-specific executable overrides instead of adapter-only cache entries", async () => {
  const trial = validateTrial({ id: "doctor-overrides", repository: "repo", baseline_ref: "base", task_contract: "task", allowed_paths: ["src"], forbidden_paths: ["acceptance"], validation_commands: [[process.execPath, "-e", ""]], validation_timeout_ms: 1, dependency_policy: "no_changes", timeout_ms: 1, retry_policy: { max_launch_transport_retries: 1 }, manual_intervention: "forbidden", provenance: {}, candidates: [
    { id: "available", adapter: "codex-exec", harness: "codex", model: "gpt", adapter_options: { codex_executable: "available.cmd" } },
    { id: "missing", adapter: "codex-exec", harness: "codex", model: "gpt", adapter_options: { codex_executable: "missing.cmd" } }
  ] });
  const checked: string[] = [], adapters: any = new Map([["codex-exec", { doctor: async (candidate: any) => { checked.push(candidate.adapterOptions.codex_executable); return candidate.adapterOptions.codex_executable === "available.cmd" ? { adapter: "codex", ok: true, executable_status: "available" } : { adapter: "codex", ok: false, executable_status: "unavailable" }; } }]]);
  const report = await doctorTrial(trial, adapters);
  assert.deepEqual(checked, ["available.cmd", "missing.cmd"]); assert.equal(report.candidates.find((candidate) => candidate.candidate_id === "available")?.readiness, "ready"); assert.equal(report.candidates.find((candidate) => candidate.candidate_id === "missing")?.failure_classification, "adapter_unavailable");
});

test("OpenCode permission layering preserves a separate provider config and refuses inline replacement", () => {
  const environment = openCodeEnvironment({ OPENCODE_CONFIG: "nonsecret-provider.json" });
  assert.equal(environment.OPENCODE_CONFIG, "nonsecret-provider.json"); assert.doesNotMatch(environment.OPENCODE_CONFIG_CONTENT ?? "", /provider/i); assert.match(environment.OPENCODE_CONFIG_CONTENT ?? "", /webfetch/);
  assert.throws(() => openCodeEnvironment({ OPENCODE_CONFIG_CONTENT: '{"provider":{"fixture":{}}}' }), /cannot be safely composed/);
  assert.equal(processInvocation("tool.cmd", ["one"], "win32").command.toLowerCase().endsWith("cmd.exe"), true);
});

const baselineTap = [
  "✔ canonical scheduler acceptance: FIFO and concurrency never exceed the limit (1ms)",
  "✖ canonical scheduler acceptance: duplicate IDs, cancellation, and terminal ID reuse (1ms)",
  "✖ canonical scheduler acceptance: retries, drain, and final errors are deterministic (1ms)",
  "ℹ tests 3", "ℹ pass 1", "ℹ fail 2", "AssertionError [ERR_ASSERTION]", "AssertionError [ERR_ASSERTION]"
].join("\n");
const baselineTap20 = [
  "ok 1 - canonical scheduler acceptance: FIFO and concurrency never exceed the limit",
  "not ok 2 - canonical scheduler acceptance: duplicate IDs, cancellation, and terminal ID reuse",
  "not ok 3 - canonical scheduler acceptance: retries, drain, and final errors are deterministic",
  "# tests 3", "# pass 1", "# fail 2", "code: 'ERR_ASSERTION'", "code: 'ERR_ASSERTION'"
].join("\n");

test("scheduler baseline contract accepts only the named defective behavioral evidence", async () => {
  const normal = async (_command: string, args: string[]) => args.includes("--test") ? { exit_code: 1, timeout: false, launch_error: null, stdout: baselineTap, stderr: "" } : { exit_code: 0, timeout: false, launch_error: null, stdout: "", stderr: "" };
  assert.equal((await verifySchedulerBaseline({ root, run: normal })).status, "VERIFIED");
  assert.equal((await verifySchedulerBaseline({ root, run: async (_command, args) => args.includes("--test") ? { exit_code: 1, timeout: false, launch_error: null, stdout: baselineTap20, stderr: "" } : { exit_code: 0, timeout: false, launch_error: null, stdout: "", stderr: "" } })).status, "VERIFIED");
  const cases: Array<[string, any, string]> = [
    ["compile failure", async () => ({ exit_code: 1, timeout: false, launch_error: null, stdout: "", stderr: "" }), "compile_failure"],
    ["launch failure", async () => ({ exit_code: null, timeout: false, launch_error: "missing", stdout: "", stderr: "" }), "compile_launch_failure"],
    ["timeout", async () => ({ exit_code: null, timeout: true, launch_error: null, stdout: "", stderr: "" }), "compile_timeout"],
    ["missing acceptance", async (_command: string, args: string[]) => args.includes("--test") ? { exit_code: 1, timeout: false, launch_error: null, stdout: "Cannot find module scheduler.acceptance.test.js", stderr: "" } : { exit_code: 0, timeout: false, launch_error: null, stdout: "", stderr: "" }, "acceptance_infrastructure_failure"],
    ["syntax error", async (_command: string, args: string[]) => args.includes("--test") ? { exit_code: 1, timeout: false, launch_error: null, stdout: "SyntaxError: unexpected token", stderr: "" } : { exit_code: 0, timeout: false, launch_error: null, stdout: "", stderr: "" }, "acceptance_infrastructure_failure"],
    ["arbitrary failure", async (_command: string, args: string[]) => args.includes("--test") ? { exit_code: 1, timeout: false, launch_error: null, stdout: "failure", stderr: "" } : { exit_code: 0, timeout: false, launch_error: null, stdout: "", stderr: "" }, "canonical_test_inventory_mismatch"],
    ["unexpected pass", async (_command: string, args: string[]) => args.includes("--test") ? { exit_code: 0, timeout: false, launch_error: null, stdout: baselineTap, stderr: "" } : { exit_code: 0, timeout: false, launch_error: null, stdout: "", stderr: "" }, "unexpected_acceptance_pass"]
  ];
  for (const [, run, classification] of cases) assert.equal((await verifySchedulerBaseline({ root, run })).classification, classification);
});

test("clean verification invokes the baseline contract as a normal passing command and rejects failed cleanup", async () => {
  const calls: string[] = [];
  const result = await verifyClean({ root, run: async (_command, args) => { calls.push(args.join(" ")); if (args.includes("pack")) return { exit_code: 0, timeout: false, launch_error: null, stdout: '[{"filename":"arena.tgz"}]' }; return { exit_code: 0, timeout: false, launch_error: null, stdout: "", stderr: "" }; } });
  assert.equal(result.status, "VERIFIED"); assert.ok(result.checks.some((check) => check.id === "scheduler_baseline_contract" && check.classification === "completed")); assert.ok(calls.some((value) => value.includes("scheduler:baseline-contract")));
  let worktree = "";
  const failedRemoval = await verifyClean({ root, run: async (_command, args) => {
    if (args[0] === "worktree" && args[1] === "add") { worktree = args[3]; return { exit_code: 0, timeout: false, launch_error: null, stdout: "", stderr: "" }; }
    if (args[0] === "worktree" && args[1] === "remove") return { exit_code: 1, timeout: false, launch_error: null, stdout: "", stderr: "" };
    if (args[0] === "worktree" && args[1] === "list") return { exit_code: 0, timeout: false, launch_error: null, stdout: `worktree ${worktree}\n`, stderr: "" };
    if (args.includes("pack")) return { exit_code: 0, timeout: false, launch_error: null, stdout: '[{"filename":"arena.tgz"}]', stderr: "" };
    return { exit_code: 0, timeout: false, launch_error: null, stdout: "", stderr: "" };
  } });
  assert.equal(failedRemoval.status, "FAILED"); assert.ok(failedRemoval.checks.some((check) => check.id === "worktree_registration" && check.status === "failed"));
});

test("clean command timeout terminates a descendant process", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-clean-tree-")), marker = join(temporary, "descendant.txt");
  try {
    const child = `const {spawn}=require('node:child_process'); const fs=require('node:fs'); spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>fs.writeFileSync(${JSON.stringify(marker)}, 'leaked'), 250)`) }],{stdio:'ignore'}); setInterval(()=>{},1000);`;
    const result = await runCleanCommand(process.execPath, ["-e", child], root, 50);
    assert.equal(result.timeout, true); await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(await readFile(marker, "utf8").then(() => true).catch(() => false), false);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("sample sanitation is deterministic, verifies output, and preserves the source run", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-sanitize-")), source = join(temporary, "source"), output = join(temporary, "sample");
  try {
    await cp(resolve(root, "examples", "demo-run"), source, { recursive: true });
    await generateReport(source);
    const before = await Promise.all(["manifest.json", "candidates/codex-luna-low/provenance.json", "candidates/codex-luna-low/validation.json"].map((path) => readFile(join(source, ...path.split("/")), "utf8")));
    const first = await sanitizeSample(source, output), report = await readFile(join(output, "report.html"), "utf8");
    assert.equal(first.report, "report.html"); assert.match(report, /Arena static product report/); assert.deepEqual(await Promise.all(["manifest.json", "candidates/codex-luna-low/provenance.json", "candidates/codex-luna-low/validation.json"].map((path) => readFile(join(source, ...path.split("/")), "utf8"))), before);
    await sanitizeSample(source, output); assert.deepEqual(await Promise.all(["manifest.json", "candidates/codex-luna-low/provenance.json", "candidates/codex-luna-low/validation.json"].map((path) => readFile(join(source, ...path.split("/")), "utf8"))), before);
    await writeFile(join(source, "manifest.json"), "{}", "utf8"); await assert.rejects(() => sanitizeSample(source, join(temporary, "rejected")), /verified/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("sample sanitation omits unknown nested values and rejects unsafe known public evidence", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-sanitize-malicious-"));
  try {
    const source = join(temporary, "source"), clean = join(temporary, "clean"), provenancePath = join(source, "candidates", "codex-luna-low", "provenance.json");
    await cp(resolve(root, "examples", "demo-run"), source, { recursive: true });
    const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
    provenance.candidate_tool_provenance = { explicitly_enabled: [], hidden: { api_key: "sk-abcdefghijklmnop" } };
    provenance.reasoning = { ...provenance.reasoning, hidden: { session_id: "session-123" } };
    await writeFile(provenancePath, JSON.stringify(provenance, null, 2)); await generateReport(source);
    await sanitizeSample(source, clean);
    const sanitized = await readFile(join(clean, "candidates", "codex-luna-low", "provenance.json"), "utf8");
    assert.doesNotMatch(sanitized, /sk-abcdefghijklmnop|session-123|hidden/);

    const badModel = join(temporary, "bad-model"); await cp(source, badModel, { recursive: true });
    const modelPath = join(badModel, "candidates", "codex-luna-low", "provenance.json"), model = JSON.parse(await readFile(modelPath, "utf8"));
    model.model = "C:\\Users\\private\\model"; await writeFile(modelPath, JSON.stringify(model, null, 2)); await generateReport(badModel);
    await assert.rejects(() => sanitizeSample(badModel, join(temporary, "bad-model-sample")), /secret or absolute path/);

    const badValidation = join(temporary, "bad-validation"); await cp(source, badValidation, { recursive: true });
    const validationPath = join(badValidation, "candidates", "codex-luna-low", "validation.json"), validation = JSON.parse(await readFile(validationPath, "utf8"));
    validation.commands[0].args = ["C:\\Users\\private\\tool"]; await writeFile(validationPath, JSON.stringify(validation, null, 2)); await generateReport(badValidation);
    await assert.rejects(() => sanitizeSample(badValidation, join(temporary, "bad-validation-sample")), /secret or absolute path/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
