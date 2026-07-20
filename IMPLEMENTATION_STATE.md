# Implementation State

## Current phase

Phase 1 audit repair — native feasibility evidence is preserved historically; Phase 2 remains unopened.

## Completed work

- Preserved the authoritative roadmap and locked Phase 1 to the six-candidate trial.
- Resolved the legacy add/add conflict with the project-specific versions.
- Added the dependency-free bounded inventory fixture and immutable `phase1-fixture-baseline` tag.
- Added YAML trial validation, generic two-or-more candidate enumeration, isolated sequential Git worktrees, raw evidence, final diffs, timeout handling, and one launch/transport retry policy.
- Added native Codex Exec and OpenCode Run adapters plus `arena doctor` and `arena run`.
- Attempted every configured candidate and preserved inspectable evidence for each; the exact outcome is in `docs/PHASE1-FEASIBILITY-REPORT.md`.

## Audit repair

- Kept the published `phase1-fixture-baseline` ref and the initial feasibility report unchanged.
- Repaired bounded attempt evidence, retry reset hygiene, bounded child-process acceptance validation, non-mutating diff capture, validation-side-effect capture, safe IDs, timeout tree termination, native permissions, and doctor exit status.
- Removed unsupported Phase 1 resume behavior. Added bounded single-candidate native diagnostics and a Windows PR workflow.
- Inspected the prior OpenCode raw streams: they ended after completed tool/step events without a terminal or final event, so the historical timeout is recorded as failure to exit rather than a permission wait.
- Deterministic verification passed, but the fresh Codex Luna Low diagnostic failed with a read-only sandbox permission rejection. Per the gate, OpenCode diagnostic and the fresh six-candidate trial were not run.
- Repaired the Codex adapter to use executable resolution with the existing authenticated Codex CLI environment, optional pass-through access-token authentication, sanitized partial-isolation provenance, and the `arena diagnose` alias. Native diagnostics remain human-only and unrun after this repair.

## Acceptance criteria status

- [x] Fixture, trial schema, generic adapter contract, and two native adapters implemented.
- [x] Candidate count is two-or-more with no product maximum; a seventh candidate is test-proven configuration only.
- [x] All six locked candidates attempted in dynamically generated isolated worktrees.
- [x] Raw events, logs, candidate diffs, pre/post-validation status, validation-side-effect diffs, timings, exit state, validation results, and classifications preserved.
- [x] Native doctor passed: Codex CLI `0.144.0`; OpenCode CLI `1.18.3`.
- [x] `IMPORT_COMPARISON_FALLBACK` declared with exact evidence; fallback mode itself not implemented.

## Commands verified

- `rtk npm run typecheck` — passed.
- `rtk npm run build` — passed.
- `rtk npm test` — passed; child-process acceptance isolation/timeout, fractional final-total rounding, non-mutating evidence, validation side effects, retry reset, diagnostic, and candidate-seven tests passed.
- `rtk npm run fixture:typecheck` — passed.
- `rtk npm run fixture:test` — passed.
- `rtk git diff --check` — passed.
- `rtk npm start -- diagnostic examples/bounded-fix/trial.yml codex-luna-low` — failed; evidence at `runs/bounded-inventory-luna-diagnostic-codex-luna-low-2026-07-20T16-04-26-529Z` records a clean exit with a read-only sandbox permission failure and no write probe.

## Historical blockers

- Native diagnostics remain intentionally unrun after the authentication/isolation repair. The prior Codex read-only result is historical evidence, not confirmation of the repaired configuration.
- OpenCode diagnostic and the fresh six-candidate trial remain unrun because the required Codex diagnostic did not pass.

## Next bounded step

Do not begin Phase 2. `IMPORT_COMPARISON_FALLBACK` remains the Phase 1 outcome until a separately authorized native-configuration repair can pass both diagnostics and a fresh six-candidate trial.
