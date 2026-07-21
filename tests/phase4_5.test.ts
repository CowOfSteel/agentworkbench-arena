import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { calibrate } from "../src/calibrate";
import { stagePagesSample } from "../src/pages";
import { previewTrial, renderTrialPreview } from "../src/preview";
import { buildReportModel, generateReport, loadCompletedRun, verifyReport } from "../src/report";
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
      assert.ok(trial.candidates.length >= 2); assert.match(text, /REPLACE_/); assert.doesNotMatch(text, /[A-Za-z]:[\\/]|file:\/\/|(?:access[_ -]?token|api[_ -]?key|password|secret)\s*[:=]/i);
      const output = join(directory, `${kind}.yml`), created = await writeTrialTemplate(kind, output);
      assert.equal(created.path, resolve(output)); await assert.rejects(() => writeTrialTemplate(kind, output), /EEXIST/);
    }
  } finally { await clean(directory); }
});

test("preview is offline, reports upper bounds, placeholders, topology, and the causal boundary", async () => {
  const trial = validateTrial(parse(trialTemplate("attention-sweep"))), preview = previewTrial(trial), text = renderTrialPreview(preview);
  assert.equal(preview.candidate_process_upper_bound_ms, trial.candidates.length * (1 + trial.maxLaunchTransportRetries) * trial.timeoutMs);
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
  const luna = topologyFromTrial(await loadTrial(resolve(__dirname, "..", "..", "examples", "bounded-fix", "trial.yml")));
  assert.equal(luna.controlled_sweeps.filter((group) => group.dimension === "attention").length, 2); assert.ok(luna.multi_variable_pair_count > 0);
});

test("calibrate runs injected stages once in order, defaults Low, supports High, and preserves prior output on failure", async () => {
  const trial = validateTrial(parse(trialTemplate("harness-comparison"))), order: string[] = [], progress: string[] = [];
  const stages: any = {
    runTrial: async () => { order.push("run"); return { directory: "synthetic-run" }; },
    adjudicateRun: async (_directory: string, _judge: unknown, config: { reasoning_effort: string }) => { order.push(`judge:${config.reasoning_effort}`); return { outcome: "TIE", recommended_candidate_id: null, tied_candidate_ids: ["a", "b"] }; },
    generateReport: async () => { order.push("report"); return { directory: "synthetic-run", report: "report.html", recommendation: "recommendation.yml" }; }
  };
  const summary = await calibrate(trial, { stages, progress: (message) => progress.push(message) });
  assert.deepEqual(order, ["run", "judge:low", "report"]); assert.equal(summary.outcome, "TIE"); assert.equal(progress.length, 3);
  order.length = 0; await calibrate(trial, { stages, reasoning: "high" }); assert.deepEqual(order, ["run", "judge:high", "report"]);
  const failing: any = { ...stages, adjudicateRun: async () => { order.push("failure"); throw new Error("synthetic judge failure"); } }; order.length = 0;
  await assert.rejects(() => calibrate(trial, { stages: failing }), /synthetic judge failure/); assert.deepEqual(order, ["run", "failure"]);
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

test("Pages staging rejects unsafe source text and preserves only safe relative evidence", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "arena-pages-")), copy = join(temporary, "demo-run");
  try {
    await cp(demo, copy, { recursive: true }); await generateReport(copy);
    await writeFile(join(copy, "README.md"), "C:\\Users\\unsafe", "utf8");
    await assert.rejects(() => stagePagesSample(copy, join(temporary, "pages")), /secret or absolute path/);
  } finally { await clean(temporary); }
});
