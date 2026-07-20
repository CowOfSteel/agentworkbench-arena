# Implementation State

## Current phase

Phase 3 masked semantic-adjudication implementation and deterministic tests are complete, including the final packet-admission, temporary-staging, no-quota preview, identity-policy matcher, and non-Git judge-staging repairs. The Phase 1 native feasibility gate remains `PASS` in `LIVE_MODE`; Phase 2 deterministic evidence remains authoritative. No Sol response has been received during implementation, CI, or the finalized dry-run.

Latest implementation commit before this documentation closeout:
`d7a0046bf590561df9148d02728e78ff7c851693` (`Ignore executable provenance metadata`).

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
- Completed native-evidence intervention semantics: Codex `turn.completed` and OpenCode `step_finish` with `reason: "stop"` establish clean known-zero denial/question counts; truncated and unsupported streams remain unavailable.
- Repaired the Windows CI test command by enumerating built test files explicitly. GitHub Actions run `29772870316` passed on Windows.
- Added Phase 3 finalized-packet validation, stable identity masking, bounded allowlisted judge packets, strict schema validation, one structural repair attempt, and complete adjudication/evaluation artifacts.
- Added a separate read-only, ephemeral Codex Sol judge adapter. Its default is Low reasoning; High is explicit human-only stabilization; higher efforts are rejected. Tests use fake judges only.
- GitHub Actions run `29776242801` passed on Windows for the Phase 3 implementation.
- Repaired the Phase 3 packet audit: new runs now preserve a hash-checked canonical `task-contract.json`; packets reject identity/path leakage, preserve safe relative diff filenames, enforce symmetric limits, and controller-owned evaluation records complete exclusion evidence.
- Strengthened strict judge response and one-repair handling. Fake-judge tests cover recommendation, tie, inconclusive, no-winner, repairs, timeout/launch failures, masking, and bounded packet evidence. GitHub Actions run `29777857463` passed on Windows.
- Repaired final Phase 3 admission and execution gaps: task-contract objective hashes are recomputed against both stored and manifest hashes; live judges stage only masked data in a fresh OS-temporary directory that is removed in `finally`; and dry runs atomically refresh only `phase3-preview/`. Fake-judge tests prove isolation, cleanup after success/failure/timeout, no serialized temporary path, and a later real adjudication after preview. GitHub Actions run `29779163879` passed on Windows.
- Repaired the final identity-policy false positive: strong or high-entropy identities may use substring detection; generic configuration values use contextual or token-aware detection; executable provenance contributes only the executable path, not metadata values such as source labels; and ordinary words such as `allowed`, `build`, and `path` remain valid evidence. GitHub Actions run `29782277331` passed on Windows after this matcher fix.
- The first authenticated Sol Low proof reached the local CLI but exited before a Sol response because the fresh OS-temporary staging directory was not a trusted Git repository. The judge adapter now passes `--skip-git-repo-check`; a fresh copied Low proof remains pending.

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
- [x] Phase 2 audit repairs and Windows GitHub Actions verification completed; its finalized packets are consumed unchanged by Phase 3.
- [x] Phase 3 masked semantic-adjudication implementation and deterministic tests are complete without model-quota use. Failed or unavailable deterministic gates remain ineligible and cannot be overridden.
- [x] The Phase 3 code gate passed, including the final identity-policy matcher fix; Windows CI passed afterward. Phase 4 remains unstarted.
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
- Phase 3 fake-judge packet, masking, repair, no-winner, failure, and dry-run tests - passed; GitHub Actions run `29776242801` passed.
- Phase 3 task-contract, identity/path rejection, relative diff, budget, strict-response, evaluation, and repair tests - passed; GitHub Actions run `29777857463` passed.
- Phase 3 external temporary staging, inspectable dry-run preview, and recomputed task-contract integrity tests - passed; GitHub Actions run `29779163879` passed.
- Real finalized Phase 2 dry-run passed against `runs/phase3-sol-low-proof-2026-07-20T21-28-41-523Z`: `packet_valid: true`, opaque labels `A` and `B`, Low reasoning, packet size `6047` within the `32192` limit, and preview contents limited to `masked-judge-input.json`, `judge-output-schema.json`, and `dry-run.json`; no Sol invocation occurred.
- One authenticated Sol Low proof remains as the final manual Phase 3 gate. Sol High remains reserved for final end-to-end stabilization.

## Historical evidence

- The prior Codex read-only diagnostic failure and prior OpenCode timeout evidence remain preserved in their original run directories and in `docs/PHASE1-FEASIBILITY-REPORT.md`.
- Those failed-run records are historical evidence and do not describe the final Phase 1 gate result.

## Next bounded step

Human-only bounded verification remains: run the authenticated Sol Low proof against the copied finalized run. Sol High is reserved for final end-to-end stabilization, and Phase 4 has not started.
