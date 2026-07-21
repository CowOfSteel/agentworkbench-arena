import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";
import { candidateDisplayName, formatCompactNumber, formatCurrency, formatDuration, formatRetryCount, metricLabel, reportedTokens } from "../src/report-presentation";
import { renderRecommendationYaml, renderReportHtml, ReportCandidate, ReportMetric, ReportModel } from "../src/report";
import { buildDiagnosticTaskContract } from "../src/runner";
import { trialTemplate } from "../src/templates";
import { validateTrial } from "../src/trial";

const available = (value: unknown, source = "test"): ReportMetric => ({ value, availability: "available", source });
const unavailable = (source = "test"): ReportMetric => ({ value: null, availability: "unavailable", source });

function candidate(index: number, excluded = false): ReportCandidate {
  const id = `candidate-${index + 1}`;
  const metrics = {
    wall_clock_ms: available(index === 0 ? 2_000 : index === 1 ? 1_000 : 3_000 + index),
    validation_wall_clock_ms: available(500), total_pipeline_ms: available(4_000),
    input_tokens: available(1_000 + index * 100, "compatible"), cached_input_tokens: available(500, "compatible"), output_tokens: available(200, "compatible"),
    provider_reported_cost: available(.0038 + index / 100, "compatible"), provider_reported_currency: available("USD", "compatible"), estimated_cost: unavailable(), subscription_consumption: unavailable(),
    tool_call_count: available(10 + index), retry_count: available(index), human_intervention_count: available(0), lines_added: available(20 + index), lines_deleted: available(2)
  };
  const coverageMetrics = Object.fromEntries(Object.entries(metrics).map(([name, metric]) => [name, { status: metric.availability === "unavailable" ? "unavailable" as const : metric.value === 0 ? "established_zero" as const : "available_nonzero" as const, source: metric.source }]));
  return {
    id, label: String.fromCharCode(65 + index), eligibility: excluded ? "excluded" : "eligible", hardGateStatus: excluded ? "failed" : "passed", semanticRank: excluded ? null : index + 1, semanticTier: excluded ? null : index === 0 ? "strong" : "adequate",
    configuration: { adapter: "codex-exec", harness: "codex", provider: "openai", providerRoute: "codex-authenticated", model: `model-${index + 1}`, attention: null, displayName: `Configuration ${index + 1}`, displayVariant: index === 0 ? "High" : null, nativeReasoningEffort: "high", nativeVariant: null, effectiveProviderReasoningEffort: "high", reasoningEvidenceSource: "declared_provider_configuration", agent: null, profile: null, permissionPolicy: "workspace-write", declaredToolsPlugins: [], configurationHash: `hash-${index + 1}` },
    gates: [{ id: "required_validation_passed", status: excluded ? "failed" : "passed", reason: excluded ? "validation failed" : "validation passed" }], exclusions: excluded ? [{ id: "required_validation_passed", status: "failed", reason: "validation failed" }] : [], rationale: excluded ? null : `Rationale ${index + 1}`, strengths: excluded ? [] : ["Validated implementation"], risks: ["Recorded risk"], validation: [{ args: ["npm", "test"], status: excluded ? "failed" : "passed", wallClockMs: 500, exitCode: excluded ? 1 : 0, timeout: false, failureClassification: excluded ? "command" : null }], criteria: null, completionStatus: "completed", metrics, coverage: { available: Object.values(coverageMetrics).filter((item) => item.status !== "unavailable").length, unavailable: Object.values(coverageMetrics).filter((item) => item.status === "unavailable").length, metrics: coverageMetrics }, placement: { why: [excluded ? "Excluded by deterministic hard gates." : "Eligible in controller order."], why_not: excluded ? ["required_validation_passed: validation failed"] : ["Recorded risk"] }, evidence: [`candidates/${id}/telemetry.json`]
  };
}

function reportModel(count = 2, outcome: ReportModel["outcome"] = "RECOMMENDATION", excluded = 0): ReportModel {
  const candidates = Array.from({ length: count }, (_, index) => candidate(index, index >= count - excluded));
  const recommended = outcome === "RECOMMENDATION" ? candidates[0].id : null, tied = outcome === "TIE" ? candidates.slice(0, 2).map((item) => item.id) : [];
  const values = Object.fromEntries(candidates.filter((item) => item.eligibility === "eligible").map((item) => [item.id, item.metrics.wall_clock_ms.value]));
  return {
    schemaVersion: "1.0", runId: "run", trialId: "trial", evaluationSchemaVersion: "3.0", comparisonMode: "practical-configuration-comparison", objective: "Bounded task", validationCommands: [["npm", "test"]], outcome, recommendedCandidate: recommended, tiedCandidates: tied, confidence: outcome === "NO_WINNER" ? null : "high", summary: "Accepted semantic summary", limitations: [], runPipelineMs: 5_000, candidates, rootEvidence: ["evaluation.json"], noncausalStatement: "Arena compares complete configurations; this does not establish causal effects.", judgeExecution: { status: outcome === "NO_WINNER" ? "not_invoked_no_eligible_candidates" : "completed", failureClassification: null }, sourceExecutionLimitations: [], sampleMetadata: null,
    topology: { candidate_count: count, distinct_configuration_count: count, held_constant_dimensions: [], varied_dimensions: [], controlled_sweeps: [], duplicate_configuration_groups: [], multi_variable_pair_count: 0, multi_variable_pairs: [], multi_variable_pairs_truncated: false, uncomparable_pair_count: 0, supported_structural_claims: [], unsupported_causal_claims: ["No causal claim."] },
    decisionLenses: [
      { id: "controller_recommendation", label: "Controller recommendation", status: outcome === "RECOMMENDATION" ? "winner" : outcome === "TIE" ? "tie" : "not_applicable", candidateIds: recommended ? [recommended] : tied, reason: "Controller-owned evaluation.json outcome." },
      { id: "fastest_candidate_execution", label: "Fastest candidate execution", status: "winner", candidateIds: [candidates[1]?.id ?? candidates[0].id], values, reason: "Uses Candidate execution." },
      { id: "smallest_total_code_change", label: "Smallest total code change", status: "winner", candidateIds: [candidates[0].id], values: { [candidates[0].id]: 22 }, reason: "Uses lines changed." },
      { id: "fewest_interventions", label: "Fewest interventions", status: "tie", candidateIds: candidates.filter((item) => item.eligibility === "eligible").map((item) => item.id), values: Object.fromEntries(candidates.map((item) => [item.id, 0])), reason: "Uses interventions." },
      { id: "fewest_retries", label: "Fewest retries", status: "winner", candidateIds: [candidates[0].id], values: { [candidates[0].id]: 0 }, reason: "Uses retries." },
      { id: "lowest_provider_reported_cost", label: "Lowest provider-reported cost", status: "not_comparable", candidateIds: [], reason: "Eligible candidates lack compatible complete provider cost and currency evidence." },
      { id: "lowest_token_usage", label: "Lowest reported token usage", status: "winner", candidateIds: [candidates[0].id], values: { [candidates[0].id]: 1_200 }, reason: "Uses compatible reported token semantics." },
      { id: "telemetry_coverage", label: "Telemetry coverage", status: "not_applicable", candidateIds: [], values: Object.fromEntries(candidates.map((item) => [item.id, item.coverage])), reason: "Informational coverage only; it is not a coding-result quality score." }
    ],
    telemetryMetricNames: Object.keys(candidates[0].metrics)
  };
}

test("presentation formatters preserve units, precision, fallbacks, and exact availability", () => {
  assert.equal(formatDuration(842), "842 ms"); assert.equal(formatDuration(12_400), "12.4 s"); assert.equal(formatDuration(134_000), "2m 14s"); assert.equal(formatDuration(3_780_000), "1h 03m");
  assert.equal(formatCompactNumber(980), "980"); assert.equal(formatCompactNumber(18_400), "18.4k"); assert.equal(formatCompactNumber(1_250_000), "1.25M"); assert.equal(formatCompactNumber(0), "0");
  assert.equal(formatCurrency(.0038, "USD"), "$0.0038"); assert.equal(formatCurrency(1.04, "EUR"), "€1.04"); assert.equal(formatCurrency(1, null), "Not reported");
  assert.equal(formatRetryCount(unavailable()), "Retries: Not reported"); assert.equal(formatRetryCount(available(0)), "0 retries"); assert.equal(formatRetryCount(available(1)), "1 retry"); assert.equal(formatRetryCount(available(2)), "2 retries");
  assert.equal(metricLabel("wall_clock_ms"), "Candidate execution"); assert.equal(metricLabel("provider_reported_cost"), "Provider-reported cost");
  const item = candidate(0); assert.equal(reportedTokens(item), 1_200); item.metrics.output_tokens = unavailable(); assert.equal(reportedTokens(item), null);
  item.configuration.displayName = "Terra via Codex"; item.configuration.displayVariant = "High"; assert.equal(candidateDisplayName(item), "Terra via Codex — High"); item.configuration.displayName = "Terra High via Codex"; assert.equal(candidateDisplayName(item), "Terra High via Codex"); item.configuration.displayName = null; assert.equal(candidateDisplayName(item), "model-1 — high"); item.configuration.nativeReasoningEffort = null; item.configuration.nativeVariant = null; item.configuration.attention = "low"; assert.equal(candidateDisplayName(item), "model-1 — low"); item.configuration.model = null; assert.equal(candidateDisplayName(item), item.id);
});

test("at-a-glance and candidate cards preserve order, states, values, and technical reveal", () => {
  const model = reportModel(6, "RECOMMENDATION", 1); model.candidates[0].configuration.displayName = "Terra <High>";
  const html = renderReportHtml(model), glance = html.slice(html.indexOf('<section id="at-a-glance">'), html.indexOf("<section><h2>Task and comparison"));
  for (const candidate of model.candidates) assert.equal((glance.match(new RegExp(candidateDisplayName(candidate).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/</g, "&lt;").replace(/>/g, "&gt;"), "g")) ?? []).length, 1);
  assert.ok(model.candidates.slice(0, -1).every((item, index) => glance.indexOf(candidateDisplayName(item).replace(/</g, "&lt;").replace(/>/g, "&gt;")) < glance.indexOf(candidateDisplayName(model.candidates[index + 1]).replace(/</g, "&lt;").replace(/>/g, "&gt;"))));
  const firstRowStart = glance.indexOf('<tr class="recommended">'), firstRow = glance.slice(firstRowStart, glance.indexOf("</tr>", firstRowStart) + 5);
  assert.match(glance, /Recommended/); assert.match(glance, /Eligible/); assert.match(glance, /Excluded/); assert.match(firstRow, /1\.2k/); assert.doesNotMatch(firstRow, /1\.7k/); assert.match(firstRow, /\$0\.0038/);
  assert.match(glance, /Individual token and cost values may use different harness accounting semantics/);
  for (const state of ["recommended", "tied", "eligible", "inconclusive", "excluded"]) { assert.match(html, new RegExp(`\\.summary-table tr\\.${state}`)); assert.match(html, new RegExp(`\\.candidate-card\\.${state}`)); }
  assert.match(html, /<summary>Technical configuration<\/summary>/); assert.match(html, /Deterministic exclusion/); assert.match(html, /Candidate ID/); assert.match(html, /candidates\/candidate-1\/telemetry\.json/); assert.doesNotMatch(html, /<h3>Terra <High>/); assert.match(html, /Terra &lt;High&gt;/);
  const tie = renderReportHtml(reportModel(2, "TIE")); assert.match(tie, /<strong>Tied<\/strong>/); assert.match(tie, /<tr class="tied">/); const inconclusive = renderReportHtml(reportModel(2, "INCONCLUSIVE")); assert.match(inconclusive, /<strong>Inconclusive<\/strong>/); assert.match(inconclusive, /<tr class="inconclusive">/);
  assert.equal((renderReportHtml(reportModel(9)).match(/<tr class="(?:recommended|eligible|excluded|tied|inconclusive)">/g) ?? []).length, 9);
});

test("candidate summaries keep unknown retries distinct from retry counts", () => {
  const model = reportModel(); model.candidates[0].metrics.retry_count = unavailable();
  const html = renderReportHtml(model);
  assert.match(html, /Retries: Not reported/); assert.doesNotMatch(html, /Not reported retries/);
});

test("decision lenses and telemetry render authoritative values without request-level overclaim", () => {
  const model = reportModel(); const html = renderReportHtml(model);
  assert.equal(renderReportHtml(model), html);
  assert.match(html, /1 s slower than the fastest eligible candidate/); assert.match(html, /1\.2k reported tokens/); assert.match(html, /Not comparable/); assert.match(html, /Eligible candidates lack compatible complete provider cost/); assert.match(html, /0<\/p>/);
  assert.match(html, /Candidate execution/); assert.match(html, /Independent validation/); assert.match(html, /Arena pipeline/); assert.match(html, /per-candidate execution telemetry/); assert.match(html, /It is not provider API request latency/); assert.doesNotMatch(html, /Average API request latency|Tokens per API request|Provider request count/);
  assert.doesNotMatch(html, /<th scope="row">wall_clock_ms<\/th>/); assert.match(html, /Established zero|Not reported/);
  const yaml = renderRecommendationYaml(model), parsed: any = parseYaml(yaml); assert.equal(parsed.schema_version, "1.1"); assert.equal(parsed.decision_lenses[1].values["candidate-1"], 2_000); assert.doesNotMatch(yaml, /2 s|1\.2k|\$0\.0038/); assert.equal(renderRecommendationYaml(model), yaml);
});

test("judge-first documentation and readable templates preserve safe workflows", async () => {
  const root = resolve(__dirname, "..", ".."), readme = await readFile(resolve(root, "README.md"), "utf8"), quickstart = await readFile(resolve(root, "docs", "QUICKSTART-LIVE.md"), "utf8");
  assert.ok(readme.indexOf("Try it without credentials") < readme.indexOf("Phase 1")); assert.match(readme, /docs\/QUICKSTART-LIVE\.md/); assert.match(readme, /enablement step and is not claimed live/);
  assert.match(quickstart, /codex login/); assert.match(quickstart, /opencode models openai/); assert.match(quickstart, /git config --global core\.longpaths true/); assert.match(quickstart, /subst R:/); assert.match(quickstart, /primarily \*\*per candidate run\*\*/); assert.match(quickstart, /not provider API request latency/); assert.doesNotMatch(quickstart, /access[_ -]?token\s*[:=]|api[_ -]?key\s*[:=]|C:\\Users\\/i);
  for (const kind of ["attention-sweep", "harness-comparison", "practical-comparison"] as const) {
    const template = trialTemplate(kind), trial = validateTrial(parseYaml(template));
    assert.match(template, /candidates:\n  - id:/); assert.doesNotMatch(template, /- \{ id:/);
    assert.deepEqual(trial.diagnosticProbe, { path: "src/arena-diagnostic-probe.txt", content: "agentworkbench-arena-diagnostic\n" });
    assert.match(buildDiagnosticTaskContract(trial.diagnosticProbe!), /Create only src\/arena-diagnostic-probe\.txt/);
  }
  assert.match(quickstart, /diagnostic_probe:\r?\n  path: src\/arena-diagnostic-probe\.txt\r?\n  content: "agentworkbench-arena-diagnostic\\n"/);
});
