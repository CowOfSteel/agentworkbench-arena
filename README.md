# AgentWorkbench Arena

Public coding-agent leaderboards cannot tell you which complete configuration works best on your repository.

AgentWorkbench Arena runs the same task through multiple native Codex and OpenCode configurations, validates each result, compares operational telemetry, uses identity-masked GPT-5.6 adjudication, and produces a practical, non-operative recommendation.

**Sample report:** [open the committed sanitized report](examples/demo-run/report.html). The expected Pages URL is <https://cowofsteel.github.io/agentworkbench-arena/>; publication through GitHub Pages is an enablement step and is not claimed live here.

## Try it without credentials

```powershell
git clone https://github.com/CowOfSteel/agentworkbench-arena.git arena
cd arena
npm ci
npm run demo
Start-Process ".\examples\demo-run\report.html"
```

The demo is a sanitized two-candidate proof. It needs no Codex/OpenCode authentication, provider account, candidate run, or judge invocation.

## What the report tells you

- Which candidates passed deterministic requirements and which were excluded.
- Which eligible implementation the masked semantic adjudication recommended or tied.
- Which eligible candidate executed fastest, changed the least code, or needed fewer retries and interventions.
- Which compatible provider-reported token or cost facts can be compared.
- Which telemetry was unavailable, established as zero, or sourced differently.

## Run Arena on your repository

Follow the [five-minute live guide](docs/QUICKSTART-LIVE.md) for installation, native authentication, trial setup, preview, doctoring, bounded route diagnostics, calibration, and report review. Use the [Phase 5 runbook](docs/PHASE5-RUNBOOK.md) for expensive release-style trials.

## Architecture and trust model

```text
trial.yml
  → isolated sequential candidate worktrees
  → deterministic evidence, validation, and hard gates
  → identity-masked read-only semantic adjudication
  → controller-owned evaluation.json
  → offline static report.html + recommendation.yml
```

Raw evidence and deterministic gates remain authoritative. Semantic adjudication cannot make an ineligible candidate eligible, decision lenses cannot rerank `evaluation.json`, and reports never invoke a candidate or judge adapter.

`arena calibrate` is the canonical one-command workflow. It preserves each stage’s artifacts and produces one final JSON summary. Existing commands remain available for advanced debugging.

## Commands

Repository-local commands use `npm start -- …`. `npm run build`, `npm link`, and then `arena --help` are optional developer conveniences, not a judge requirement. Square brackets in CLI usage mean an optional argument and are not typed literally.

```text
npm install
npm run build
npm test
npm run demo
npm run verify:clean
npm start -- init practical-comparison trial.yml
npm start -- preview trial.yml
npm start -- doctor examples/concurrency-scheduler-phase5.yml
npm start -- verify examples/demo-run
# Human-run only when ready to use native candidates and Sol:
npm start -- calibrate trial.yml --reasoning low
npm start -- doctor examples/bounded-fix/trial.yml
npm start -- diagnose examples/bounded-fix/trial.yml codex-luna-low
npm start -- run examples/bounded-fix/trial.yml
npm start -- report <completed-run-directory>
```

The project uses TypeScript, Node.js, native Git/process capabilities, Node’s built-in test runner, and one YAML parser. It has no web framework, database, dashboard, or plugin framework.

## Codex executable and authentication

Codex resolution uses a candidate `adapter_options.codex_executable`, then `ARENA_CODEX_EXECUTABLE`, then a local `.arena/config.json`, and finally `codex` on `PATH`. Copy [`.arena/config.example.json`](.arena/config.example.json) for a local non-secret executable path; local config is ignored by Git.

Arena uses the existing Codex CLI environment so normal ChatGPT authentication works. Sign in with `codex login` and choose Sign in with ChatGPT when needed; Arena never copies, prints, or records credentials. `CODEX_ACCESS_TOKEN` is an optional advanced authentication mode only: when already supplied by the shell, Arena passes it through and redacts its value from captured evidence. Do not create, reveal, or paste a token for Arena.

```powershell
codex login
```

## Locked product direction

- A trial supports two or more candidates, with no hard-coded candidate count.
- Candidate enumeration is independent of adapter enumeration.
- The first live trial contains six configurations: Luna Low, Luna Medium, and Luna High through Codex, plus the same three levels through OpenCode.
- Complete configurations include harness, provider, model, variant or reasoning level, profile, permissions, skills, tools, and budget. Plugins and tools are part of provenance and configuration identity.
- Raw evidence remains authoritative. The product compares complete configurations and does not make unsupported single-variable causal claims.
- Plugins and tools may have reserved schema concepts later, but Phase 0 does not orchestrate, install, execute, or emit plugin-specific telemetry.

## Deterministic artifacts

Each candidate receives `raw-telemetry.json`, `telemetry.json`, and `validation.json`; every run receives `manifest.json`, `trial-snapshot.json`, and a hash-checked `task-contract.json`. The task contract preserves the safe objective and contract policies needed for Phase 3; historical runs without it remain valid Phase 2 evidence but cannot be adjudicated. Raw events remain authoritative. `telemetry.json` uses `{ value, availability, source }`: unavailable data is `null`, while zero is emitted only when Arena establishes it.

Candidate process duration is measured with a monotonic clock across all attempts. Validation duration is measured separately and never attributed to candidate execution. The manifest measures the full Arena pipeline through finalization. Native timing and usage remain source-native facts in `raw-telemetry.json`.

Trials must declare `validation_timeout_ms` and `dependency_policy`. `no_changes` rejects semantic npm dependency additions/removals; package and lockfile changes remain separate deterministic facts. All validation commands use argument arrays, a bounded timeout, and portable worktree paths.

The ten hard gates are explicit in each `telemetry.json`; an unavailable gate cannot pass, and no future adjudicator may override a failed gate. Artifact completeness is finalized after telemetry generation so its self-check is deterministic.

## Phase 3 adjudication

`arena adjudicate <run-directory> --dry-run` validates a finalized packet, constructs no candidate worktrees, uses no model quota, and atomically refreshes the inspectable `<run-directory>/phase3-preview/` cache. That cache contains only `masked-judge-input.json`, `judge-output-schema.json`, and `dry-run.json`; it creates neither an identity map nor adjudication/evaluation artifacts. A real adjudication uses one fresh OS-temporary staging directory outside the run tree, read-only ephemeral Codex execution, and `approval_policy="never"`; the staging directory is deleted after the original and optional single repair call. It defaults to `gpt-5.6-sol` at Low reasoning. `--reasoning high` is reserved for an explicit human final-stabilization run; efforts above High are rejected. The judge sees only labels and a bounded allowlisted packet: real identities, provenance, configuration hashes, machine paths, and unsafe validation output are rejected. It writes masked input, execution/repair evidence, and `evaluation.json`, never a Phase 4 report or `recommendation.yml`.

## Phase 4 static report

`arena report <run-directory>` validates a completed Phase 2/3 artifact set and atomically regenerates only `report.html` and `recommendation.yml`. Reporting is presentation-only: `evaluation.json` controls outcome, eligibility, and order; Phase 2 artifacts control deterministic facts; and accepted Phase 3 artifacts control semantic findings. The report preserves all six accepted ordinal criteria, source execution statuses as evidence limitations, full availability-aware telemetry, and horizontally scrollable comparison matrices. The command invokes no candidate or judge adapter.

The HTML report is self-contained with inline CSS and portable evidence links. The versioned YAML recommendation is non-operative (`routing_applied: false`) and does not modify AgentWorkbench routing. Unknown metrics remain explicit as `Not reported`, established zero remains `0`, and candidate execution, independent validation, and full-pipeline time remain separate. Normalized telemetry is primarily per candidate run; candidate duration includes harness/tool activity and is not provider API request latency.

`npm run demo` regenerates the sanitized bounded proof under `examples/demo-run/` without authentication or network access. Its versioned `sample-metadata.json` labels it as a sanitized derivative whose completeness pertains to the source run; it omits raw logs, worktrees, executable details, private transcripts, and account/session data while preserving the real Low-proof recommendation and any historical source-execution classification as non-authoritative evidence.

## Phase 4.5 product experience

`arena init` writes three commented, schema-valid templates without credentials or machine-local paths. `arena preview` runs no candidates, judge, validation command, network call, or model; it explains execution order, explicit policy, structural topology, unresolved placeholders, and upper-bound process/validation budgets. `arena verify` is read-only: it validates authority/path confinement and confirms the current HTML and YAML exactly match their source artifacts.

The report’s topology is structural analysis, not statistical causal inference. Its decision lenses (controller outcome, candidate speed, smallest change, interventions, retries, compatible costs/tokens, and telemetry coverage) are informational only and never override `evaluation.json`. Every candidate gets deterministic why/why-not placement evidence, and the coverage matrix preserves established zero versus unavailable metrics.

The committed bounded two-candidate proof is also the public sample path. After merge, enable **Settings → Pages → GitHub Actions** in GitHub; the workflow deploys only sanitized allowlisted evidence from `examples/demo-run/`, never pull-request artifacts. Phase 5 may replace this proof with a final six-candidate stabilization sample. See [Phase 4.5 product experience](docs/PHASE4_5-PRODUCT-EXPERIENCE.md).

## Phase boundaries

## Phase 5 trial preparation (not executed)

[`examples/concurrency-scheduler-phase5.yml`](examples/concurrency-scheduler-phase5.yml) is a deliberately blocked six-candidate stabilization template for the dependency-free [`fixtures/concurrency-scheduler/`](fixtures/concurrency-scheduler/) task. It uses explicit display metadata, provider route, native reasoning effort, and OpenCode native variant fields. `attention` remains legacy normalized data; new trials should prefer the explicit native fields.

PR #7 merged at `19d4726f40ec971cc3105912ee79fe900496338d` after all six exact configurations passed the final shared bounded diagnostic contract. That proves route readiness only; the flagship comparison and Sol High adjudication have not been run.

OpenAI GPT-5.6 native efforts are `none`, `low`, `medium`, `high`, `xhigh`, and `max`. DeepSeek V4 efforts are `high` and `max`; for the explicit DeepSeek routes Arena records `low`/`medium` → `high` and `xhigh` → `max` as documented compatibility, rather than changing a harness argument. It records requested harness variant, effective provider effort, and evidence source separately.

Before a human runs this template, resolve each `REPLACE_*` value and record installed Codex/OpenCode versions; `codex exec --help`; `opencode run --help`; `opencode models`; a credential-safe provider-configuration inspection; one bounded doctor/diagnostic per unique route; and a dry-run/argument-shape proof for every native effort. The frozen scheduler fixture baseline is `8dda0e4068a8b7fb27793cfbab6947076ec24e7f`; create its immutable tag only after human confirmation:

```text
git tag -a phase5-concurrency-scheduler-baseline -m "Phase 5 scheduler baseline" 8dda0e4068a8b7fb27793cfbab6947076ec24e7f
git push origin phase5-concurrency-scheduler-baseline
```

## Phase 5 reproducibility and stabilization

`npm run verify:clean` creates and removes an isolated Git worktree, proves the offline build/demo/report path, and smoke-tests the installed `arena` bin. `npm run scheduler:baseline-contract` compiles the fixture and proves the intentional baseline failure through the exact canonical `node:test` inventory, bounded TAP output, and expected behavioral assertions; it rejects launch, syntax, module-resolution, timeout, and unexpected-pass failures.

`arena doctor <trial.yml>` reports adapter, per-candidate, and provider-route readiness without invoking a coding model. It rejects unresolved placeholders and unsafe OpenCode inline configuration composition. A declared OpenCode variant is `declared_unverified` until a bounded diagnostic proves provider acceptance. `arena sanitize-sample <verified-run> <output>` creates a field-allowlisted, scanned derivative without changing the verified source run.

Diagnostics use `diagnostic_timeout_ms` when declared (a positive integer no greater than both 900,000 ms and `timeout_ms`); otherwise Arena uses the smaller of the candidate timeout and 180,000 ms. The canonical Phase 5 probe intentionally has no terminal newline to avoid editor-style final-newline variance, but matching remains exact UTF-8 bytes: a written probe still fails unless its bytes and every other diagnostic condition match. For the Phase 5 local trial add `diagnostic_timeout_ms: 180000` without committing the local YAML.

See [the Phase 5 runbook](docs/PHASE5-RUNBOOK.md) for offline sample mode, live prerequisites, the exact human-only flagship sequence, privacy limits, Pages enablement, and repository-access checks. See [environment resolution](docs/PHASE5-ENVIRONMENT-RESOLUTION.md) for the nonsecret identifiers established locally.

Phase 1 contains the fixture, YAML trial schema, Codex and OpenCode native adapters, sequential worktree runner, and raw evidence preservation. Candidate count is configuration data: the first trial has six candidates, while adding a seventh changes only the trial file.

Phase 3 adds identity-masked adjudication artifacts and `evaluation.json`. Phase 4 presents those finalized artifacts as static HTML and non-operative YAML. Phase 4.5 adds no new authority; it adds workflow and presentation-only product experience. These phases add no dashboards, import fallback, plugin orchestration, controlled tool comparisons, parallel execution, additional candidate adapters, automatic routing, or AgentWorkbench v1 integration.

See [`docs/COMPETITION-SPRINT-ROADMAP.md`](docs/COMPETITION-SPRINT-ROADMAP.md) for the authoritative roadmap, [`SCOPE.md`](SCOPE.md) for boundaries, [`DECISIONS.md`](DECISIONS.md) for locked decisions, [`IMPLEMENTATION_STATE.md`](IMPLEMENTATION_STATE.md) for current status, and [Codex development provenance](docs/CODEX-DEVELOPMENT.md) for the documented contest record.

## Collaboration and provenance

Core implementation remains in one primary Codex conversation. The human owns the product problem, scope, acceptance contract, and evaluation policy; Codex implements the bounded repository work. Arena remains separate from AgentWorkbench v1 until a later migration decision.

## License

MIT. See [`LICENSE`](LICENSE).
