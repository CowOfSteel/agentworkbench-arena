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
- Repaired bounded attempt evidence, resume loading, redaction, safe IDs, timeout tree termination, native permissions, doctor exit status, and independent fractional-price acceptance validation.
- Inspected the prior OpenCode raw streams: they ended after completed tool/step events without a terminal or final event, so the historical timeout is recorded as failure to exit rather than a permission wait.
- The initial live trial remains the six Luna Low/Medium/High configurations through Codex and OpenCode; no six-candidate rerun is authorized in this repair.

## Acceptance criteria status

- [x] Fixture, trial schema, generic adapter contract, and two native adapters implemented.
- [x] Candidate count is two-or-more with no product maximum; a seventh candidate is test-proven configuration only.
- [x] All six locked candidates attempted in dynamically generated isolated worktrees.
- [x] Raw events, logs, final diffs, timings, exit state, validation results, and classifications preserved.
- [x] Native doctor passed: Codex CLI `0.144.0`; OpenCode CLI `1.18.3`.
- [x] `IMPORT_COMPARISON_FALLBACK` declared with exact evidence; fallback mode itself not implemented.

## Commands verified

- `rtk npm install` — passed; YAML parser installed with no vulnerabilities.
- `rtk npm run typecheck` — passed.
- `rtk npm run build` — passed.
- `rtk npm test` — passed; CLI, schema, native argument shape, generic worktree evidence, timeout classification, and candidate-seven tests passed.
- `rtk npm run fixture:typecheck` — passed.
- `rtk npm run fixture:test` — passed.
- `rtk npm start -- doctor examples/bounded-fix/trial.yml` — both adapters passed.
- `rtk npm start -- run examples/bounded-fix/trial.yml` — all six candidates attempted; evidence preserved.

## Historical blockers

- Codex writes were rejected as read-only by noninteractive approval settings despite `workspace-write`.
- OpenCode Low, Medium, and High each reached the shared 180-second timeout; High edited the allowed source file but did not terminate.

## Next bounded step

Do not begin Phase 2. Complete deterministic verification, then run only one fresh Codex Luna Low diagnostic and one fresh OpenCode Luna Low diagnostic. Do not run Medium, High, or the complete six-candidate trial.
