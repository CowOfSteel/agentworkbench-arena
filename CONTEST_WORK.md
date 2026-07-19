# Contest Work Process

## Working agreement

- Keep core implementation in one primary Codex conversation.
- Treat the roadmap in `docs/COMPETITION-SPRINT-ROADMAP.md` as authoritative.
- Keep each request bounded to one roadmap phase.
- Maintain `IMPLEMENTATION_STATE.md` after each bounded milestone.
- Record verified commands and exact blockers instead of implying completion.
- Inspect the Git diff before each coherent milestone commit.
- Never push from this workflow.

## Phase 0 gate

Phase 0 is complete when the scaffold builds, the built-in test passes, the requested documentation contains the locked decisions, the roadmap remains present, and no Phase 1 behavior has been implemented.

## Phase 1 handoff

The next bounded step is the locked six-candidate feasibility spike: create one deterministic fixture, define the minimal candidate-adapter interface, and prove that Luna Low, Medium, and High through both Codex and OpenCode can execute the same contract in separate worktrees with raw output, process status, timing, and final diffs collected. Adding a seventh candidate must be trial configuration only.

Do not begin judging, telemetry normalization, HTML reports, routing, plugins, or AgentWorkbench integration during that spike.
