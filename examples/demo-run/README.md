# Bounded Phase 4 demo

This sanitized bundle comes from the successful authenticated Sol Low retry-2 proof. It preserves the two candidate configurations, deterministic evidence, accepted semantic findings, and resulting recommendation.

The bundle intentionally omits raw events, raw logs, worktrees, executable locations and arguments, account/session data, private transcripts, and unrelated Phase 1–3 artifacts. `judge-result.json` retains only completion and timing facts; the accepted response is preserved in `adjudication.json` and `evaluation.json`.

Run `npm run demo` from the repository root to regenerate `report.html` and `recommendation.yml` without credentials or network access. This is a bounded two-candidate proof; larger candidate arrays are covered by deterministic tests.
