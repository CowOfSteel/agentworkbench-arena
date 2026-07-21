import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { access, cp, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { calibrate } from "../src/calibrate";
import { main } from "../src/index";
import { stagePagesSample } from "../src/pages";
import { previewTrial, renderTrialPreview } from "../src/preview";
import { buildReportModel, generateReport, loadCompletedRun, renderRecommendationYaml, verifyReport } from "../src/report";
import { trialTemplate, writeTrialTemplate } from "../src/templates";
import { analyzeTopology, topologyFromTrial } from "../src/topology";
import { loadTrial, validateTrial } from "../src/trial";

const clean = (path: string) => rm(path, { recursive: true, force: true });
const demo = resolve(__dirname, "..", "..", "examples", "demo-run");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const candidate = (id: string, attention = "low", extra: Record<string, unknown> = {}) => ({ id, dimensions: { adapter: "codex-exec", harness: "codex", provider: null, model: "model", attention, agent: null, profile: null, permission_policy: "workspace-write", declared_tools_plugins: [], ...extra } });

test("all safe templates validate, do not overwrite, and carry editable placeholders", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arena-templates-"));
  try {
    for (const kind of ["attention-sweep", "harness-comparison", "practical-comparison"] as const) {
      const text = trialTemplate(kind), trial = validateTrial(parse(text));
      assert.ok(trial.candidates.length >= 2); assert.match(text, /REPLACE_REPOSITORY/); assert.match(text, /REPLACE_BASELINE/); assert.doesNotMatch(text, /[A-Za-z]:[\\/]|file:\/\/|(?:access[_ -]?token|api[_ -]?key|password|secret)\s*[:=]/i);
      const output = join(directory, `${kind}.yml`), created = await writeTrialTemplate(kind, output);
      assert.equal(created.path, resolve(output)); await assert.rejects(() => writeTrialTemplate(kind, output), /EEXIST/);
    }
    assert.match(trialTemplate("harness-comparison"), /permission_policy: configured-build-agent/);
    const malformed: any = parse(trialTemplate("attention-sweep")); malformed.candidates[0].tool_provenance.explicitly_enabled = ["safe", 1];
    assert.throws(() => validateTrial(malformed), /explicitly_enabled.*string list/);
  } finally { await clean(directory); }
});

test("preview is offline, reports upper bounds, placeholders, topology, and the causal boundary", async () => {
  const trial = validateTrial(parse(trialTemplate("attention-sweep"))), preview = previewTrial(trial), text = renderTrialPreview(preview);
  assert.equal(preview.maximum_candidate_attempts, 2); assert.equal(preview.maximum_total_candidate_attempts, 6); assert.equal(preview.candidate_process_upper_bound_ms, trial.candidates.length * (1 + trial.maxLaunchTransportRetries) * trial.timeoutMs);
  assert.equal(preview.independent_validation_upper_bound_ms, trial.candidates.length * trial.validationCommands.length * trial.validationTimeoutMs);
  assert.ok(preview.placeholder_warnings.includes("REPLACE_TASK_CONTRACT")); assert.equal(preview.topology.controlled_sweeps.length, 1);
  assert.match(text, /upper bound/); assert.match(text, /does not establish causal effects/);
});

test("topology is order-independent and classifies sweeps, duplicates, and multi-variable comparisons at scale", async () => {
  for (const count of [2, 6, 7, 26, 27]) {
    const values = Array.from({ length: count }, (_, index) => candidate(`candidate-${index}`, index % 2 ? "medium" : "low"));
    assert.deepEqual(analyzeTopology(values), analyzeTopology([...values].reverse()));
  }
  const sweep = analyzeTopology([candidate("a", "low"), candidate("b", "high")]); assert.equal(sweep.controlled_sweeps[0].dimension, "attention");
  const duplicates = analyzeTopology([candidate("a"), candidate("b")]); assert.deepEqual(duplicates.duplicate_configuration_groups, [["a", "b"]]);
  const multiple = analyzeTopology([candidate("a"), candidate("b", "high", { harness: "opencode", adapter: "opencode-run" })]); assert.equal(multiple.multi_variable_pair_count, 1);
  const lunaTrial = await loadTrial(resolve(__dirname, "..", "..", "examples", "bounded-fix", "trial.yml")), luna = topologyFromTrial(lunaTrial), rendered = renderTrialPreview(previewTrial(lunaTrial));
  assert.equal(luna.controlled_sweeps.filter((group) => group.dimension === "attention").length, 2); assert.equal(luna.multi_variable_pair_count, 9); assert.match(rendered, /Maximum attempts per candidate: 2; maximum attempts across all candidates: 12/); assert.match(rendered, /Unsupported causal claims/);
  const many = analyzeTopology(Array.from({ length: 27 }, (_, index) => candidate(`many-${index}`, `attention-${index}`, { agent: `agent-${index}` }))); assert.equal(many.multi_variable_pairs_truncated, true); assert.equal(many.multi_variable_pairs.length, 24);
});

test("calibrate distinguishes accepted and execution-failure inconclusives, verifies reports, and preserves artifacts", async () => {
  const trial = await loadTrial(resolve(__dirname, "..", "..", "examples", "bounded-fix", "trial.yml")), order: string[] = [], progress: string[] = [];
  const verified: any = { status: "VERIFIED", run_directory: "synthetic-run", sample_metadata: "none", checks: [] };
  const stages: any = {
    runTrial: async () => { order.push("run"); return { directory: "synthetic-run" }; },
    adjudicateRun: async (_directory: string, _judge: unknown, config: { reasoning_effort: string }) => { order.push(`judge:${config.reasoning_effort}`); return { outcome: "TIE", recommended_candidate_id: null, tied_candidate_ids: ["a", "b"], adjudication_execution: { status: "completed", failure_classification: null, accepted_verdict: true } }; },
    generateReport: async () => { order.push("report"); return { directory: "synthetic-run", report: "report.html", recommendation: "recommendation.yml" }; }, verifyReport: async () => { order.push("verify"); return verified; }
  };
  const summary = await calibrate(trial, { stages, progress: (message) => progress.push(message) });
  assert.deepEqual(order, ["run", "judge:low", "report", "verify"]); assert.equal(summary.outcome, "TIE"); assert.equal(summary.workflow_status, "completed"); assert.equal(summary.verification_ready, true); assert.equal(progress.length, 4);
  order.length = 0; await calibrate(trial, { stages, reasoning: "high" }); assert.deepEqual(order, ["run", "judge:high", "report", "verify"]);
  for (const failure of ["launch", "timeout", "authentication", "invalid_response"] as const) { const failed: any = { ...stages, adjudicateRun: async () => ({ outcome: "INCONCLUSIVE", recommended_candidate_id: null, tied_candidate_ids: [], adjudication_execution: { status: "inconclusive", failure_classification: failure, accepted_verdict: false } }) }; const result = await calibrate(trial, { stages: failed }); assert.equal(result.workflow_status, "judge_execution_failed"); assert.equal(result.adjudication_failure_classification, failure); }
  const accepted: any = { ...stages, adjudicateRun: async () => ({ outcome: "INCONCLUSIVE", recommended_candidate_id: null, tied_candidate_ids: [], adjudication_execution: { status: "completed", failure_classification: null, accepted_verdict: true } }) }; assert.equal((await calibrate(trial, { stages: accepted })).workflow_status, "completed");
  const failing: any = { ...stages, adjudicateRun: async () => { order.push("failure"); throw new Error("synthetic judge failure"); } }; order.length = 0;
  await assert.rejects(() => calibrate(trial, { stages: failing }), /synthetic judge failure/); assert.deepEqual(order, ["run", "failure"]);
  const placeholder = validateTrial(parse(trialTemplate("attention-sweep"))), blocked: string[] = [];
  await assert.rejects(() => calibrate(placeholder, { stages: { ...stages, runTrial: async () => { blocked.push("run"); return { directory: "unexpected" }; } } }), /unresolved placeholders.*arena preview/i); assert.deepEqual(blocked, []);
  const verificationFailure: any = { ...stages, verifyReport: async () => ({ ...verified, status: "FAILED" }) };
  const failedVerification = await calibrate(trial, { stages: verificationFailure }); assert.equal(failedVerification.workflow_status, "verification_failed"); assert.equal(failedVerification.verification_ready, false);
  const temporary = await mkdtemp(join(tmpdir(), "arena-calibrate-artifacts-")), copy = join(temporary, "demo-run");
  try { await cp(demo, copy, { recursive: true }); const preserved: any = { ...stages, runTrial: async () => ({ directory: copy }), adjudicateRun: async () => ({ outcome: "INCONCLUSIVE", recommended_candidate_id: null, tied_candidate_ids: [], adjudication_execution: { status: "inconclusive", failure_classification: "launch", accepted_verdict: false } }), generateReport, verifyReport }; const result = await calibrate(trial, { stages: preserved }); assert.equal(result.workflow_status, "judge_execution_failed"); await access(join(copy, "evaluation.json")); await access(join(copy, "report.html")); } finally { await clean(temporary); }
});

test("lenses, coverage, placement, verification, and Pages staging remain presentation-only", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-phase45-")), copy = join(temporary, "demo-run"), pages = join(temporary, "pages");
  try {
    await cp(demo, copy, { recursive: true }); await generateReport(copy);
    const before = hash(await readFile(join(copy, "manifest.json"), "utf8")), model = buildReportModel(await loadCompletedRun(copy));
    assert.ok(model.decisionLenses.some((lens) => lens.id === "lowest_provider_reported_cost" && lens.status === "not_comparable"));
    assert.ok(model.decisionLenses.some((lens) => lens.id === "lowest_token_usage" && lens.status === "not_comparable"));
    assert.ok(model.candidates.every((item) => item.placement.why.length > 0));
    assert.ok(model.candidates.some((item) => Object.values(item.coverage.metrics).some((metric) => metric.status === "established_zero")));
    assert.ok(model.candidates.some((item) => Object.values(item.coverage.metrics).some((metric) => metric.status === "unavailable")));
    assert.equal((await verifyReport(copy)).status, "VERIFIED"); assert.equal(hash(await readFile(join(copy, "manifest.json"), "utf8")), before);
    const staged = await stagePagesSample(copy, pages); assert.ok(staged.files.includes("index.html")); assert.match(await readFile(staged.index, "utf8"), /Arena static product report/);
    await writeFile(join(copy, "report.html"), "stale", "utf8"); const stale = await verifyReport(copy); assert.equal(stale.status, "FAILED"); assert.equal(stale.checks.find((check) => check.id === "report_html")?.status, "failed");
    await generateReport(copy); await writeFile(join(copy, "recommendation.yml"), "stale", "utf8"); assert.equal((await verifyReport(copy)).status, "FAILED");
    await generateReport(copy); await writeFile(join(copy, "manifest.json"), "{}", "utf8"); assert.equal((await verifyReport(copy)).status, "FAILED");
  } finally { await clean(temporary); }
});

test("recommendation YAML uses the versioned snake_case DTO without aliases", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-recommendation-")), copy = join(temporary, "demo-run");
  try {
    await cp(demo, copy, { recursive: true }); const model = buildReportModel(await loadCompletedRun(copy)), yaml = renderRecommendationYaml(model), parsed: any = parse(yaml);
    const keys = (value: unknown): string[] => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(keys) : Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)]);
    assert.equal(parsed.schema_version, "1.1"); assert.doesNotMatch(yaml, /candidateIds|failureClassification/); assert.ok(keys(parsed).every((key) => !/[A-Z]/.test(key))); assert.doesNotMatch(yaml, /(^|\s)[&*][A-Za-z][\w-]*/m); assert.deepEqual(parsed.decision_lenses.map((lens: any) => lens.candidate_ids), model.decisionLenses.map((lens) => lens.candidateIds)); assert.equal(parsed.judge_execution.failure_classification, model.judgeExecution.failureClassification); assert.deepEqual(renderRecommendationYaml(model), yaml);
  } finally { await clean(temporary); }
});

test("Pages staging rejects unsafe relationships and preserves only safe relative evidence", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-pages-")), copy = join(temporary, "demo-run");
  try {
    await cp(demo, copy, { recursive: true }); await generateReport(copy);
    await writeFile(join(copy, "README.md"), "C:\\Users\\unsafe", "utf8");
    await assert.rejects(() => stagePagesSample(copy, join(temporary, "pages")), /secret or absolute path/);
    await assert.rejects(() => access(join(temporary, "pages")));
    await writeFile(join(copy, "README.md"), await readFile(join(demo, "README.md"), "utf8")); await generateReport(copy); await assert.rejects(() => stagePagesSample(copy, copy)); await assert.rejects(() => stagePagesSample(copy, temporary)); await assert.rejects(() => stagePagesSample(copy, join(copy, "pages")));
    const existing = join(temporary, "existing-pages"); await mkdir(existing); await writeFile(join(existing, "keep.txt"), "keep"); await assert.rejects(() => stagePagesSample(copy, existing), /must not already exist/); assert.equal(await readFile(join(existing, "keep.txt"), "utf8"), "keep");
    const sibling = join(temporary, "valid-pages"); const staged = await stagePagesSample(copy, sibling); assert.equal((await lstat(staged.directory)).isDirectory(), true);
    const target = join(temporary, "symlink-target"), link = join(temporary, "pages-link"), parentLink = join(temporary, "pages-parent-link"); await mkdir(target); try { await symlink(target, link); await symlink(target, parentLink); } catch (error: any) { if (error.code === "EPERM") { context.diagnostic("symlink creation unavailable on this Windows host"); return; } throw error; } await assert.rejects(() => stagePagesSample(copy, link), /must not already exist/); await assert.rejects(() => stagePagesSample(copy, join(parentLink, "nested")), /unsafe symlink relationship/); assert.equal((await lstat(link)).isSymbolicLink(), true);
  } finally { await clean(temporary); }
});

test("calibrate CLI returns nonzero only for nonfinalized workflow summaries", async () => {
  const trial = await loadTrial(resolve(__dirname, "..", "..", "examples", "bounded-fix", "trial.yml"));
  const summary = (workflow_status: "completed" | "judge_execution_failed", outcome = "INCONCLUSIVE") => ({ run_directory: "synthetic", workflow_status, outcome, recommended_candidate: null, tied_candidates: [], adjudication_execution_status: "inconclusive", adjudication_failure_classification: workflow_status === "completed" ? null : "timeout", report_path: "report.html", recommendation_path: "recommendation.yml", verification: { status: "VERIFIED", run_directory: "synthetic", sample_metadata: "none", checks: [] } as any, verification_ready: true });
  for (const outcome of ["RECOMMENDATION", "TIE", "NO_WINNER", "INCONCLUSIVE"]) assert.equal(await main(["calibrate", "trial.yml"], { loadTrial: async () => trial, calibrate: async () => summary("completed", outcome) as any }), 0);
  assert.equal(await main(["calibrate", "trial.yml"], { loadTrial: async () => trial, calibrate: async () => summary("judge_execution_failed") as any }), 1);
});
