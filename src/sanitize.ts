import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { generateReport, loadCompletedRun, verifyReport } from "./report";

const unsafe = /(?:(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/]|file:\/\/|\/(?:Users|home|private|mnt|opt|var)\/|(?:access[_ -]?token|api[_ -]?key|password|secret|credential)\s*[:=])/i;
const rootNames = ["manifest.json", "task-contract.json", "trial-snapshot.json", "identity-map.json", "evaluation.json", "adjudication.json"] as const;
const candidateNames = ["telemetry.json", "candidate.diff"] as const;
const contained = (root: string, value: string): boolean => { const result = relative(root, value); return result !== "" && !result.startsWith("..") && !isAbsolute(result); };
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const safeText = (value: string): string => { if (unsafe.test(value)) throw new Error("sample source contains a secret or absolute path"); return value; };

function safeProvenance(value: Record<string, any>): Record<string, unknown> {
  return { trial_id: value.trial_id, candidate_id: value.candidate_id, task_contract_hash: value.task_contract_hash, baseline_commit: value.baseline_commit, adapter: value.adapter, harness: value.harness, provider: value.provider ?? null, model: value.model, attention: value.attention ?? null, agent: value.agent ?? null, profile: value.profile ?? null, permission_policy: value.permission_policy ?? null, display_name: value.display_name ?? null, display_variant: value.display_variant ?? null, native_reasoning_effort: value.native_reasoning_effort ?? null, provider_route: value.provider_route ?? null, native_variant: value.native_variant ?? null, reasoning: value.reasoning ?? {}, adapter_execution: { executable: null, configuration_isolation: value.adapter_execution?.configuration_isolation ?? null, ambient: null, arguments: [], sample_omission: "machine-specific execution details removed" }, trial_provenance: { purpose: "sanitized flagship sample", future_candidate_enabled_tools: [] }, candidate_tool_provenance: value.candidate_tool_provenance ?? { explicitly_enabled: [] } };
}
function safeValidation(value: Record<string, any>): Record<string, unknown> {
  return { schema_version: value.schema_version, wall_clock_ms: value.wall_clock_ms, commands: Array.isArray(value.commands) ? value.commands.map((command: Record<string, unknown>) => ({ ...command, stdout: "<omitted: sanitized sample>", stderr: "<omitted: sanitized sample>", launch_error: command.launch_error ? "<omitted: sanitized sample>" : null })) : [] };
}
function safeJudgeResult(value: Record<string, any>): Record<string, unknown> {
  const execution = (entry: Record<string, any> | null | undefined) => entry === null || entry === undefined ? null : { started_at: entry.started_at, completed_at: entry.completed_at, wall_clock_ms: entry.wall_clock_ms, exit_code: entry.exit_code, timeout: entry.timeout, stdout: "<omitted: sanitized sample>", stderr: "<omitted: sanitized sample>", response_text: "<omitted: accepted response retained in adjudication.json>", launch_error: entry.launch_error ? "<omitted: sanitized sample>" : null, failure_classification: entry.failure_classification ?? null, args: [] };
  return { status: value.status, original: execution(value.original), repair: execution(value.repair), error: value.error ? "<omitted: sanitized sample>" : null };
}

export interface SanitizeSampleResult { directory: string; report: string; recommendation: string; }

/** Creates a sanitized derivative from verified evidence without changing the source run. */
export async function sanitizeSample(sourceDirectory: string, outputDirectory: string): Promise<SanitizeSampleResult> {
  const source = await realpath(resolve(sourceDirectory)), destination = resolve(outputDirectory);
  if (source === destination || contained(source, destination) || contained(destination, source)) throw new Error("sample destination must be separate from the source run");
  if ((await verifyReport(source)).status !== "VERIFIED") throw new Error("sample source must be finalized and verified");
  const run = await loadCompletedRun(source), destinationInfo = await lstat(destination).catch(() => null);
  if (destinationInfo?.isSymbolicLink() || destinationInfo && !destinationInfo.isDirectory()) throw new Error("sample destination is unsafe");
  if (destinationInfo) {
    const metadata = await readFile(join(destination, "sample-metadata.json"), "utf8").then(JSON.parse).catch(() => null);
    if (metadata?.kind !== "sanitized_derivative") throw new Error("sample destination must be absent or an Arena sanitized sample");
  }
  await mkdir(dirname(destination), { recursive: true });
  const temporary = join(dirname(destination), `.${basename(destination)}.${process.pid}.tmp`), backup = join(dirname(destination), `.${basename(destination)}.${process.pid}.backup`);
  await rm(temporary, { recursive: true, force: true }); await mkdir(join(temporary, "candidates"), { recursive: true });
  try {
    for (const name of rootNames) await writeFile(join(temporary, name), safeText(await readFile(join(source, name), "utf8")), "utf8");
    await writeFile(join(temporary, "judge-result.json"), json(safeJudgeResult(run.judgeResult)), "utf8");
    for (const candidate of run.candidates) {
      const target = join(temporary, "candidates", candidate.manifest.candidate_id); await mkdir(target);
      await writeFile(join(target, "provenance.json"), json(safeProvenance(candidate.provenance)), "utf8");
      await writeFile(join(target, "telemetry.json"), safeText(await readFile(join(source, ...candidate.directory.split("/"), "telemetry.json"), "utf8")), "utf8");
      await writeFile(join(target, "validation.json"), json(safeValidation(candidate.validation)), "utf8");
      await writeFile(join(target, "candidate.diff"), safeText(candidate.diff), "utf8");
    }
    await writeFile(join(temporary, "sample-metadata.json"), json({ schema_version: "1.0", kind: "sanitized_derivative", evidence_completeness_scope: "source_run", omitted_artifacts: ["raw events and logs", "worktrees and executable locations", "private judge transcripts and account/session material"], retained_results: "Accepted deterministic and semantic results are retained from the finalized source run." }), "utf8");
    await writeFile(join(temporary, "README.md"), "# Sanitized Arena sample\n\nGenerated from verified finalized evidence. Raw logs, credentials, worktrees, executable locations, and judge transcripts are intentionally omitted.\n", "utf8");
    await generateReport(temporary);
    for (const path of ["report.html", "recommendation.yml", "sample-metadata.json"]) safeText(await readFile(join(temporary, path), "utf8"));
    if (destinationInfo) await rename(destination, backup);
    await rename(temporary, destination);
    await rm(backup, { recursive: true, force: true });
    return { directory: destination, report: "report.html", recommendation: "recommendation.yml" };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (destinationInfo && await lstat(backup).then(() => true).catch(() => false) && !await lstat(destination).then(() => true).catch(() => false)) await rename(backup, destination);
    throw error;
  }
}
