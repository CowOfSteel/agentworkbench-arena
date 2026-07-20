# Implementation State

## Current phase

Phase 2 deterministic telemetry is complete. The Phase 1 native feasibility gate remains `PASS` in `LIVE_MODE`; Phase 3 adjudication has not started.

Latest implementation commit before this documentation closeout:
`a651ee5ae75309cd1fbd069ddace403aadde74f6`.

## Completed work

- Preserved the authoritative roadmap and locked Phase 1 to the six-candidate trial.
- Resolved the legacy add/add conflict with the project-specific versions.
- Added the dependency-free bounded inventory fixture and immutable `phase1-fixture-baseline` tag.
- Added YAML trial validation, generic two-or-more candidate enumeration, isolated sequential Git worktrees, raw evidence, final diffs, timeout handling, and one launch/transport retry policy.
- Added native Codex Exec and OpenCode Run adapters plus `arena doctor`, `arena diagnose`, and `arena run`.
- Attempted all six configured candidates through the reusable adapter registry and preserved inspectable evidence for each.
- The fresh six-candidate run completed normally at `runs/bounded-inventory-luna-2026-07-20T18-47-49-086Z`.

## Audit repair

- Kept the published `phase1-fixture-baseline` ref and the initial feasibility report unchanged.
- Repaired bounded attempt evidence, retry reset hygiene, bounded child-process acceptance validation, non-mutating diff capture, validation-side-effect capture, safe IDs, timeout tree termination, native permissions, and doctor exit status.
- Removed unsupported Phase 1 resume behavior. Added bounded single-candidate native diagnostics and a Windows PR workflow.
- Inspected the prior OpenCode raw streams: they ended after completed tool/step events without a terminal or final event, so the historical timeout remains recorded as failure to exit rather than a permission wait.
- Both bounded native diagnostics passed: Codex Luna Low and OpenCode Luna Low each wrote the probe, terminated cleanly, made no forbidden changes, and had no validation side effects.
- Native Codex execution uses explicit executable resolution, the existing authenticated CLI state, `workspace-write`, and `approval_policy="never"`.
- Native Codex execution uses no strict or ignore flags and no dangerous approval or sandbox bypass.
- Codex configuration isolation is partial and is recorded honestly: ambient instructions and plugins may be detected, while no candidate claims explicit RTK, Ponytail, plugin, skill, or profile enablement.
- Added schema-versioned `telemetry.json`, source-native `raw-telemetry.json`, canonical `validation.json`, explicit hard gates, evidence-completeness finalization, deterministic change analysis, and run-level `manifest.json`.
- Added monotonic duration boundaries for candidate attempts, retry overhead, independent validation, candidate pipeline work, and full-run finalization.
- Added deterministic configuration hashes and sanitized normalized trial snapshots; no native candidate trial was rerun for Phase 2 implementation.
- Repaired PR #2 audit findings: failed hard gates now take precedence over unavailable gates; dependency version/source/section and lockfile changes are explicit; native counters no longer invent zero; intervention gates require evidence; and manifest readiness validates deterministic packets.
- Repaired the Windows CI test command by enumerating built test files explicitly. GitHub Actions run `29772870316` passed on Windows.

## Acceptance criteria status

- [x] Fixture, trial schema, generic adapter contract, and two native adapters implemented.
- [x] Candidate count is two-or-more with no product maximum; a seventh candidate is test-proven configuration only.
- [x] All six locked candidates attempted in dynamically generated isolated worktrees.
- [x] All six configured candidates attempted through reusable Codex and OpenCode adapters in a fresh run that completed normally.
- [x] Raw events, logs, candidate diffs, pre/post-validation status, validation-side-effect diffs, timings, exit state, validation results, and classifications preserved.
- [x] Native diagnostics passed for Codex Luna Low and OpenCode Luna Low.
- [x] Fresh six-candidate feasibility run completed at `runs/bounded-inventory-luna-2026-07-20T18-47-49-086Z`.
- [x] Phase 1 feasibility gate passed in `LIVE_MODE`.
- [x] Phase 2 deterministic normalized/raw telemetry, validation, change facts, hard gates, evidence completeness, and manifest implemented and tested with fake adapters and temporary Git repositories.
- [x] Phase 2 audit repairs and Windows GitHub Actions verification completed; Phase 3 is ready for a separate audit but has not started.
- [x] `IMPORT_COMPARISON_FALLBACK` remains a documented contingency only; it is not the active mode and is not implemented.

## Commands and evidence verified

- `rtk npm run typecheck` - passed.
- `rtk npm run build` - passed.
- `rtk npm test` - passed; child-process acceptance isolation/timeout, fractional final-total rounding, non-mutating evidence, validation side effects, retry reset, diagnostic, and candidate-seven tests passed.
- `rtk npm run fixture:typecheck` - passed.
- `rtk npm run fixture:test` - passed.
- `rtk npm start -- diagnostic examples/bounded-fix/trial.yml codex-luna-low` - passed; evidence at `runs/bounded-inventory-luna-diagnostic-codex-luna-low-2026-07-20T17-41-10-970Z`.
- `rtk npm start -- diagnostic examples/bounded-fix/trial.yml opencode-luna-low` - passed; evidence at `runs/bounded-inventory-luna-diagnostic-opencode-luna-low-2026-07-20T17-33-24-175Z`.
- Fresh six-candidate run - completed normally; evidence at `runs/bounded-inventory-luna-2026-07-20T18-47-49-086Z`.
- GitHub Actions - passed.
- Codex Luna Low native diagnostic - passed.
- OpenCode Luna Low native diagnostic - passed.

## Historical evidence

- The prior Codex read-only diagnostic failure and prior OpenCode timeout evidence remain preserved in their original run directories and in `docs/PHASE1-FEASIBILITY-REPORT.md`.
- Those failed-run records are historical evidence and do not describe the final Phase 1 gate result.

## Next bounded step

Phase 3 readiness audit only: verify this deterministic factual layer and, if accepted, begin identity-masked GPT adjudication without changing hard-gate precedence. `IMPORT_COMPARISON_FALLBACK` remains a documented contingency if a later native feasibility issue requires it.
