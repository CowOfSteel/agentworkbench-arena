import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { assertSafePublicArtifactText } from "./pages";
import { generateReport, loadCompletedRun, verifyReport } from "./report";

const rootNames = ["manifest.json", "task-contract.json", "trial-snapshot.json", "identity-map.json", "evaluation.json", "adjudication.json"] as const;
const candidateNames = ["provenance.json", "telemetry.json", "validation.json", "candidate.diff"] as const;
const contained = (root: string, value: string): boolean => { const result = relative(root, value); return result !== "" && !result.startsWith("..") && !isAbsolute(result); };
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const nullableText = (value: unknown): string | null => value === undefined || value === null ? null : typeof value === "string" ? value : (() => { throw new Error("sample source contains malformed public evidence"); })();
const text = (value: unknown): string => { const output = nullableText(value); if (output === null) throw new Error("sample source contains malformed public evidence"); return output; };
const strings = (value: unknown): string[] => { if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("sample source contains malformed public evidence"); return [...value]; };
const optionalNumber = (value: unknown): number | null => value === null || value === undefined ? null : typeof value === "number" && Number.isFinite(value) ? value : (() => { throw new Error("sample source contains malformed public evidence"); })();
const optionalBoolean = (value: unknown): boolean | null => value === null || value === undefined ? null : typeof value === "boolean" ? value : (() => { throw new Error("sample source contains malformed public evidence"); })();

function safePermission(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  const source = record(value), permission = record(source.permission);
  const output: Record<string, unknown> = {};
  for (const key of ["approval_policy", "sandbox_mode", "share"] as const) if (source[key] !== undefined) output[key] = text(source[key]);
  const rules: Record<string, string> = {};
  for (const key of ["*", "external_directory", "question", "webfetch", "websearch"] as const) if (permission[key] !== undefined) rules[key] = text(permission[key]);
  if (Object.keys(rules).length) output.permission = rules;
  return output;
}

function safeProvenance(value: Record<string, any>): Record<string, unknown> {
  if (value.candidate_tool_provenance !== null && value.candidate_tool_provenance !== undefined && (typeof value.candidate_tool_provenance !== "object" || Array.isArray(value.candidate_tool_provenance))) throw new Error("sample source contains malformed public evidence");
  const reasoning = record(value.reasoning), tools = value.candidate_tool_provenance === null || value.candidate_tool_provenance === undefined ? {} : record(value.candidate_tool_provenance);
  const isolation = record(value.adapter_execution).configuration_isolation;
  return {
    trial_id: text(value.trial_id), candidate_id: text(value.candidate_id), task_contract_hash: text(value.task_contract_hash), baseline_commit: text(value.baseline_commit),
    adapter: text(value.adapter), harness: text(value.harness), provider: nullableText(value.provider), model: text(value.model), attention: nullableText(value.attention), agent: nullableText(value.agent), profile: nullableText(value.profile),
    permission_policy: safePermission(value.permission_policy), display_name: nullableText(value.display_name), display_variant: nullableText(value.display_variant), native_reasoning_effort: nullableText(value.native_reasoning_effort), provider_route: nullableText(value.provider_route), native_variant: nullableText(value.native_variant),
    reasoning: { requested_harness_variant: nullableText(reasoning.requested_harness_variant), native_reasoning_effort: nullableText(reasoning.native_reasoning_effort), effective_provider_reasoning_effort: nullableText(reasoning.effective_provider_reasoning_effort), evidence_source: nullableText(reasoning.evidence_source) },
    adapter_execution: { executable: null, configuration_isolation: nullableText(isolation), ambient: null, arguments: [], sample_omission: "machine-specific execution details removed" },
    trial_provenance: { purpose: "sanitized flagship sample", future_candidate_enabled_tools: [] },
    candidate_tool_provenance: { explicitly_enabled: tools.explicitly_enabled === undefined ? [] : strings(tools.explicitly_enabled) }
  };
}

function safeValidation(value: Record<string, any>): Record<string, unknown> {
  const commands = value.commands === undefined ? [] : value.commands;
  if (!Array.isArray(commands)) throw new Error("sample source contains malformed public evidence");
  return { schema_version: text(value.schema_version), wall_clock_ms: optionalNumber(value.wall_clock_ms), commands: commands.map((raw) => {
    const command = record(raw);
    return { args: strings(command.args), working_directory: command.working_directory === "<path:worktree>" ? "<path:worktree>" : "<omitted: sanitized sample>", started_at: text(command.started_at), completed_at: text(command.completed_at), wall_clock_ms: optionalNumber(command.wall_clock_ms), exit_code: optionalNumber(command.exit_code), timeout: optionalBoolean(command.timeout) ?? false, stdout: "<omitted: sanitized sample>", stderr: "<omitted: sanitized sample>", launch_error: command.launch_error ? "<omitted: sanitized sample>" : null, failure_classification: nullableText(command.failure_classification), status: text(command.status) };
  }) };
}

function safeJudgeResult(value: Record<string, any>): Record<string, unknown> {
  const execution = (entry: Record<string, any> | null | undefined) => entry === null || entry === undefined ? null : { started_at: text(entry.started_at), completed_at: text(entry.completed_at), wall_clock_ms: optionalNumber(entry.wall_clock_ms), exit_code: optionalNumber(entry.exit_code), timeout: optionalBoolean(entry.timeout) ?? false, stdout: "<omitted: sanitized sample>", stderr: "<omitted: sanitized sample>", response_text: "<omitted: accepted response retained in adjudication.json>", launch_error: entry.launch_error ? "<omitted: sanitized sample>" : null, failure_classification: nullableText(entry.failure_classification), args: [] };
  return { status: text(value.status), original: execution(value.original), repair: execution(value.repair), error: value.error ? "<omitted: sanitized sample>" : null };
}

async function scanTree(directory: string, forbidden: string[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("sanitized sample contains an unsafe artifact");
    if (entry.isDirectory()) await scanTree(path, forbidden);
    else if (entry.isFile()) assertSafePublicArtifactText(await readFile(path, "utf8"), forbidden);
    else throw new Error("sanitized sample contains an unsafe artifact");
  }
}

export interface SanitizeSampleResult { directory: string; report: string; recommendation: string; }

/** Creates a sanitized derivative from verified evidence without changing the source run. */
export async function sanitizeSample(sourceDirectory: string, outputDirectory: string): Promise<SanitizeSampleResult> {
  const source = await realpath(resolve(sourceDirectory)), destination = resolve(outputDirectory);
  if (source === destination || contained(source, destination) || contained(destination, source)) throw new Error("sample destination must be separate from the source run");
  if ((await verifyReport(source)).status !== "VERIFIED") throw new Error("sample source must be finalized and verified");
  const run = await loadCompletedRun(source), destinationInfo = await lstat(destination).catch(() => null);
  if (destinationInfo?.isSymbolicLink() || destinationInfo && !destinationInfo.isDirectory()) throw new Error("sample destination is unsafe");
  if (destinationInfo) { const metadata = await readFile(join(destination, "sample-metadata.json"), "utf8").then(JSON.parse).catch(() => null); if (metadata?.kind !== "sanitized_derivative") throw new Error("sample destination must be absent or an Arena sanitized sample"); }
  await mkdir(dirname(destination), { recursive: true });
  const temporary = join(dirname(destination), `.${basename(destination)}.${process.pid}.tmp`), backup = join(dirname(destination), `.${basename(destination)}.${process.pid}.backup`);
  const hashes = new Map<string, string>(), sourceText = async (relativePath: string): Promise<string> => { const content = await readFile(join(source, ...relativePath.split("/")), "utf8"); hashes.set(relativePath, createHash("sha256").update(content).digest("hex")); return content; }, safeSourceText = async (relativePath: string): Promise<string> => assertSafePublicArtifactText(await sourceText(relativePath), [source]);
  const unchanged = async (): Promise<void> => { for (const [relativePath, hash] of hashes) if (createHash("sha256").update(await readFile(join(source, ...relativePath.split("/")), "utf8")).digest("hex") !== hash) throw new Error("source run changed during sanitation"); };
  await rm(temporary, { recursive: true, force: true }); await mkdir(join(temporary, "candidates"), { recursive: true });
  try {
    for (const name of rootNames) await writeFile(join(temporary, name), await safeSourceText(name), "utf8");
    await sourceText("judge-result.json"); await writeFile(join(temporary, "judge-result.json"), json(safeJudgeResult(run.judgeResult)), "utf8");
    for (const candidate of run.candidates) {
      const candidateDirectory = `candidates/${candidate.manifest.candidate_id}`, target = join(temporary, ...candidateDirectory.split("/")); await mkdir(target);
      await sourceText(`${candidateDirectory}/provenance.json`); await writeFile(join(target, "provenance.json"), json(safeProvenance(candidate.provenance)), "utf8");
      await writeFile(join(target, "telemetry.json"), await safeSourceText(`${candidateDirectory}/telemetry.json`), "utf8");
      await sourceText(`${candidateDirectory}/validation.json`); await writeFile(join(target, "validation.json"), json(safeValidation(candidate.validation)), "utf8");
      await writeFile(join(target, "candidate.diff"), await safeSourceText(`${candidateDirectory}/candidate.diff`), "utf8");
    }
    await writeFile(join(temporary, "sample-metadata.json"), json({ schema_version: "1.0", kind: "sanitized_derivative", evidence_completeness_scope: "source_run", omitted_artifacts: ["raw events and logs", "worktrees and executable locations", "private judge transcripts and account/session material"], retained_results: "Accepted deterministic and semantic results are retained from the finalized source run." }), "utf8");
    await writeFile(join(temporary, "README.md"), "# Sanitized Arena sample\n\nGenerated from verified finalized evidence. Raw logs, credentials, worktrees, executable locations, and judge transcripts are intentionally omitted.\n", "utf8");
    await generateReport(temporary); await scanTree(temporary, [source]);
    if ((await verifyReport(temporary)).status !== "VERIFIED") throw new Error("sanitized sample verification failed");
    await scanTree(temporary, [source]); await unchanged();
    if (destinationInfo) await rename(destination, backup);
    await rename(temporary, destination); await rm(backup, { recursive: true, force: true });
    return { directory: destination, report: "report.html", recommendation: "recommendation.yml" };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (destinationInfo && await lstat(backup).then(() => true).catch(() => false) && !await lstat(destination).then(() => true).catch(() => false)) await rename(backup, destination);
    throw error;
  }
}
