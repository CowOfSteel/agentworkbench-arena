import { createHash } from "node:crypto";
import { CandidateAdapter, CommandStatus, commandStatus, openCodeArgs, openCodeCommand, argumentShape, codexArgs } from "./adapters";
import { unresolvedPlaceholders } from "./preview";
import { Candidate, Trial } from "./trial";

export type Readiness = "ready" | "blocked";
export interface CandidateDoctorRecord {
  candidate_id: string; adapter: string; harness: string; provider: string | null; provider_route: string | null; model: string;
  native_reasoning_effort: string | null; native_variant: string | null; agent: string | null; profile: string | null;
  command_shape: string[]; executable: "available" | "unavailable"; authentication: "available" | "missing" | "unknown";
  model_discovery: "present" | "missing" | "not_supported" | "unavailable"; variant_syntax: "supported" | "not_discoverable" | "not_applicable";
  configuration_layering: "composed" | "blocked" | "not_applicable"; readiness: Readiness; failure_classification: string | null; warnings: string[]; placeholders: string[];
}
export interface ProviderRouteRecord { adapter: string; harness: string; provider: string | null; provider_route: string | null; candidate_ids: string[]; readiness: Readiness; failure_classifications: string[]; }
export interface DoctorReport { schema_version: "1.0"; trial_id: string; adapter_readiness: Array<{ adapter: string; executable: "available" | "unavailable"; authentication: "available" | "missing" | "unknown"; readiness: Readiness; failure_classification: string | null; }>; candidates: CandidateDoctorRecord[]; provider_routes: ProviderRouteRecord[]; readiness: Readiness; }
export interface DoctorDependencies { commandStatus?: (command: string, args: string[]) => Promise<CommandStatus>; openCodeCommand?: () => Promise<string>; }

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const nativeVariant = (candidate: Candidate): string | null => typeof candidate.adapterOptions?.native_variant === "string" ? candidate.adapterOptions.native_variant : candidate.attention ?? null;
const shape = (candidate: Candidate, hash: string): string[] => argumentShape(candidate.adapter === "codex-exec" ? codexArgs({ candidate, worktree: "doctor-worktree", artifactDirectory: "doctor-artifacts", prompt: "doctor", timeoutMs: 1 }) : openCodeArgs({ candidate, worktree: "doctor-worktree", artifactDirectory: "doctor-artifacts", prompt: "doctor", timeoutMs: 1 }), hash);
const codexEfforts = new Set(["none", "low", "medium", "high", "xhigh", "max"]);

async function openCodeFacts(provider: string, dependencies: DoctorDependencies): Promise<{ authentication: CandidateDoctorRecord["authentication"]; modelDiscovery: CandidateDoctorRecord["model_discovery"]; models: Set<string> }> {
  const status = dependencies.commandStatus ?? commandStatus, executable = await (dependencies.openCodeCommand ?? openCodeCommand)();
  const [auth, models] = await Promise.all([status(executable, ["auth", "list"]), status(executable, ["models", provider])]);
  const providerPresent = auth.ok && normalize(auth.stdout).includes(normalize(provider));
  return { authentication: !auth.ok ? "unknown" : providerPresent ? "available" : "missing", modelDiscovery: models.ok ? "present" : "unavailable", models: new Set(models.stdout.split(/\r?\n/).map((value) => value.trim().toLowerCase()).filter(Boolean)) };
}

export async function doctorTrial(trial: Trial, adapters: Map<string, CandidateAdapter>, dependencies: DoctorDependencies = {}): Promise<DoctorReport> {
  const trialHash = createHash("sha256").update(trial.taskContract).digest("hex");
  const adapterResults = new Map<string, Awaited<ReturnType<CandidateAdapter["doctor"]>>>();
  for (const candidate of trial.candidates) if (!adapterResults.has(candidate.adapter)) {
    const adapter = adapters.get(candidate.adapter); if (!adapter) throw new Error(`no adapter registered for ${candidate.adapter}`);
    adapterResults.set(candidate.adapter, await adapter.doctor(candidate));
  }
  const openCodeCache = new Map<string, Promise<Awaited<ReturnType<typeof openCodeFacts>>>>();
  const candidates: CandidateDoctorRecord[] = [];
  for (const candidate of trial.candidates) {
    const adapter = adapterResults.get(candidate.adapter)!;
    const placeholders = [...new Set(unresolvedPlaceholders(candidate))].sort();
    const variant = nativeVariant(candidate), warnings: string[] = [];
    let authentication: CandidateDoctorRecord["authentication"] = adapter.authentication?.existing_cli_state === "usable" ? "available" : adapter.ok ? "unknown" : "missing";
    let modelDiscovery: CandidateDoctorRecord["model_discovery"] = candidate.adapter === "codex-exec" ? "not_supported" : "unavailable";
    let variantSyntax: CandidateDoctorRecord["variant_syntax"] = candidate.adapter === "codex-exec" ? "not_applicable" : variant ? "supported" : "not_discoverable";
    let layering: CandidateDoctorRecord["configuration_layering"] = candidate.adapter === "opencode-run" ? adapter.configuration_layering?.status ?? "blocked" : "not_applicable";
    let failure: string | null = placeholders.length ? "unresolved_placeholder" : !adapter.ok ? "adapter_unavailable" : null;
    if (candidate.adapter === "codex-exec" && candidate.nativeReasoningEffort && !codexEfforts.has(candidate.nativeReasoningEffort)) failure ??= "unsupported_native_reasoning";
    if (candidate.adapter === "opencode-run") {
      if (!candidate.provider) failure ??= "provider_missing";
      else if (!unresolvedPlaceholders(candidate.provider).length) {
        const key = candidate.provider.toLowerCase(), facts = openCodeCache.get(key) ?? openCodeFacts(candidate.provider, dependencies); openCodeCache.set(key, facts);
        const discovered = await facts;
        authentication = discovered.authentication; modelDiscovery = discovered.modelDiscovery;
        if (discovered.modelDiscovery === "present" && !discovered.models.has(`${candidate.provider}/${candidate.model}`.toLowerCase())) failure ??= "model_not_discovered";
        if (discovered.modelDiscovery === "unavailable") failure ??= "model_discovery_unavailable";
        if (authentication !== "available") failure ??= authentication === "missing" ? "authentication_missing" : "authentication_unknown";
      }
      if (layering === "blocked") failure ??= "configuration_layering_blocked";
      if (variantSyntax === "not_discoverable") warnings.push("native variant is not declared; legacy attention is used only when present");
    }
    if (candidate.adapter === "codex-exec" && modelDiscovery === "not_supported") warnings.push("Codex exposes no local model-list command; route doctor validates executable, authentication, and declared effort only");
    candidates.push({ candidate_id: candidate.id, adapter: candidate.adapter, harness: candidate.harness, provider: candidate.provider ?? null, provider_route: candidate.providerRoute ?? null, model: candidate.model, native_reasoning_effort: candidate.nativeReasoningEffort ?? null, native_variant: variant, agent: candidate.agent ?? null, profile: candidate.profile ?? null, command_shape: shape(candidate, trialHash), executable: adapter.executable_status === "available" ? "available" : "unavailable", authentication, model_discovery: modelDiscovery, variant_syntax: variantSyntax, configuration_layering: layering, readiness: failure ? "blocked" : "ready", failure_classification: failure, warnings, placeholders });
  }
  const adapter_readiness = [...adapterResults.entries()].map(([adapter, result]) => ({ adapter, executable: result.executable_status === "available" ? "available" as const : "unavailable" as const, authentication: result.authentication?.existing_cli_state === "usable" ? "available" as const : result.ok ? "unknown" as const : "missing" as const, readiness: result.ok ? "ready" as const : "blocked" as const, failure_classification: result.ok ? null : "adapter_unavailable" }));
  const routes = new Map<string, ProviderRouteRecord>();
  for (const candidate of candidates) {
    const key = [candidate.adapter, candidate.harness, candidate.provider ?? "", candidate.provider_route ?? ""].join("\u0000"), current = routes.get(key) ?? { adapter: candidate.adapter, harness: candidate.harness, provider: candidate.provider, provider_route: candidate.provider_route, candidate_ids: [], readiness: "ready" as Readiness, failure_classifications: [] };
    current.candidate_ids.push(candidate.candidate_id); if (candidate.readiness === "blocked") current.readiness = "blocked"; if (candidate.failure_classification) current.failure_classifications.push(candidate.failure_classification); routes.set(key, current);
  }
  const provider_routes = [...routes.values()].map((route) => ({ ...route, candidate_ids: route.candidate_ids.sort(), failure_classifications: [...new Set(route.failure_classifications)].sort() })).sort((left, right) => `${left.adapter}:${left.provider_route}:${left.provider}`.localeCompare(`${right.adapter}:${right.provider_route}:${right.provider}`));
  return { schema_version: "1.0", trial_id: trial.id, adapter_readiness, candidates, provider_routes, readiness: candidates.every((candidate) => candidate.readiness === "ready") ? "ready" : "blocked" };
}
