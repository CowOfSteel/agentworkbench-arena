import { createHash } from "node:crypto";
import { Candidate, Trial } from "./trial";

export const telemetrySchemaVersion = "2.0";
export type Availability = "available" | "unavailable";
export interface Metric<T> { value: T | null; availability: Availability; source: string; }
export const available = <T>(value: T, source = "arena"): Metric<T> => ({ value, availability: "available", source });
export const unavailable = <T>(source = "unavailable"): Metric<T> => ({ value: null, availability: "unavailable", source });

export interface NativeTelemetry {
  schema_version: string;
  harness: string;
  recognized_events: Array<Record<string, unknown>>;
  unknown_events: Array<Record<string, unknown>>;
  malformed_lines: Array<{ line: number; raw: string }>;
  limitations: string[];
  extracted: Record<string, Metric<number | string>>;
}

const asObject = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const number = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;

export function extractNativeTelemetry(harness: string, raw: string): NativeTelemetry {
  const recognized_events: Array<Record<string, unknown>> = [];
  const unknown_events: Array<Record<string, unknown>> = [];
  const malformed_lines: Array<{ line: number; raw: string }> = [];
  let turns = 0;
  let tools = 0;
  let commands = 0;
  let approvals = 0;
  let questions = 0;
  let errors = 0;
  let inputTokens: number | undefined;
  let cachedInputTokens: number | undefined;
  let outputTokens: number | undefined;
  let cost: number | undefined;

  raw.split(/\r?\n/).forEach((line, index) => {
    if (!line) return;
    let event: Record<string, unknown> | undefined;
    try { event = asObject(JSON.parse(line)); } catch { malformed_lines.push({ line: index + 1, raw: line }); return; }
    if (!event) { malformed_lines.push({ line: index + 1, raw: line }); return; }
    const type = typeof event.type === "string" ? event.type : "";
    const item = asObject(event.item) ?? asObject(event.part);
    const itemType = typeof item?.type === "string" ? item.type : "";
    const known = harness === "codex"
      ? type === "turn.started" || type === "turn.completed" || type.startsWith("item.") || type.includes("error")
      : type === "step_start" || type === "step_finish" || type === "tool_use" || type === "tool" || type === "text" || type.includes("error");
    (known ? recognized_events : unknown_events).push(event);
    if (!known) return;
    if (type === "turn.started" || type === "step_start") turns += 1;
    if (itemType === "command_execution" || type === "tool_use" || type === "tool") { tools += 1; if (itemType === "command_execution" || type === "tool_use") commands += 1; }
    if (/approval|permission/i.test(type) || /approval|permission/i.test(itemType)) approvals += 1;
    if (/question/i.test(type) || /question/i.test(itemType)) questions += 1;
    if (/error|failed/i.test(type)) errors += 1;
    const tokens = asObject(event.tokens) ?? asObject(item?.tokens);
    if (tokens) {
      inputTokens = number(tokens.input) ?? number(tokens.input_tokens) ?? inputTokens;
      cachedInputTokens = number(tokens.cached) ?? number(tokens.cache_read) ?? cachedInputTokens;
      outputTokens = number(tokens.output) ?? number(tokens.output_tokens) ?? outputTokens;
    }
    cost = number(event.cost) ?? number(asObject(event.usage)?.cost) ?? cost;
  });
  const source = `${harness}-jsonl`;
  const metric = (value: number | undefined) => value === undefined ? unavailable<number>(source) : available(value, source);
  const limitations = [
    ...(malformed_lines.length ? [`${malformed_lines.length} malformed JSONL line(s) retained`] : []),
    ...(unknown_events.length ? [`${unknown_events.length} unknown native event(s) retained`] : []),
    ...(raw.trim() ? [] : ["native event stream was empty"])
  ];
  return { schema_version: telemetrySchemaVersion, harness, recognized_events, unknown_events, malformed_lines, limitations,
    extracted: { turn_count: available(turns, source), tool_call_count: available(tools, source), command_count: available(commands, source), approval_count: available(approvals, source), user_questions: available(questions, source), error_count: available(errors, source), input_tokens: metric(inputTokens), cached_input_tokens: metric(cachedInputTokens), output_tokens: metric(outputTokens), provider_reported_cost: cost === undefined ? unavailable<number>(source) : available(cost, source) } };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export const canonicalJson = (value: unknown): string => JSON.stringify(canonical(value));

const sanitizedOptions = (candidate: Candidate): Record<string, unknown> => {
  const options = candidate.adapterOptions ?? {};
  const overrides = asObject(options.config_overrides) ?? {};
  return Object.fromEntries(Object.entries(overrides).filter(([key]) => !/token|secret|password|credential|key/i.test(key)));
};

export function configurationHash(candidate: Candidate, trial: Trial): string {
  const declaredTools = Array.isArray(candidate.toolProvenance?.explicitly_enabled) ? [...candidate.toolProvenance.explicitly_enabled].map(String).sort() : [];
  return createHash("sha256").update(canonicalJson({ adapter: candidate.adapter, harness: candidate.harness, provider: candidate.provider ?? null, model: candidate.model, attention: candidate.attention ?? null, agent: candidate.agent ?? null, profile: candidate.profile ?? null, permission_policy: candidate.permissionPolicy ?? null, declared_tools: declaredTools, config_overrides: sanitizedOptions(candidate), execution_limits: { timeout_ms: trial.timeoutMs, validation_timeout_ms: trial.validationTimeoutMs, retry_limit: trial.maxLaunchTransportRetries, manual_intervention: trial.manualIntervention } })).digest("hex");
}

export function trialSnapshot(trial: Trial): Record<string, unknown> {
  return { schema_version: telemetrySchemaVersion, trial_id: trial.id, task_contract_hash: createHash("sha256").update(trial.taskContract).digest("hex"), allowed_paths: [...trial.allowedPaths].sort(), forbidden_paths: [...trial.forbiddenPaths].sort(), validation_commands: trial.validationCommands, timeout_ms: trial.timeoutMs, validation_timeout_ms: trial.validationTimeoutMs, dependency_policy: trial.dependencyPolicy, retry_limit: trial.maxLaunchTransportRetries, manual_intervention: trial.manualIntervention, candidates: trial.candidates.map((candidate) => ({ id: candidate.id, configuration_hash: configurationHash(candidate, trial) })) };
}
