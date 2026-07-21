# Five-minute live run

This guide is for developers who already have Codex and/or OpenCode access. For an expensive stabilization run, use the more conservative [Phase 5 runbook](PHASE5-RUNBOOK.md) and its stage-specific commands.

## What Arena uses

Arena invokes the native Codex and OpenCode clients. It does not proxy or resell model access, ask for credentials in trial YAML, or store or print credential values. It uses authentication already configured in each client. Available providers, models, and variants therefore depend on your subscriptions, API access, and locally visible model catalog.

## 1. Clone into a short Windows path

```powershell
cd C:\
git clone https://github.com/CowOfSteel/agentworkbench-arena.git arena
cd C:\arena
git config --global core.longpaths true
```

Arena creates isolated Git worktrees, so a short repository path helps avoid deep Windows paths. If the repository must remain elsewhere, `subst` is an optional fallback:

```powershell
subst R: C:\path\to\agentworkbench-arena
R:
# Later, after leaving R:
subst R: /D
```

## 2. Install and verify offline behavior

Node.js 20 or newer and Git are required.

```powershell
npm ci
npm run build
npm test
npm run demo
npm start -- verify examples/demo-run
```

The demo and verification need no native-client authentication or network access after installation.

## 3. Authenticate Codex

```powershell
codex login
codex --version
```

Arena uses the existing authenticated Codex CLI state. Do not paste access tokens into a trial file.

## 4. Authenticate and inspect OpenCode providers

```powershell
opencode auth list
opencode models
opencode models openai
opencode models opencode-go
opencode models deepseek
```

Use identifiers reported by your own OpenCode installation. Provider IDs and variants can differ. A declared model-specific variant may remain unverified until its exact bounded diagnostic succeeds.

## 5. Create or copy a trial

```powershell
npm start -- init attention-sweep trial.yml
# Alternatives:
npm start -- init harness-comparison trial.yml
npm start -- init practical-comparison trial.yml
```

Use an attention sweep for one harness/model at several effort levels, a harness comparison for matched configurations, or a practical comparison for complete real-world configurations that vary in several ways. You may instead copy an annotated file under `examples/`.

## 6. Set the repository and baseline

```yaml
repository: C:/path/to/repository
baseline_ref: full-commit-SHA-or-immutable-tag
```

Use a clean Git repository and prefer an immutable full commit SHA. Every candidate starts from that same baseline in its own detached worktree.

## 7. Define the bounded task

```yaml
task_contract: >-
  Implement the requested behavior without changing the public API.
allowed_paths:
  - src
  - tests
diagnostic_probe:
  path: src/arena-diagnostic-probe.txt
  content: "agentworkbench-arena-diagnostic\n"
forbidden_paths:
  - package.json
  - acceptance
validation_commands:
  - [npm, test]
timeout_ms: 180000
validation_timeout_ms: 180000
dependency_policy: no_changes
candidates:
  - id: codex-low
    adapter: codex-exec
    harness: codex
    model: REPLACE_MODEL
    native_reasoning_effort: low
    permission_policy: workspace-write
```

The task contract, path policies, argument-array validation and optional acceptance command, timeouts, dependency policy, and candidates form the execution contract. Keep credentials and machine-local executable overrides out of shareable trial files.

## 8. Preview without execution

```powershell
npm start -- preview trial.yml
```

Preview reports candidate count/order, upper-bound runtime, structural comparison topology, unresolved placeholders, and unsupported causal claims. Its time values are bounds, not predictions.

## 9. Doctor routes without invoking a model

```powershell
npm start -- doctor trial.yml
```

Doctor checks executables, authentication status, local model discovery, argument shape, configuration layering, and route readiness without invoking a coding model.

## 10. Diagnose each exact live route

```powershell
npm start -- diagnose trial.yml <candidate-id>
```

Unlike doctor, diagnose is a bounded live provider proof and can consume a small amount of quota. It must make only the configured probe change, write exact bytes, and terminate cleanly.

## 11. Calibrate

```powershell
npm start -- calibrate trial.yml --reasoning low
```

The complete workflow is:

```text
candidate execution
→ deterministic validation
→ masked Sol adjudication
→ static report generation
→ read-only verification
```

Candidates run sequentially. Review preview's upper-bound budget and your provider quotas first. For expensive trials, use `run`, `adjudicate`, `report`, and `verify` separately so a later-stage repair cannot rerun candidates.

## 12. Open the report

The final JSON summary identifies the run directory. Open its self-contained report:

```powershell
Start-Process "<run-directory>\report.html"
```

Angle brackets in that example mark a value to replace; do not type them literally.

## 13. Understand telemetry

Arena's normalized metrics are primarily **per candidate run**. Candidate execution includes the harness and tool activity; it is not provider API request latency. Input/output tokens and provider cost appear only when the native harness reports them. Missing data remains **Not reported**, not zero.

```text
Candidate execution: 92 seconds
Input tokens: 18,400
Output tokens: 2,300
Reported harness turns: 4
Tool calls: 12
```

This does not necessarily mean four provider API requests. Arena makes no per-request latency, token, or request-count claim without compatible native request boundaries.

## 14. Safety and privacy

- Candidate worktrees are isolated, but candidates can modify the paths allowed by the trial.
- Start from a clean immutable baseline and inspect deterministic evidence before adjudication.
- Never place credentials in task text, YAML, prompts, or committed configuration.
- Do not commit raw private runs, provider logs, worktrees, or account/session material.
- Use `arena sanitize-sample` only with a finalized verified run when preparing public evidence.
