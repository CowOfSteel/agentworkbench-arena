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
24. Strong or high-entropy identities may use substring detection; generic configuration values require contextual or token-aware detection; executable provenance identity uses the executable path only, not metadata values such as provenance source labels; and identity masking must reject actual configuration leakage without rejecting ordinary words such as `allowed`, `build`, or `path`.
25. Phase 4 is a read-only presentation pass. `evaluation.json` is authoritative for outcome, eligibility, and candidate ordering; reports may validate consistency but may not recompute or override those decisions.
26. `report.html` and `recommendation.yml` share one typed presentation model and are deterministic for identical source artifacts. Report generation atomically replaces only those two files.
27. `recommendation.yml` is versioned output with `routing_applied: false`; it does not modify AgentWorkbench routing and contains no weighted score or single-variable causal claim.
28. The committed demo is a sanitized bounded two-candidate Sol Low proof. It preserves substantive evidence and accepted findings while omitting raw transcripts, executable details, worktrees, credentials, account data, and machine-local paths.
29. Phase 4 preserves all six accepted Phase 3 ordinal criteria in its typed model and static outputs; it validates exact opaque-label coverage, criterion keys, and ordinal values before rendering.
30. Recorded manifest completion states and judge execution classifications are presentation evidence, not a replacement for the accepted controller outcome. A sanitized demo labels historical classifications explicitly when retained.
31. `sample-metadata.json` is an optional strict, versioned marker for a sanitized derivative. It declares the source-run evidence-completeness scope and intentional omissions; ordinary finalized reports have no sample notice.
32. `arena calibrate` is the canonical one-command workflow. Existing stage commands remain available, and calibration preserves their authority and artifacts.
33. Comparison topology is structural analysis over allowlisted complete-configuration dimensions, not statistical causal inference.
34. Decision lenses are informational presentation facts only. They never score, rerank, or override `evaluation.json`.
35. `arena verify` is read-only: it validates finalized authority and detects stale derived outputs without invoking adapters, validation commands, or network calls.
36. Trial templates contain no credentials, executable overrides, or machine-local paths. The public demo remains a clearly labelled bounded proof until Phase 5 replaces it with a final stabilization run.
37. Phase 4.5 adds no GUI, server, database, new adapter, judge profile, weighted scoring, or automatic routing.
38. Judge-response structural diagnostics are identity-safe local evidence; external safety errors remain generic, one structural repair remains the maximum, and a `RECOMMENDATION` requires unique sequential lower ranks.
39. Explicit `display_name` and `display_variant` are presentation metadata. Native reasoning effort, native harness variant, and provider route are configuration identity/provenance facts; topology excludes the display fields and uses legacy attention only when explicit native reasoning is absent.
40. DeepSeek compatibility mappings are recorded only for explicit DeepSeek provider routes (`low`/`medium` to `high`, `xhigh` to `max`) with a documented evidence source; Arena never silently translates a harness variant.
41. The concurrency-scheduler fixture and six-candidate template are Phase 5 preparation only. Its canonical acceptance test directory is forbidden to candidates; omitted `acceptance_command` retains the historical fractional-price acceptance validator.
