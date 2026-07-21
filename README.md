# AgentWorkbench Arena

Public coding-agent leaderboards cannot tell you which complete configuration works best on your repository.

AgentWorkbench Arena runs one repository task through multiple native coding-agent configurations, validates what each actually accomplished, compares operational evidence, uses identity-masked GPT-5.6 semantic adjudication, and produces an actionable but non-operative recommendation.

AgentWorkbench orchestrates specialized agents. Arena is how candidate configurations earn their assignments. It is also useful to developers and engineering teams evaluating their own model, harness, provider, reasoning, permission, and tool configurations.

Arena brings native configuration execution, user-owned repository tasks, deterministic gates, normalized operational telemetry, identity-masked GPT-5.6 adjudication, and actionable recommendations into one local calibration workflow.

## See the result first

- The public sample is live at <https://cowofsteel.github.io/agentworkbench-arena/>; the local report remains the offline path.
- The committed two-candidate sample is a complete, verified fallback. It requires no native credentials and remains the safe public sample because the flagship sanitizer rejected unsafe source material. It is to highlight the different harnesses being used.

The final human-controlled six-configuration trial completed successfully. Three candidates passed deterministic hard gates, and GPT-5.6 Sol High recommended Terra High through Codex with high confidence. The flagship source report remains private because the sanitizer rejected an absolute-path or sensitive-source condition; the repository therefore retains the independently verified sanitized proof as its safe zero-credential public demo. Still some kinks on that end to work out, as I do believe the Sol adjudication was simply "taking too long" for my time outs, and the deadline submission was coming up.

## Zero-credential judge path

```powershell
git clone https://github.com/CowOfSteel/agentworkbench-arena.git arena
cd arena
npm ci
npm run demo
Start-Process ".\examples\demo-run\report.html"
npm start -- verify examples/demo-run
```

No Codex or OpenCode credentials are required. No candidate or judge runs, and no network is required after installation dependencies are present. The report is self-contained; `verify` proves its HTML and YAML still match the sanitized source artifacts.

## What the report tells you

- Which candidates passed deterministic requirements and which were excluded.
- Which eligible candidate was recommended, tied, or left inconclusive by masked semantic adjudication.
- Candidate execution, validation, retries, intervention, code-change, token, and cost evidence when available.
- Whether operational comparisons are compatible; individual harness values remain visible even when they are not cross-candidate comparable.
- Why each candidate was placed, excluded, recommended, or tied.

Decision lenses are informational. They do not score, rerank, or override `evaluation.json`.

## Product workflow

```text
trial.yml
  → sequential isolated candidate worktrees
  → deterministic evidence, validation, and hard gates
  → identity-masked read-only GPT-5.6 adjudication
  → controller-owned evaluation.json
  → static report.html + non-operative recommendation.yml
```

`arena calibrate` is the one-command workflow. For expensive runs, use the stage commands so later adjudication or reporting work cannot rerun candidates.

## Run Arena on your repository

Start with the [five-minute live quickstart](docs/QUICKSTART-LIVE.md). The full human-controlled stabilization sequence is in the [final flagship runbook](docs/FINAL-FLAGSHIP-RUNBOOK.md).

```powershell
npm start -- init practical-comparison trial.yml
npm start -- preview trial.yml
npm start -- doctor trial.yml
npm start -- calibrate trial.yml --reasoning low
```

Repository-local `npm start -- …` commands are the judge path. `npm run build`, `npm link`, and `arena --help` are optional developer conveniences. Square brackets in CLI usage mean optional arguments; do not type them literally.

## Supported platform and prerequisites

- **Tested:** Windows, Node.js 20 or newer, and Git.
- **Live candidates:** the native Codex CLI and/or OpenCode, installed and authenticated for the configured provider routes.
- **Potentially portable:** other Node/Git platforms, but live calibration there is not verified.

Arena uses existing native-client authentication. Never place credentials, tokens, provider configuration, or machine-local executable paths in a tracked trial.

## Architecture and trust

Raw evidence and deterministic hard gates remain authoritative. GPT-5.6 cannot make an ineligible candidate eligible. Reporting invokes no candidate or judge adapter. `recommendation.yml` has `routing_applied: false` and changes no AgentWorkbench configuration.

Arena compares complete configurations. When several dimensions vary, it does not claim that one model, harness, provider, effort level, profile, permission, or tool caused the result. See [Architecture and trust](docs/ARCHITECTURE-AND-TRUST.md).

## Telemetry and efficiency semantics

Arena’s normalized telemetry is primarily per candidate run. Candidate execution time includes harness and tool activity and is not provider API request latency. Input/output tokens and provider cost are shown only when the native harness reports them. Missing values remain **Not reported**, not zero.

```text
Candidate execution: 92 seconds
Input tokens: 18,400
Output tokens: 2,300
Reported harness turns: 4
Tool calls: 12
```

Four reported harness turns do not necessarily mean four provider API requests. Candidate execution, independent validation, and total Arena pipeline duration remain separate. Provider-reported cost, estimated cost, subscription consumption, and quota remain distinct facts.

## Codex, GPT-5.6, and human decisions

Codex implemented and repaired the repository scaffold, trial schema, native adapters, isolated runner, deterministic validation and telemetry, hard gates, masked judge controller, report, sanitation, diagnostics, Windows support, and verification tooling.

GPT-5.6 candidate configurations may be evaluated through native harnesses. GPT-5.6 Sol is the identity-masked semantic adjudicator; deterministic eligibility remains controller-owned. Sol Low is the normal proof path; the final human-controlled Sol High adjudication completed successfully.

The human identified the product problem, chose complete-configuration comparison, defined the AgentWorkbench use, required multi-candidate evidence and deterministic gates, controlled fairness and scope, chose identity masking and a static report, rejected semantic gate overrides and a weighted mega-score, and reserved final native/Sol High execution for human control.

During development, Codex used RTK to improve command execution and repository inspection efficiency while preserving authoritative evidence where required. Ponytail supplied structured development-workflow guidance for bounded implementation and publication tasks. Neither RTK nor Ponytail is required to install or run Arena, neither participates in candidate evaluation, and neither influences deterministic gates, semantic adjudication, or final recommendations.

See [Codex development provenance](docs/CODEX-DEVELOPMENT.md) and [development history](docs/DEVELOPMENT-HISTORY.md).

## Testing and release verification

```powershell
npm run typecheck
npm run build
npm test
npm run fixture:typecheck
npm run fixture:test
npm run scheduler:typecheck
npm run scheduler:test
npm run scheduler:baseline-contract
npm run verify:clean
npm run submission:preflight
```

`submission:preflight` is bounded, offline after installed dependencies, and invokes no candidate or judge. It checks the clean install/package path, sanitized demo, Pages staging, public documentation, links, tracked and reachable-history risk patterns, and release status.

## Limitations and nonclaims

- Live calibration has been tested only on Windows.
- Native provider availability, model catalogs, accounting, and quota depend on the installed clients and user accounts.
- One trial does not establish broad statistical causality or historical performance.
- Telemetry coverage differs by harness and is not a quality score.
- Arena does not automatically route AgentWorkbench work, operate a server, or maintain a historical database.
- The committed sample is a sanitized bounded proof, not the private six-candidate flagship result rejected by the public-artifact sanitizer.

## AgentWorkbench direction

Arena is intended to become AgentWorkbench’s configuration-calibration subsystem. Future work may add configurable judge profiles, streamlined harness/provider adapters, plugin and tool comparisons, repeated-task calibration, and optional routing recommendations informed by accumulated trials.

**Arena measures and recommends. AgentWorkbench operationalizes.**

## Submission and provenance

- Primary project `/feedback` Session ID: `019f80f2-5a79-7ff1-b3ac-24ccbeaf44a4`.
- [Submission readiness](docs/SUBMISSION-READINESS.md)
- [Final flagship runbook](docs/FINAL-FLAGSHIP-RUNBOOK.md)
- [Development history](docs/DEVELOPMENT-HISTORY.md)
- [Codex development provenance](docs/CODEX-DEVELOPMENT.md)

## License and third-party software

AgentWorkbench Arena is MIT licensed. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
