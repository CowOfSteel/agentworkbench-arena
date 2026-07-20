import { readFile } from "node:fs/promises";
import { parse } from "yaml";

export type AdapterId = "codex-exec" | "opencode-run";

export interface Candidate {
  id: string;
  adapter: AdapterId;
  harness: string;
  provider?: string;
  model: string;
  attention?: string;
  agent?: string;
  profile?: string;
  permissionPolicy?: string;
  adapterOptions?: Record<string, unknown>;
  toolProvenance?: Record<string, unknown>;
}

export interface Trial {
  id: string;
  repository: string;
  baselineRef: string;
  taskContract: string;
  allowedPaths: string[];
  forbiddenPaths: string[];
  validationCommands: string[][];
  validationTimeoutMs: number;
  dependencyPolicy: "no_changes" | "allow_changes";
  timeoutMs: number;
  maxLaunchTransportRetries: number;
  manualIntervention: "forbidden";
  provenance: Record<string, unknown>;
  candidates: Candidate[];
}

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a mapping`);
  return value as Record<string, unknown>;
};
const text = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
};
const strings = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be a string list`);
  return value as string[];
};

const windowsReservedNames = new Set(["con", "prn", "aux", "nul", ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`), ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`)]);
const maximumSlugLength = 48;
const slug = (value: unknown, label: string): string => {
  const result = text(value, label);
  if (result.length > maximumSlugLength || !/^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/.test(result) || windowsReservedNames.has(result.toLowerCase())) {
    throw new Error(`${label} must be a safe filesystem slug`);
  }
  return result;
};

export function validateTrial(value: unknown): Trial {
  const raw = object(value, "trial");
  const commands = raw.validation_commands;
  if (!Array.isArray(commands) || commands.length === 0 || commands.some((command) => !Array.isArray(command) || command.some((part) => typeof part !== "string") || command.length === 0)) {
    throw new Error("validation_commands must be a non-empty list of argument lists");
  }
  const retry = object(raw.retry_policy, "retry_policy");
  const candidates = raw.candidates;
  if (!Array.isArray(candidates) || candidates.length < 2) throw new Error("candidates must contain at least two entries");
  const parsedCandidates = candidates.map((item, index) => {
    const candidate = object(item, `candidates[${index}]`);
    const adapter = text(candidate.adapter, `candidates[${index}].adapter`);
    if (adapter !== "codex-exec" && adapter !== "opencode-run") throw new Error(`unsupported adapter: ${adapter}`);
    return {
      id: slug(candidate.id, `candidates[${index}].id`),
      adapter: adapter as AdapterId,
      harness: text(candidate.harness, `candidates[${index}].harness`),
      provider: candidate.provider === undefined ? undefined : text(candidate.provider, `candidates[${index}].provider`),
      model: text(candidate.model, `candidates[${index}].model`),
      attention: candidate.attention === undefined ? undefined : text(candidate.attention, `candidates[${index}].attention`),
      agent: candidate.agent === undefined ? undefined : text(candidate.agent, `candidates[${index}].agent`),
      profile: candidate.profile === undefined ? undefined : text(candidate.profile, `candidates[${index}].profile`),
      permissionPolicy: candidate.permission_policy === undefined ? undefined : text(candidate.permission_policy, `candidates[${index}].permission_policy`),
      adapterOptions: candidate.adapter_options === undefined ? undefined : object(candidate.adapter_options, `candidates[${index}].adapter_options`),
      toolProvenance: candidate.tool_provenance === undefined ? undefined : object(candidate.tool_provenance, `candidates[${index}].tool_provenance`)
    };
  });
  for (const [index, candidate] of parsedCandidates.entries()) {
    const executable = candidate.adapterOptions?.codex_executable;
    if (executable !== undefined && (candidate.adapter !== "codex-exec" || typeof executable !== "string" || !executable.trim())) {
      throw new Error(`candidates[${index}].adapter_options.codex_executable must be a non-empty string for codex-exec`);
    }
  }
  const normalizedCandidateIds = parsedCandidates.map((candidate) => candidate.id.toLowerCase());
  if (new Set(normalizedCandidateIds).size !== parsedCandidates.length) throw new Error("candidate ids must be unique case-insensitively");
  const timeoutMs = raw.timeout_ms;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeout_ms must be positive");
  const validationTimeoutMs = raw.validation_timeout_ms;
  if (typeof validationTimeoutMs !== "number" || !Number.isFinite(validationTimeoutMs) || validationTimeoutMs <= 0) throw new Error("validation_timeout_ms must be positive");
  const dependencyPolicy = raw.dependency_policy;
  if (dependencyPolicy !== "no_changes" && dependencyPolicy !== "allow_changes") throw new Error("dependency_policy must be no_changes or allow_changes");
  const retries = retry.max_launch_transport_retries;
  if (retries !== 1) throw new Error("retry_policy.max_launch_transport_retries must be 1 in Phase 1");
  if (raw.manual_intervention !== "forbidden") throw new Error("manual_intervention must be forbidden in Phase 1");
  return {
    id: slug(raw.id, "id"), repository: text(raw.repository, "repository"), baselineRef: text(raw.baseline_ref, "baseline_ref"),
    taskContract: text(raw.task_contract, "task_contract"), allowedPaths: strings(raw.allowed_paths, "allowed_paths"),
    forbiddenPaths: strings(raw.forbidden_paths, "forbidden_paths"), validationCommands: commands as string[][],
    timeoutMs, validationTimeoutMs, dependencyPolicy, maxLaunchTransportRetries: retries, manualIntervention: "forbidden",
    provenance: object(raw.provenance, "provenance"), candidates: parsedCandidates
  };
}

export async function loadTrial(path: string): Promise<Trial> {
  return validateTrial(parse(await readFile(path, "utf8")));
}
