import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";
import { buildReportModel, generateReport, loadCompletedRun, renderRecommendationYaml, renderReportHtml } from "../src/report";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const available = (value: unknown) => ({ value, availability: "available", source: "test" });
const unavailable = () => ({ value: null, availability: "unavailable", source: "test" });
const labelAt = (index: number): string => { let value = index + 1, result = ""; while (value) { value--; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); } return result; };
const writeJson = (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2));
const clean = (path: string) => rm(path, { recursive: true, force: true });
const completeCriteria = () => ({ acceptance_coverage: "strong", maintainability: "adequate", architecture_fit: "adequate", regression_risk: "adequate", unnecessary_complexity: "adequate", evidence_quality: "strong" });

async function reportRun(count = 2, outcome: "RECOMMENDATION" | "TIE" | "NO_WINNER" | "INCONCLUSIVE" = "RECOMMENDATION", executionFailure = false, excludedCount = outcome === "NO_WINNER" ? count : 0) {
  const directory = await mkdtemp(join(tmpdir(), "arena-report-")), candidatesRoot = join(directory, "candidates"); await mkdir(candidatesRoot);
  const objective = "Fix <script>alert('x')</script>: preserve YAML-safe values\nand validation.", taskHash = sha(objective);
  const ids = Array.from({ length: count }, (_, index) => `candidate-${index + 1}`), excluded = new Set(ids.slice(count - excludedCount));
  const ordered = [...ids.filter((id) => !excluded.has(id)), ...ids.filter((id) => excluded.has(id))], labels = Object.fromEntries(ordered.map((id, index) => [labelAt(index), id]));
  const configHash = (id: string) => sha(`configuration:${id}`);
  const snapshot = { schema_version: "2.0", trial_id: "report-trial", task_contract_hash: taskHash, allowed_paths: ["src"], forbidden_paths: ["secrets"], validation_commands: [["npm", "test"]], timeout_ms: 1000, validation_timeout_ms: 1000, dependency_policy: "no_changes", retry_limit: 1, manual_intervention: "forbidden", candidates: ids.map((id) => ({ id, configuration_hash: configHash(id) })) };
  const manifestCandidates = ids.map((id) => ({ candidate_id: id, configuration_hash: configHash(id), artifact_directory: `candidates/${id}`, completion_status: "completed", hard_gate_status: excluded.has(id) ? "failed" : "passed", evidence_completeness: `candidates/${id}/telemetry.json`, deterministic_packet_ready: true }));
  const evaluationCandidates = ordered.map((id, index) => { const isExcluded = excluded.has(id), hasSemantic = !isExcluded && !executionFailure && outcome !== "NO_WINNER", label = labelAt(index), semanticRank = outcome === "TIE" && index < 2 ? 1 : outcome === "TIE" ? index : index + 1, exclusions = isExcluded ? [{ id: "required_validation_passed", status: "failed", reason: "validation failed" }, { id: "dependency_policy", status: "unavailable", reason: "comparison unavailable" }] : []; return { candidate_id: id, label, eligibility: isExcluded ? "excluded" : "eligible", hard_gate_status: isExcluded ? "failed" : "passed", semantic_rank: hasSemantic ? semanticRank : null, semantic_tier: hasSemantic ? "adequate" : null, exclusion_gates: exclusions }; });
  const eligibleLabels = evaluationCandidates.filter((item) => item.eligibility === "eligible").map((item) => item.label), tied = outcome === "TIE" ? eligibleLabels.slice(0, 2) : outcome === "RECOMMENDATION" ? eligibleLabels.slice(0, 1) : [];
  const verdict = outcome === "NO_WINNER" || executionFailure ? null : { schema_version: "3.0", verdict: outcome, recommended_labels: tied, confidence: "low", ranking: eligibleLabels.map((label, index) => ({ label, rank: outcome === "TIE" && index < 2 ? 1 : outcome === "TIE" ? index : index + 1, tier: "adequate", rationale: `rationale: ${label}` })), criteria_by_candidate: Object.fromEntries(Object.keys(labels).map((label) => [label, completeCriteria()])), strengths_by_candidate: Object.fromEntries(Object.keys(labels).map((label) => [label, [`strength: ${label}`]])), risks_by_candidate: Object.fromEntries(Object.keys(labels).map((label) => [label, [`risk: ${label}`]])), limitations: ["synthetic evidence"], summary: "semantic summary" };
  const evaluation = { schema_version: "3.0", outcome, recommended_candidate_id: outcome === "RECOMMENDATION" ? labels[tied[0]] : null, tied_candidate_ids: outcome === "TIE" ? tied.map((label) => labels[label]) : [], candidates: evaluationCandidates, adjudication: verdict ?? { status: outcome === "NO_WINNER" ? "not_invoked_no_eligible_candidates" : "inconclusive", error: executionFailure ? "judge execution failed" : null } };
  await Promise.all([
    writeJson(join(directory, "manifest.json"), { schema_version: "2.0", run_id: "report-run", trial_id: "report-trial", comparison_mode: "practical-configuration-comparison", run_status: "completed", total_pipeline_ms: 300, task_contract_hash: taskHash, task_contract_artifact: "task-contract.json", normalized_trial_snapshot_hash: sha(JSON.stringify(snapshot)), candidate_count: count, candidates: manifestCandidates, manifest_finalization_status: "complete", phase_3_readiness: "ready_for_audit" }),
    writeJson(join(directory, "task-contract.json"), { schema_version: "1.0", task_contract_hash: taskHash, objective, instructions: [], acceptance_criteria: [], allowed_paths: ["src"], forbidden_paths: ["secrets"], validation_commands: [["npm", "test"]] }),
    writeJson(join(directory, "trial-snapshot.json"), snapshot), writeJson(join(directory, "identity-map.json"), { schema_version: "3.0", labels }), writeJson(join(directory, "evaluation.json"), evaluation),
    writeJson(join(directory, "adjudication.json"), { schema_version: "3.0", labels: Object.keys(labels), eligible_labels: eligibleLabels, verdict }),
    writeJson(join(directory, "judge-result.json"), { status: outcome === "NO_WINNER" ? "not_invoked_no_eligible_candidates" : executionFailure ? "inconclusive" : "completed", original: executionFailure ? null : {}, repair: null, error: executionFailure ? "judge execution failed" : null })
  ]);
  for (const id of ids) {
    const candidateDirectory = join(candidatesRoot, id); await mkdir(candidateDirectory);
    const failed = excluded.has(id), gates = [{ id: "required_validation_passed", status: failed ? "failed" : "passed", reason: failed ? "validation failed" : "validation passed" }, { id: "dependency_policy", status: failed ? "unavailable" : "passed", reason: failed ? "comparison unavailable" : "dependency policy satisfied" }];
    const execution = { wall_clock_ms: available(100), validation_wall_clock_ms: available(20), total_pipeline_ms: available(140), tool_call_count: unavailable(), command_count: available(0), retry_count: available(0), human_intervention_count: available(0) };
    const usage: Record<string, { value: unknown; availability: string; source: string }> = Object.fromEntries(["input_tokens", "cached_input_tokens", "uncached_input_tokens", "output_tokens", "provider_reported_cost", "provider_reported_currency", "estimated_cost", "estimated_cost_currency", "subscription_consumption", "quota_percent_before", "quota_percent_after"].map((name) => [name, unavailable()])); usage.provider_reported_cost = available(1.25); usage.provider_reported_currency = available("USD"); usage.estimated_cost = available(2.5); usage.estimated_cost_currency = available("USD");
    const intervention = Object.fromEntries(["permission_denials", "user_questions", "manual_prompt_corrections", "manual_file_edits", "aborts", "transport_retries"].map((name) => [name, available(0)]));
    const output = { files_changed: available(1), lines_added: available(1), lines_deleted: available(0), validation_pass_count: available(failed ? 0 : 1), validation_fail_count: available(failed ? 1 : 0), hard_gate_status: available(failed ? "failed" : "passed") };
    await Promise.all([
      writeJson(join(candidateDirectory, "provenance.json"), { candidate_id: id, adapter: `adapter-${id}`, harness: "fake", provider: null, model: "fake-model", attention: "low", agent: null, profile: null }),
      writeJson(join(candidateDirectory, "telemetry.json"), { schema_version: "2.0", finalization_status: "complete", provenance: { candidate_id: id, task_contract_hash: taskHash, configuration_hash: configHash(id) }, execution, usage, intervention, output, hard_gates: gates }),
      writeJson(join(candidateDirectory, "validation.json"), { schema_version: "2.0", commands: [{ args: ["npm", "test"], wall_clock_ms: 20, exit_code: failed ? 1 : 0, timeout: false, failure_classification: failed ? "command" : null, status: failed ? "failed" : "passed", stdout: "", stderr: "" }] }),
      writeFile(join(candidateDirectory, "candidate.diff"), `diff --git a/src/${id}.ts b/src/${id}.ts\n+safe\n`)
    ]);
  }
  return directory;
}

async function sourceHashes(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(path: string, prefix = "") { for (const entry of await readdir(path, { withFileTypes: true })) { const relative = prefix ? `${prefix}/${entry.name}` : entry.name, absolute = join(path, entry.name); if (entry.isDirectory()) await visit(absolute, relative); else if (!["report.html", "recommendation.yml"].includes(entry.name)) result[relative] = sha(await readFile(absolute)); } }
  await visit(directory); return result;
}

async function allText(directory: string): Promise<string> {
  const values: string[] = [];
  async function visit(path: string) { for (const entry of await readdir(path, { withFileTypes: true })) { const absolute = join(path, entry.name); if (entry.isDirectory()) await visit(absolute); else values.push(await readFile(absolute, "utf8")); } }
  await visit(directory); return values.join("\n");
}

test("report and recommendation are deterministic, escaped, complete, and source-immutable", async () => {
  const directory = await reportRun(); try {
    const before = await sourceHashes(directory), run = await loadCompletedRun(directory), model = buildReportModel(run), html = renderReportHtml(model), yaml = renderRecommendationYaml(model), parsed = parseYaml(yaml);
    assert.equal(model.candidates.length, 2); assert.deepEqual(model.candidates[0].criteria, completeCriteria()); assert.match(html, /RECOMMENDATION/); assert.match(html, /Not reported by harness/); assert.match(html, />0</); assert.match(html, /wall_clock_ms/); assert.match(html, /validation_wall_clock_ms/); assert.match(html, /total_pipeline_ms/); assert.match(html, /provider_reported_currency/); assert.match(html, /permission_denials/); assert.match(html, /validation_pass_count/); assert.match(html, /acceptance_coverage/); assert.match(html, /Comparison topology/); assert.match(html, /Decision lenses/); assert.match(html, /Telemetry coverage/); assert.match(html, /Codex development provenance/); assert.doesNotMatch(html, /<script>alert/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script\b|<img\b/i);
    assert.equal(parsed.outcome, "RECOMMENDATION"); assert.equal(parsed.routing_applied, false); assert.equal(parsed.ranking.length, 2); assert.deepEqual(parsed.ranking[0].semantic_criteria, completeCriteria()); assert.equal("score" in parsed.ranking[0], false); assert.match(parsed.noncausal_statement, /complete configurations/i);
    await generateReport(directory); const first = [await readFile(join(directory, "report.html")), await readFile(join(directory, "recommendation.yml"))]; await generateReport(directory); const second = [await readFile(join(directory, "report.html")), await readFile(join(directory, "recommendation.yml"))]; assert.deepEqual(first, second); assert.deepEqual(await sourceHashes(directory), before);
  } finally { await clean(directory); }
});

test("all outcomes and generic candidate counts preserve controller order", async () => {
  for (const count of [2, 6, 7, 26, 27]) { const directory = await reportRun(count); try { const model = buildReportModel(await loadCompletedRun(directory)); assert.equal(model.candidates.length, count); assert.equal(model.candidates.at(-1)?.label, labelAt(count - 1)); } finally { await clean(directory); } }
  for (const [outcome, failure, excluded] of [["TIE", false, 0], ["NO_WINNER", false, 2], ["INCONCLUSIVE", false, 0], ["INCONCLUSIVE", true, 0]] as const) { const directory = await reportRun(2, outcome, failure, excluded); try { const model = buildReportModel(await loadCompletedRun(directory)); assert.equal(model.outcome, outcome); assert.ok(model.candidates.every((candidate) => candidate.placement.why.length > 0)); if (outcome === "NO_WINNER") assert.ok(model.candidates.every((candidate) => candidate.placement.why.some((item) => item.includes("NO_WINNER")))); } finally { await clean(directory); } }
  const excluded = await reportRun(3, "RECOMMENDATION", false, 1); try { const model = buildReportModel(await loadCompletedRun(excluded)); assert.deepEqual(model.candidates.map((item) => item.eligibility), ["eligible", "eligible", "excluded"]); assert.deepEqual(model.candidates.at(-1)?.exclusions.map((item) => item.status), ["failed", "unavailable"]); } finally { await clean(excluded); }
});

test("criteria are strict, source execution remains evidence, and wide tables scroll", async () => {
  const directory = await reportRun(6); try {
    const adjudication = JSON.parse(await readFile(join(directory, "adjudication.json"), "utf8"));
    const evaluation = JSON.parse(await readFile(join(directory, "evaluation.json"), "utf8"));
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    manifest.candidates[0].completion_status = "authentication"; adjudication.verdict.criteria_by_candidate.A.maintainability = "weak"; evaluation.adjudication = adjudication.verdict;
    await Promise.all([writeJson(join(directory, "manifest.json"), manifest), writeJson(join(directory, "adjudication.json"), adjudication), writeJson(join(directory, "evaluation.json"), evaluation)]);
    const model = buildReportModel(await loadCompletedRun(directory)), html = renderReportHtml(model), yaml = parseYaml(renderRecommendationYaml(model));
    assert.equal(model.outcome, "RECOMMENDATION"); assert.equal(model.candidates[0].completionStatus, "authentication"); assert.match(html, /Recorded source completion status for A: authentication/); assert.match(html, /class="table-scroll"/); assert.equal((html.match(/class="table-scroll"/g) ?? []).length, 4); assert.equal(yaml.ranking[0].semantic_criteria.maintainability, "weak");
  } finally { await clean(directory); }
  for (const mutate of [
    (verdict: any) => delete verdict.criteria_by_candidate.A.acceptance_coverage,
    (verdict: any) => { verdict.criteria_by_candidate.A.extra = "strong"; },
    (verdict: any) => { verdict.criteria_by_candidate.A.maintainability = "invalid"; }
  ]) { const invalid = await reportRun(); try { const adjudication = JSON.parse(await readFile(join(invalid, "adjudication.json"), "utf8")), evaluation = JSON.parse(await readFile(join(invalid, "evaluation.json"), "utf8")); mutate(adjudication.verdict); evaluation.adjudication = adjudication.verdict; await Promise.all([writeJson(join(invalid, "adjudication.json"), adjudication), writeJson(join(invalid, "evaluation.json"), evaluation)]); await assert.rejects(() => loadCompletedRun(invalid), /semantic criterion/); } finally { await clean(invalid); } }
});

test("completed-run loader rejects missing, mismatched, traversal, invalid outcome, and symlink evidence", async (context) => {
  for (const mutation of [
    async (directory: string) => rm(join(directory, "judge-result.json")),
    async (directory: string) => { const value = JSON.parse(await readFile(join(directory, "identity-map.json"), "utf8")); value.labels.A = "candidate-2"; await writeJson(join(directory, "identity-map.json"), value); },
    async (directory: string) => { const value = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")); value.candidates[0].artifact_directory = "../escape"; await writeJson(join(directory, "manifest.json"), value); },
    async (directory: string) => { const value = JSON.parse(await readFile(join(directory, "evaluation.json"), "utf8")); value.candidates[0].eligibility = "excluded"; await writeJson(join(directory, "evaluation.json"), value); }
  ]) { const directory = await reportRun(); try { await mutation(directory); await assert.rejects(() => loadCompletedRun(directory)); } finally { await clean(directory); } }
  const excluded = await reportRun(3, "RECOMMENDATION", false, 1); try { const value = JSON.parse(await readFile(join(excluded, "evaluation.json"), "utf8")); value.recommended_candidate_id = "candidate-3"; await writeJson(join(excluded, "evaluation.json"), value); await assert.rejects(() => loadCompletedRun(excluded), /recommendation/); } finally { await clean(excluded); }
  const directory = await reportRun(); try { const path = join(directory, "candidates", "candidate-1", "candidate.diff"), target = join(directory, "safe.diff"); await writeFile(target, "safe"); await rm(path); try { await symlink(target, path); } catch (error: any) { if (error.code === "EPERM") { context.diagnostic("symlink creation unavailable on this Windows host"); return; } throw error; } await assert.rejects(() => loadCompletedRun(directory), /unsafe/); } finally { await clean(directory); }
});

test("sanitized demo is offline, contains only allowlisted evidence, and invokes no adapter", async () => {
  const sample = resolve(__dirname, "..", "..", "examples", "demo-run"), temporary = await mkdtemp(join(tmpdir(), "arena-demo-copy-"));
  try {
    const copy = join(temporary, "demo-run"); await cp(sample, copy, { recursive: true });
    const allowedRoot = new Set(["README.md", "sample-metadata.json", "manifest.json", "task-contract.json", "trial-snapshot.json", "identity-map.json", "evaluation.json", "adjudication.json", "judge-result.json", "report.html", "recommendation.yml", "candidates"]);
    for (const entry of await readdir(copy)) assert.ok(allowedRoot.has(entry));
    const serialized = await allText(copy);
    assert.doesNotMatch(serialized, /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/]|file:\/\/|\/(?:Users|home)\/|session id|access[_ -]?token/i);
    for (const id of ["codex-luna-low", "opencode-luna-low"]) { const provenance = JSON.parse(await readFile(join(copy, "candidates", id, "provenance.json"), "utf8")); assert.equal(provenance.adapter_execution.executable, null); assert.deepEqual(provenance.adapter_execution.arguments, []); }
    const model = buildReportModel(await loadCompletedRun(copy)); assert.equal(model.sampleMetadata?.kind, "sanitized_derivative"); assert.match(renderReportHtml(model), /Historical source completion status for A: authentication/); assert.match(renderReportHtml(model), /Historical judge original failure classification: permission/); assert.match(renderReportHtml(model), /Sanitized derivative sample/); assert.equal(parseYaml(renderRecommendationYaml(model)).sample_metadata.kind, "sanitized_derivative");
    const result = await generateReport(copy); assert.equal(result.report, "report.html"); assert.equal((await lstat(join(copy, "report.html"))).isFile(), true);
    const cli = join(__dirname, "..", "src", "index.js"), marker = join(temporary, "adapter-called");
    const output = execFileSync(process.execPath, [cli, "report", copy], { encoding: "utf8", env: { ...process.env, CODEX_ACCESS_TOKEN: "", ARENA_CODEX_EXECUTABLE: marker } });
    assert.match(output, /report.html/); await assert.rejects(() => access(marker));
    const demo = execFileSync(process.execPath, [cli, "demo"], { cwd: resolve(__dirname, "..", ".."), encoding: "utf8", env: { ...process.env, CODEX_ACCESS_TOKEN: "", ARENA_CODEX_EXECUTABLE: marker } });
    assert.match(demo, /examples\/demo-run\/report.html/); await assert.rejects(() => access(marker));
  } finally { await clean(temporary); }
});

test("optional sample metadata is strict and absent from ordinary reports", async () => {
  const ordinary = await reportRun(); try { const model = buildReportModel(await loadCompletedRun(ordinary)); assert.equal(model.sampleMetadata, null); assert.doesNotMatch(renderReportHtml(model), /Sanitized derivative sample/); assert.equal("sample_metadata" in parseYaml(renderRecommendationYaml(model)), false); } finally { await clean(ordinary); }
  const invalid = await reportRun(); try { await writeJson(join(invalid, "sample-metadata.json"), { schema_version: "1.0", kind: "sanitized_derivative", evidence_completeness_scope: "source", omitted_artifacts: [], retained_results: "retained", extra: true }); await assert.rejects(() => loadCompletedRun(invalid), /sample metadata/); } finally { await clean(invalid); }
});
