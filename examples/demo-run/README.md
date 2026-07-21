# Bounded Phase 4 demo

This sanitized derivative bundle comes from the successful authenticated Sol Low retry-2 proof. It preserves the two candidate configurations, deterministic evidence, accepted semantic findings, and resulting recommendation. `sample-metadata.json` records its source-run completeness scope and intentional omissions.

The bundle intentionally omits raw events, raw logs, worktrees, executable locations and arguments, account/session data, private transcripts, and unrelated Phase 1–3 artifacts. `judge-result.json` retains only completion and timing facts; the accepted response is preserved in `adjudication.json` and `evaluation.json`. Historical source execution classifications are retained as evidence and do not supersede the accepted controller outcome.

Run `npm run demo` from the repository root to regenerate `report.html` and `recommendation.yml` without credentials or network access. `npm start -- verify examples/demo-run` confirms the report outputs still exactly match the finalized evidence. This is a bounded two-candidate proof; larger candidate arrays are covered by deterministic tests.

After merge, GitHub Pages can publish this same sanitized allowlisted sample through **Settings → Pages → GitHub Actions** at <https://cowofsteel.github.io/agentworkbench-arena/>. It is not a fabricated six-candidate result; Phase 5 may replace it with a final stabilization sample.
