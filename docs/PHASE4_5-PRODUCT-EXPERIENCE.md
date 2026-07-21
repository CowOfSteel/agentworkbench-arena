# Phase 4.5 product experience

Phase 4.5 is a bounded developer-product supplement to the completed Phase 1–4 evidence, adjudication, and report pipeline. It adds no new deterministic or semantic authority.

## Workflow

`arena calibrate <trial.yml> [--reasoning low|high]` is the canonical complete workflow: it runs the existing sequential trial runner, the existing read-only masked judge controller, and the existing static report generator exactly once each. Low is the default; High remains an explicit human stabilization choice. Existing stage commands remain available for diagnosis and advanced debugging.

`arena init` creates schema-valid, commented safe templates. `arena preview` is offline and reports upper-bound—not predicted—candidate and validation budgets. `arena verify` is read-only: it validates finalized source authority, renders expected report outputs in memory, and detects stale or tampered derived files.

## Structural comparison, not causation

Topology describes only the allowlisted complete-configuration dimensions: adapter, harness, provider, provider route, model, legacy attention, explicit native reasoning effort, native variant, agent, profile, permission policy, and declared tools/plugins. Friendly display labels are excluded. A controlled sweep is reported only when all other known dimensions are equal. It is structural analysis, never statistical or causal inference. Decision lenses are equally informational: they do not score, rerank, or override `evaluation.json`.

## Presentation additions

The report and recommendation show topology, non-authoritative decision lenses, deterministic why/why-not placement summaries, and a normalized telemetry-coverage matrix. Unavailable telemetry remains unavailable; established zero remains `0`. Candidate execution speed uses only candidate `wall_clock_ms`, never validation or total pipeline duration.

## Public sample

`examples/demo-run/` remains a clearly labelled, sanitized two-candidate Sol Low proof. The Pages workflow prepares only this allowlisted sample on pushes to `main` or manual dispatch; it does not run on pull requests. After merge, enable **Settings → Pages → GitHub Actions**. The expected address is <https://cowofsteel.github.io/agentworkbench-arena/>. Phase 5 may replace the sample with a final six-candidate stabilization run.

Phase 4.5 adds no GUI, server, database, adapter, judge profile, weighted score, automatic routing, Phase 5 hardening, or Phase 6 packaging.

## Final repair and Phase 5 preparation

Judge responses have a candidate-count-aware ceiling of `min(32000, 4000 + 2000 × opaque label count)`. Strict response failures retain identity-safe diagnostics (code, JSON path, expected structure, observed category, and character count); a repair receives those diagnostics only when its malformed original is safe to reuse. A recommendation has one rank-1 winner and unique sequential lower ranks; only a tie can share rank 1. One repair remains the maximum.

The prepared scheduler fixture and six-candidate template are not a Phase 5 execution. The template remains intentionally blocked by provider/model/variant and baseline placeholders. Its canonical acceptance command is separate from candidate-editable tests, and optional `acceptance_command` support preserves the historical fractional-price validator when omitted.

## Human closeout proof

The final bounded six-candidate Low adjudication completed successfully. `codex-luna-high` was recommended; eligible candidates ranked `codex-luna-high`, `opencode-luna-high`, and `opencode-luna-medium`, while the remaining candidates were excluded by deterministic allowed-path gates. Report generation passed and `arena verify` returned `VERIFIED`. The original malformed response used duplicate lower ranks (`1,2,2`); the single structural repair produced unique sequential ranks (`1,2,3`). Windows CI run `29805328842` passed. PR #5 merged at `c9baa1fa22331325f5bdd17aa87c7224eca0af3f`; Sol High remains unexecuted while Phase 5 reproducibility stabilization proceeds separately.
