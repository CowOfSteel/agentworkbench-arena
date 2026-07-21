import { Candidate, Trial } from "./trial";

export const topologyDimensions = ["adapter", "harness", "provider", "model", "attention", "agent", "profile", "permission_policy", "declared_tools_plugins"] as const;
export type TopologyDimension = typeof topologyDimensions[number];
export type TopologyValues = Partial<Record<TopologyDimension, unknown>>;
export interface TopologyCandidate { id: string; dimensions: TopologyValues; }
export interface TopologyGroup { dimension: TopologyDimension; candidates: string[]; values: Array<{ candidate: string; value: unknown }>; }
export interface TopologyPair { candidates: [string, string]; differing_dimensions: TopologyDimension[]; }
export interface ComparisonTopology {
  candidate_count: number;
  held_constant_dimensions: TopologyDimension[];
  varied_dimensions: Array<{ dimension: TopologyDimension; values: unknown[]; incomplete: boolean }>;
  controlled_sweeps: TopologyGroup[];
  duplicate_configuration_groups: string[][];
  multi_variable_pair_count: number;
  multi_variable_pairs: TopologyPair[];
  multi_variable_pairs_truncated: boolean;
  uncomparable_pair_count: number;
  supported_structural_claims: string[];
  unsupported_causal_claims: string[];
}

const canonical = (value: unknown): string => value === undefined ? "<unavailable>" : JSON.stringify(value);
const values = (input: unknown): string[] | undefined => Array.isArray(input) && input.every((item) => typeof item === "string") ? [...input].sort() : input === undefined ? undefined : [];
const normalizedCandidate = (candidate: Candidate): TopologyCandidate => ({
  id: candidate.id,
  dimensions: {
    adapter: candidate.adapter, harness: candidate.harness, provider: candidate.provider ?? null, model: candidate.model,
    attention: candidate.attention ?? null, agent: candidate.agent ?? null, profile: candidate.profile ?? null,
    permission_policy: candidate.permissionPolicy ?? null, declared_tools_plugins: values(candidate.toolProvenance?.explicitly_enabled) ?? []
  }
});

export function topologyFromTrial(trial: Trial): ComparisonTopology { return analyzeTopology(trial.candidates.map(normalizedCandidate)); }

export function analyzeTopology(input: TopologyCandidate[]): ComparisonTopology {
  const candidates = [...input].map((candidate) => ({ ...candidate, dimensions: { ...candidate.dimensions } })).sort((left, right) => left.id.localeCompare(right.id));
  const held_constant_dimensions = topologyDimensions.filter((dimension) => candidates.length > 0 && candidates.every((candidate) => candidate.dimensions[dimension] !== undefined) && new Set(candidates.map((candidate) => canonical(candidate.dimensions[dimension]))).size === 1);
  const varied_dimensions = topologyDimensions.flatMap((dimension) => {
    const known = candidates.map((candidate) => candidate.dimensions[dimension]).filter((value) => value !== undefined), distinct = [...new Map(known.map((value) => [canonical(value), value])).values()];
    return distinct.length > 1 ? [{ dimension, values: distinct, incomplete: known.length !== candidates.length }] : [];
  });
  const controlled_sweeps: TopologyGroup[] = [];
  for (const dimension of topologyDimensions) {
    const groups = new Map<string, TopologyCandidate[]>();
    for (const candidate of candidates) {
      if (candidate.dimensions[dimension] === undefined || topologyDimensions.some((other) => other !== dimension && candidate.dimensions[other] === undefined)) continue;
      const key = topologyDimensions.filter((other) => other !== dimension).map((other) => `${other}:${canonical(candidate.dimensions[other])}`).join("|");
      groups.set(key, [...(groups.get(key) ?? []), candidate]);
    }
    for (const group of groups.values()) if (group.length >= 2 && new Set(group.map((candidate) => canonical(candidate.dimensions[dimension]))).size > 1) controlled_sweeps.push({ dimension, candidates: group.map((candidate) => candidate.id), values: group.map((candidate) => ({ candidate: candidate.id, value: candidate.dimensions[dimension] })) });
  }
  controlled_sweeps.sort((left, right) => `${left.dimension}:${left.candidates.join("|")}`.localeCompare(`${right.dimension}:${right.candidates.join("|")}`));
  const duplicates = new Map<string, string[]>();
  for (const candidate of candidates) if (topologyDimensions.every((dimension) => candidate.dimensions[dimension] !== undefined)) {
    const key = topologyDimensions.map((dimension) => canonical(candidate.dimensions[dimension])).join("|"); duplicates.set(key, [...(duplicates.get(key) ?? []), candidate.id]);
  }
  const duplicate_configuration_groups = [...duplicates.values()].filter((group) => group.length > 1).sort((left, right) => left.join("|").localeCompare(right.join("|")));
  const multi_variable_pairs: TopologyPair[] = [], allPairs: TopologyPair[] = []; let uncomparable_pair_count = 0;
  for (let left = 0; left < candidates.length; left++) for (let right = left + 1; right < candidates.length; right++) {
    const first = candidates[left], second = candidates[right];
    if (topologyDimensions.some((dimension) => first.dimensions[dimension] === undefined || second.dimensions[dimension] === undefined)) { uncomparable_pair_count++; continue; }
    const differing_dimensions = topologyDimensions.filter((dimension) => canonical(first.dimensions[dimension]) !== canonical(second.dimensions[dimension]));
    if (differing_dimensions.length > 1) allPairs.push({ candidates: [first.id, second.id], differing_dimensions });
  }
  multi_variable_pairs.push(...allPairs.slice(0, 24));
  const supported_structural_claims = controlled_sweeps.map((group) => `${group.candidates.join(", ")} differ only in ${group.dimension}.`);
  const unsupported_causal_claims = ["Topology is structural analysis only; it does not establish causal effects.", ...(allPairs.length ? ["Multi-variable comparisons cannot support a single-dimension causal claim."] : []), ...(uncomparable_pair_count ? ["Some pairs lack complete configuration provenance and are not structurally comparable."] : [])];
  return { candidate_count: candidates.length, held_constant_dimensions, varied_dimensions, controlled_sweeps, duplicate_configuration_groups, multi_variable_pair_count: allPairs.length, multi_variable_pairs, multi_variable_pairs_truncated: allPairs.length > multi_variable_pairs.length, uncomparable_pair_count, supported_structural_claims, unsupported_causal_claims };
}
