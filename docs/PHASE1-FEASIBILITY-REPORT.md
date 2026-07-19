# Phase 1 feasibility report

## Result

`IMPORT_COMPARISON_FALLBACK`

Run: `runs/bounded-inventory-luna-2026-07-19T22-07-49-820Z`.

The generic runner attempted all six configured candidates sequentially and preserved an inspectable worktree and full evidence set for each. It did not satisfy `LIVE_MODE`: Codex could not write under the selected non-dangerous permission policy, and OpenCode did not terminate within the shared 180-second timeout.

## Resolved native configuration

- Codex CLI: `0.144.0`; Luna model: `gpt-5.6-luna`; attention is a generic Codex config override, `-c model_reasoning_effort="low|medium|high"`; native command includes `--json`, `--output-last-message`, `--cd`, `--sandbox workspace-write`, `--ignore-user-config`, `--ignore-rules`, and `--strict-config`.
- OpenCode CLI: `1.18.3`; Luna model: `openai/gpt-5.6-luna`; attention syntax: `--variant low|medium|high`; native command includes `run --pure --format json --dir <worktree> --agent build`.
- Bounded diagnostics succeeded before the trial for Codex Low and OpenCode Low. RTK is recorded as Arena build tooling. Codex/OpenCode user configuration is ambient provenance only; no candidate is claimed to have RTK, Ponytail, plugins, skills, or profiles explicitly enabled.

## Candidate results

| Candidate | Result | Duration | Diff | Validation |
| --- | --- | ---: | --- | --- |
| `codex-luna-low` | permission failure, exit 0 | 28,280 ms | empty | both commands passed |
| `codex-luna-medium` | permission failure, exit 0 | 36,509 ms | empty | both commands passed |
| `codex-luna-high` | permission failure, exit 0 | 47,498 ms | empty | both commands passed |
| `opencode-luna-low` | timeout | 180,052 ms | empty | both commands passed |
| `opencode-luna-medium` | timeout | 180,058 ms | empty | both commands passed |
| `opencode-luna-high` | timeout | 180,065 ms | `fixtures/bounded-inventory/src/inventory.ts` | both commands passed |

The OpenCode High diff calculates quantity times fractional price and rounds only the final total, but the process timed out and therefore is not a completed candidate result.

## Evidence and genericity

- Every candidate directory contains `provenance.json`, `raw-events.jsonl`, `stdout.log`, `stderr.log`, `final.diff`, and `execution.json`; final-response files were also preserved where emitted.
- All six worktrees remain at the shared `phase1-fixture-baseline` commit under the run directory above.
- `tests/phase1.test.ts` appends a seventh candidate solely in trial data and verifies generic enumeration. The runner uses an adapter registry; candidate count and adapter count are independent.
- There were eight quota-consuming native executions: two bounded diagnostics and six configured trial attempts. No candidate retry was performed.

## Failure evidence and next start

Codex stderr records writes rejected as read-only by approval settings despite `workspace-write`. OpenCode emitted native JSON events, and High edited the allowed source file, but all three processes required forced timeout classification at the same limit. These are adapter/permission and completion blockers, not unsupported causal conclusions about models or harnesses.

Do not start Phase 2 yet. First verify a non-dangerous Codex write-permission configuration and an OpenCode noninteractive completion path with bounded diagnostics; then run one fresh six-candidate trial, or separately authorize implementation of import fallback.
