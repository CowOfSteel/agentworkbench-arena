# Locked Decisions

1. Trials support two or more candidates.
2. Candidate count is configuration data and must not be hard-coded in the runner or schema.
3. A configurable operational safety limit may be added later, but it is not a product-level maximum.
4. The first live trial uses six configurations: Luna Low, Luna Medium, and Luna High through Codex, plus Luna Low, Luna Medium, and Luna High through OpenCode.
5. Candidate enumeration is independent of adapter enumeration.
6. Plugins and tools, including RTK and Ponytail, are part of candidate provenance and configuration identity.
7. Phase 0 may reserve schema concepts for plugins and tools, but does not implement plugin orchestration, installation, execution, or plugin-specific telemetry.
8. Raw evidence remains authoritative.
9. Arena remains separate from AgentWorkbench v1.
10. Core implementation remains in one primary Codex conversation.
11. Arena compares complete configurations and must not make unsupported single-variable causal claims.
12. Phase 0 uses a minimal TypeScript CLI, Node’s built-in test runner, and no runtime dependencies.
13. The project uses the MIT license.
14. Phase 2 artifacts use schema version `2.0`; raw event streams remain authoritative and unknown native events are retained.
15. Arena measures elapsed duration with a monotonic clock. Candidate process timing, independent validation timing, and full-pipeline timing are separate facts.
16. Unavailable telemetry is `null` with explicit availability metadata; Arena does not treat unavailable values as zero or convert subscription use into API cost.
17. Candidate configuration hashes use canonical key ordering, sorted declared tool/plugin collections, semantic execution limits, and exclude secrets, candidate IDs, and machine-local executable paths.
18. `manifest.json` is the canonical Phase 2 run index. Historical `run.json` files remain untouched; newly written compatibility `run.json` is secondary.
19. Every Phase 2 hard gate is explicit and evidence-backed. Failed or unavailable gates cannot pass and cannot be overridden by later GPT adjudication.
20. Phase 3 reads finalized Phase 2 packets only. Identity-masked semantic adjudication is subordinate to deterministic hard gates; failed or unavailable candidates are ineligible.
21. The Phase 3 judge uses `gpt-5.6-sol` in read-only ephemeral mode with no approvals. Low is the default reasoning effort; High requires an explicit human stabilization invocation; higher efforts are prohibited.
22. New Phase 2 runs preserve a safe, hash-checked canonical task contract for Phase 3. Older runs remain historical evidence but are not packet-ready without that artifact.
23. Phase 3 packets are constructed only from allowlisted fields and enforce symmetric evidence budgets; identity or local-path leakage is a deterministic refusal, not a redaction guess.
