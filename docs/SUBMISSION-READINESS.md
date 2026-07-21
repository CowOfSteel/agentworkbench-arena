# Submission readiness

| Item | Status | Evidence or remaining action |
| --- | --- | --- |
| Track: Developer Tools | READY | Arena is a repository-specific developer configuration-calibration tool. |
| Primary `/feedback` Session ID | READY | `019f80f2-5a79-7ff1-b3ac-24ccbeaf44a4` is recorded in the development provenance. |
| Windows install and judge path | READY | `npm run verify:clean` proves clean install, tests, demo, package, and built/installed CLI paths. |
| License and notices | READY | MIT project license plus third-party notices are present. |
| Sanitized fallback demo | READY | `examples/demo-run` verifies without native credentials or model calls. |
| Six-route diagnostic proof | READY | PR #7 records one final shared-contract pass for all six configurations. |
| Final flagship candidate run | PENDING_HUMAN | Run once through the final runbook. |
| Final Sol High adjudication | PENDING_HUMAN | Validate the masked dry-run packet, then invoke High once. |
| Repository access | PENDING_HUMAN | Repository is private; make it public or grant durable judge access. |
| GitHub Pages | PENDING_HUMAN | Enable GitHub Actions Pages after the final sample is merged. |
| Submission video | PENDING_HUMAN | Record and upload after the final report is available. |
| Devpost | PENDING_HUMAN | Complete and submit the form after access, report, and video are ready. |

Run `npm run submission:preflight` before the flagship sequence and again before publication. A failed preflight or unsafe public artifact changes the relevant item to `BLOCKED` until repaired.

The current two-candidate sanitized demo remains a valid fallback if the flagship run cannot be completed before the deadline.
