# AgentWorkbench Arena

## Competition Sprint Roadmap and Implementation Handoff

**Date:** July 19, 2026
**Official submission deadline:** July 21, 2026 at 5:00 p.m. Pacific / 7:00 p.m. Central
**Recommended internal deadline:** July 21, 2026 at 5:00 p.m. Central
**Competition track:** Developer Tools
**Implementation status:** New contest project derived from AgentWorkbench architecture

---

# 1. Product definition

## One-sentence pitch

**AgentWorkbench Arena runs the same software task through different native coding-agent configurations, validates what each configuration actually accomplished, compares their telemetry, uses GPT-5.6 to evaluate semantic quality, and recommends which configuration to use for similar work.**

## Core user problem

Developers increasingly choose between configurations containing different:

* agent harnesses;
* providers;
* models;
* reasoning or attention levels;
* agent instructions;
* tools and skills;
* permission policies;
* subscription and API cost structures.

Public leaderboards cannot answer which complete configuration works best for a particular user’s repository, task type, rules, and available subscriptions.

AgentWorkbench Arena performs a private, repository-specific configuration trial.

## Contest demonstration statement

> Multiple coding-agent configurations receive the same repository state and the same task contract. Each may claim success. Arena demonstrates that one completed the task fastest, another produced the safest implementation, and another achieved the best overall balance. It shows the deterministic evidence, operational telemetry, identity-masked GPT-5.6 adjudication, and final routing recommendation.

---

# 2. Scope correction

## Contest MVP

Trials support two or more candidates in one first-class candidate array. Candidate count is configuration data, not a hard-coded runner or schema constant.

The initial demonstration should prioritize controlled Codex comparisons across different:

* Codex models;
* reasoning or attention limits;
* model-and-attention combinations.

The initial live trial is Luna Low, Medium, and High through Codex and Luna Low, Medium, and High through OpenCode. The product has no schema-level maximum candidate count; any operational trial-size recommendation is a contest-process guard, not a product limit.

The minimum live implementation remains two native adapters:

1. `CodexExecAdapter`
2. `OpenCodeRunAdapter`

Adapter count and candidate count are separate. A single adapter may execute several candidate configurations. The contest product must therefore support more than two candidates from the first vertical slice, even when several candidates use the same Codex adapter.

The committed sample run and primary video demonstration should include at least:

* three distinct Codex model or attention configurations;
* one additional configuration, preferably another Codex setting or one OpenCode configuration;
* one shared task contract, baseline, validation policy, and execution budget.

## Future AgentWorkbench version

The later AgentWorkbench version may expand the same candidate-array architecture to larger or more heterogeneous trials involving:

* additional Codex models or reasoning levels;
* OpenCode with different providers and models;
* Reasonix with DeepSeek;
* alternative permission or skill profiles;
* baseline OpenCode versus AgentWorkbench;
* different Coder and Reviewer pairings;
* repeated trials across task families.

This future scope must not expand the contest implementation into dozens of candidates, statistical benchmarking, or automatic routing. The contest implementation should prove a credible four-to-six-candidate product, not a two-candidate prototype and not a forty-way benchmark.

## Comparison terminology

The contest product compares **configurations**, not merely models or harnesses.

A candidate configuration consists of:

```text
harness
provider
model
variant or reasoning level
agent profile
permission policy
skills and tools
execution budget
```

When several of these variables differ, Arena must label the result a:

```text
practical configuration comparison
```

It must not claim that the result isolates the causal effect of the model or harness.

A later controlled mode may hold selected variables constant.

---

# 3. Competition positioning

## Product category

AgentWorkbench Arena is not:

* a public benchmark leaderboard;
* a generalized agent orchestrator;
* a multi-agent swarm;
* a code-review bot;
* an AI observability dashboard;
* an automated scientific benchmarking framework.

It is:

> A local calibration tool for choosing the right coding-agent configuration for a user’s own work.

## Rubric alignment

### Technological implementation

Demonstrate:

* a first-class multi-candidate runner supporting at least four live configurations;
* two native harness adapters, with adapters reusable across multiple candidate configurations;
* isolated Git worktrees;
* normalized event and usage telemetry;
* deterministic validation;
* identity-masked GPT-5.6 adjudication;
* evidence-preserving run artifacts;
* an actionable routing recommendation.

### Design

Demonstrate one coherent command:

```text
arena run examples/bounded-fix/trial.yml
```

The command produces one coherent result:

```text
report.html
```

The report must present the complete configured candidate field, not a pairwise slice. Multi-candidate execution, adjudication, ranking, and evidence browsing are product-completeness requirements for the contest MVP.

Judges should not need to understand AgentWorkbench’s larger architecture.

### Potential impact

Target developers who:

* use more than one coding agent;
* have multiple subscriptions or API providers;
* do not know which configuration to use for a task;
* cannot trust generic leaderboards to represent their repository;
* care about cost, supervision, policy compliance, and correctness.

### Quality and novelty

The differentiator is not the act of benchmarking.

The differentiator is the combination of:

* native configuration execution;
* user-owned repository tasks;
* hard acceptance contracts;
* evidence and telemetry normalization;
* semantic adjudication;
* direct routing output.

---

# 4. Architecture strategy

## Repository decision

Create a separate contest repository:

```text
agentworkbench-arena
```

Do not make the contest build depend on AgentWorkbench v1 being finished.

The repository should state that Arena is:

> A contest-period prototype of AgentWorkbench’s future configuration-calibration system.

Reasons for the separate repository:

* clean post-July-13 commit history;
* every implementation commit clearly qualifies as contest-period work;
* judges do not need to understand the entire AgentWorkbench repository;
* no private AgentWorkbench evidence or transcripts need to be exposed;
* simpler installation and licensing;
* easier `/feedback` development history;
* easier later extraction into AgentWorkbench.

## Relationship to AgentWorkbench v1

Arena may reuse or mirror only these stable concepts:

* task-contract shape;
* model-routing terminology;
* worktree isolation;
* raw-log preservation;
* telemetry naming;
* deterministic validation.

Arena must not wait on:

* the full eight-role profile;
* milestone execution;
* AgentWorkbench’s complete controller;
* EFS integration;
* Scribe;
* Reviewer role orchestration;
* RTK or Ponytail integration;
* draft pull-request management.

After the contest, Arena can be migrated into AgentWorkbench as a package or command family.

---

# 5. Technology choices

## Runtime

Use:

```text
TypeScript
Node.js
native Git commands
native child processes
lightweight schema validation
static HTML report generation
```

Do not use:

* a database;
* a web application framework;
* React;
* Electron;
* authentication;
* cloud hosting;
* a workflow engine;
* Docker unless already effortless;
* a generalized plugin framework.

## Codex adapter

Primary implementation:

```text
codex exec --json
```

Codex Exec is appropriate for one-off automation and structured logging. It preserves the native Codex harness while avoiding the integration surface of a long-lived App Server client.

The adapter must capture:

* raw JSON events;
* stdout and stderr;
* process exit status;
* token usage when reported;
* start and completion time;
* final response;
* resulting Git diff.

The Codex App Server is a post-contest enhancement unless the primary Codex agent can integrate it without delaying the vertical slice.

## OpenCode adapter

Primary implementation:

```text
opencode run --format json
```

Supply:

* model;
* variant;
* agent;
* working directory;
* task-contract prompt.

OpenCode currently exposes JSON event output for noninteractive runs, session export, token and cost statistics, and a programmatic server interface. The contest adapter should use the CLI path unless the SDK is materially easier in the existing environment.

## GPT-5.6 adjudicator

Use a separate Codex execution configured for GPT-5.6 Sol.

The adjudicator receives no write access.

It receives:

* the task contract;
* final candidate diffs;
* deterministic validator results;
* normalized telemetry;
* selected source excerpts needed to assess the implementation.

It does not receive:

* candidate model names;
* candidate provider names;
* candidate harness names;
* the candidates’ conversational prose;
* their self-reported completion claims;
* unrelated execution transcripts.

Candidates are presented as opaque labels assigned dynamically:

```text
Candidate A
Candidate B
Candidate C
Candidate D
...
```

The judge packet must support the complete configured candidate set rather than assuming a pair. The identity mapping is revealed only after the adjudication result is stored.

---

# 6. Evaluation model

## The three-layer evaluator

### Layer 1: Hard gates

These are deterministic and cannot be overridden by GPT-5.6.

Initial hard gates:

1. Required validation commands completed.
2. Required tests passed.
3. No prohibited files were modified.
4. No unauthorized dependencies were added.
5. The worktree remains recoverable.
6. The candidate produced a nonempty result.
7. The candidate did not exceed the hard process timeout.
8. Required evidence artifacts exist.

A candidate that fails a hard gate remains failed even if its code appears elegant.

### Layer 2: Operational telemetry

Telemetry reports how the result was produced.

It does not by itself determine correctness.

### Layer 3: Semantic adjudication

GPT-5.6 evaluates criteria that deterministic tests do not fully capture:

* acceptance-criteria coverage;
* architectural fit;
* maintainability;
* likely hidden regression risk;
* unnecessary complexity;
* clarity of implementation;
* evidence sufficiency.

## Winner-selection rule

Do not construct an arbitrary weighted mega-score.

Use the following order:

1. Any candidate that passes all hard gates outranks every candidate that fails one or more hard gates.
2. GPT-5.6 semantically ranks the hard-gate-passing candidates and recommends the strongest overall configuration for the task contract.
3. Telemetry explains tradeoffs and may serve as a tie-break consideration between otherwise comparable passing candidates.
4. If no candidate passes all hard gates, Arena declares `NO_WINNER`.
5. If the evidence cannot support a defensible ranking, Arena declares `INCONCLUSIVE`.
6. Arena may declare a `TIE` between two or more candidates when the evidence does not justify separating them.

Possible results:

```text
RECOMMEND_<candidate_id>
TIE
NO_WINNER
INCONCLUSIVE
```

The recommendation output must also preserve an ordered ranking or tiering of all candidates, including failed candidates and the reasons they were excluded from recommendation.

---

# 7. Minimal telemetry specification

## Answer to the telemetry question

Telemetry is mandatory for Arena, but it must remain a compact evidence layer rather than becoming a telemetry product.

The GPT-5.6 reviewer is not a replacement for telemetry.

## Common normalized fields

Each candidate run records:

### Provenance

```yaml
trial_id:
candidate_id:
task_contract_hash:
baseline_commit:
adapter:
harness:
provider:
model:
variant:
agent_profile:
configuration_hash:
started_at:
completed_at:
```

### Execution

```yaml
status:
wall_clock_ms:
process_exit_code:
process_timeout:
turn_count:
tool_call_count:
command_count:
retry_count:
approval_count:
human_intervention_count:
error_count:
```

A field unavailable from a harness must be recorded as:

```yaml
value: null
availability: unavailable
```

Never substitute zero for unavailable data.

### Usage

```yaml
input_tokens:
cached_input_tokens:
output_tokens:
reported_cost:
reported_currency:
quota_percent_before:
quota_percent_after:
usage_source:
```

Rules:

* Provider-reported cost and estimated cost must be separate.
* Subscription consumption must not be presented as API spending.
* Missing Codex or provider usage must remain unknown.
* Cached tokens must remain separate from uncached input.
* Do not compute a universal “tokens saved” number across incompatible accounting systems.

### Intervention

Record:

```yaml
permission_requests:
permission_denials:
user_questions:
manual_prompt_corrections:
manual_file_edits:
aborts:
transport_retries:
```

For the contest fixture, manual file edits during a candidate run should be prohibited.

### Output

Record:

```yaml
files_changed:
lines_added:
lines_deleted:
dependencies_added:
dependencies_removed:
untracked_files:
validation_pass_count:
validation_fail_count:
hard_gate_status:
```

### Evidence

Preserve:

```text
raw-events.jsonl
stdout.log
stderr.log
final.diff
validation.json
final-response.txt
telemetry.json
```

## Source-specific telemetry

Each adapter may preserve additional source-native telemetry in:

```text
raw-telemetry.json
```

Do not force source-specific fields into the common schema unless they have a valid cross-harness meaning.

Examples:

* Codex quota-window usage;
* Codex approval events;
* OpenCode session cost statistics;
* OpenCode provider metadata;
* Reasonix cache-stability information in the future.

Codex App Server exposes turn events, diffs, approvals, token updates, and quota-window information. OpenCode exposes JSON events, sessions, exports, and usage statistics. Reasonix also contains its own transcript and telemetry systems, making all three plausible future adapters.

## Metrics explicitly deferred

Do not implement for the contest:

* energy usage;
* CPU profiling;
* memory profiling;
* semantic token-efficiency scoring;
* automatic prompt-quality scoring;
* long-term historical dashboards;
* percentile calculations;
* statistical significance;
* Elo ratings;
* cross-task leaderboards;
* cost forecasting;
* provider-quota plugins.

---

# 8. Trial format

Use a human-readable trial file.

Example:

```yaml
version: 1

trial:
  id: bounded-inventory-fix
  mode: practical-configuration-comparison
  repository: ./fixtures/inventory-service
  baseline_ref: fixture-start

task:
  objective: Fix the incorrect inventory-total calculation.
  instructions: |
    Add regression coverage for the defect.
    Preserve the existing public API.
    Do not add dependencies.
    Do not modify files outside src/ and tests/.
  allowed_paths:
    - src/**
    - tests/**
  forbidden_paths:
    - package.json
    - package-lock.json
    - config/**
  validation:
    - npm test
    - npm run typecheck

limits:
  candidate_timeout_minutes: 15
  transport_retries: 1
  manual_intervention: forbidden

candidates:
  - id: codex-terra-medium
    adapter: codex-exec
    model_class: strong-code
    model: locally-resolved-codex-model-a
    variant: medium

  - id: codex-terra-high
    adapter: codex-exec
    model_class: strong-code
    model: locally-resolved-codex-model-a
    variant: high

  - id: codex-sol-medium
    adapter: codex-exec
    model_class: frontier-code
    model: locally-resolved-codex-model-b
    variant: medium

  - id: codex-sol-high
    adapter: codex-exec
    model_class: frontier-code
    model: locally-resolved-codex-model-b
    variant: high

  - id: opencode-reference
    adapter: opencode-run
    provider: configured-opencode-provider
    model: configured-model
    variant: configured-variant
    agent: coder

judge:
  adapter: codex-exec
  model: gpt-5.6-sol
  variant: low # High is reserved for an explicit final stabilization run.
```

Exact model identifiers must be resolved from the locally installed clients rather than assumed by the schema.

---

# 9. Run artifact structure

Each trial produces one candidate directory per configured candidate:

```text
runs/
  <trial-id>-<timestamp>/
    manifest.json
    task-contract.yml
    baseline.json
    candidates/
      <candidate-id>/
        provenance.json
        raw-events.jsonl
        raw-telemetry.json
        telemetry.json
        stdout.log
        stderr.log
        final-response.txt
        final.diff
        validation.json
    masked-judge-input.json
    judge-result.json
    identity-map.json
    recommendation.yml
    report.html
```

Candidate artifact paths must be generated dynamically. No implementation code or report template may assume only `candidate-a` and `candidate-b`.

`identity-map.json` is excluded from the judge input.

Raw logs remain authoritative.

---

# 10. CLI surface

## Required commands

```text
arena doctor
arena run <trial.yml>
arena report <run-directory>
arena demo
```

### `arena doctor`

Checks:

* Node version;
* Git availability;
* Codex availability;
* OpenCode availability;
* authentication presence without exposing credentials;
* configured candidate models;
* test fixture availability;
* writable run-artifact directory.

### `arena run`

Performs:

1. Parse and validate the trial.
2. Resolve the baseline commit.
3. Create one worktree per candidate.
4. Record candidate configuration provenance.
5. Execute candidates sequentially.
6. Capture native events and telemetry.
7. Run canonical validation independently of the candidates.
8. Capture final diffs.
9. Mask candidate identities.
10. Invoke GPT-5.6 Sol.
11. Apply the hard-gate precedence rules.
12. Generate the recommendation.
13. Generate `report.html`.
14. Preserve all artifacts.

### `arena report`

Regenerates the HTML report from existing artifacts without rerunning models.

### `arena demo`

Loads a committed, sanitized sample run and generates or opens its report.

This gives judges a meaningful multi-candidate test path without requiring their own Codex or OpenCode credentials.

---

# 11. Report design

Generate one static HTML file with inline styling.

Do not build a dashboard.

## Report sections

### Header

```text
AgentWorkbench Arena
Trial: Bounded Inventory Fix
Result: Candidate C Recommended
Comparison type: Practical configuration comparison
```

### Configuration cards

After adjudication, reveal:

* harness;
* provider;
* model;
* variant;
* profile;
* configuration hash.

### Ranked candidate summary

Show every candidate in adjudicated order with:

* eligibility after hard gates;
* semantic rank or tier;
* concise reason for placement;
* decisive tradeoff;
* disqualification reason where applicable.

The report must remain readable at four to six candidates and may use horizontally scrollable tables or stacked cards. It must not silently omit lower-ranked configurations.

### Hard-gate matrix

Example:

| Gate              | Codex A | Codex B | Codex C | OpenCode D |
| ----------------- | ------: | ------: | ------: | ---------: |
| Tests             |    Pass |    Pass |    Pass |       Pass |
| Typecheck         |    Pass |    Pass |    Pass |       Pass |
| File boundary     |    Pass |    Fail |    Pass |       Pass |
| Dependency policy |    Pass |    Pass |    Pass |       Pass |
| Evidence complete |    Pass |    Pass |    Pass |       Pass |

### Telemetry comparison

Show:

* duration;
* tokens where known;
* cached tokens;
* reported cost where known;
* tool calls;
* commands;
* interventions;
* retries;
* files changed;
* lines changed.

Unknown values display as:

```text
Not reported by harness
```

### GPT-5.6 evaluation

Show:

* semantic recommendation;
* criterion-level scores;
* concise rationale;
* remaining risks;
* confidence;
* evidence limitations.

### Recommendation

Example:

> Use the Codex configuration for bounded repository changes requiring strict scope compliance. The OpenCode configuration completed faster but modified a prohibited file. This trial compares complete configurations and does not isolate the model or harness as the cause.

### Evidence links

Link to:

* final diffs;
* validator output;
* telemetry JSON;
* judge result;
* task contract.

---

# 12. Routing recommendation

Generate:

```yaml
task_profile: bounded-code-change
recommended_candidate: codex-sol-high
confidence: medium
ranking:
  - candidate: codex-sol-high
    status: recommended
  - candidate: codex-terra-high
    status: eligible
  - candidate: opencode-reference
    status: eligible
  - candidate: codex-terra-medium
    status: excluded-by-hard-gate
reason:
  - passed all hard gates
  - strongest acceptance-criteria coverage
  - lower unauthorized-change risk
tradeoffs:
  - longer wall-clock duration than the fastest candidate
  - greater reported token usage than one lower-ranked candidate
trial_id: bounded-inventory-fix
```

For the contest, this file is an output artifact only.

Do not automatically rewrite AgentWorkbench’s routing configuration.

Post-contest, AgentWorkbench may aggregate repeated Arena trials and use them to inform role-to-configuration routing.

---

# 13. Fixture design

## Required fixture

Create one small, self-contained TypeScript repository.

Characteristics:

* installs quickly;
* no network services;
* no database;
* no secrets;
* deterministic tests;
* one subtle but understandable defect;
* one visible acceptance rule;
* one policy boundary;
* hidden or independent regression validation;
* completion possible in one agent turn or short session.

Recommended defect:

> Inventory totals are incorrectly calculated when an item has both a quantity and a fractional unit price.

Acceptance criteria:

* fix the calculation;
* add regression coverage;
* preserve the public function signature;
* add no dependencies;
* modify only `src/` and `tests/`;
* existing and new tests pass;
* typecheck passes.

## Optional second fixture

Only add a second fixture after the complete product works.

Possible second fixture:

> Review two existing patches and identify which violates a documented architectural boundary.

The first fixture is sufficient for submission.

---

# 14. Fairness rules

## Same starting state

Every candidate receives:

* the same baseline commit;
* a separate clean worktree;
* the same task contract;
* the same validation commands;
* the same hard timeout;
* no access to the other candidate’s output.

## Sequential execution

Run candidates sequentially for the contest, regardless of candidate count.

Reasons:

* easier process management;
* lower quota pressure;
* fewer authentication races;
* clearer logs;
* simpler demonstration;
* reduced machine-resource interference.

Parallel execution is deferred.

## No repair loops

Each candidate receives one substantive attempt.

Allow one retry only for a clearly classified transport or process-launch failure.

Do not let one candidate receive debugging assistance that the other does not.

## Human intervention

Human intervention during a candidate run is prohibited for the fixture.

If intervention occurs, record it and mark the run noncomparable.

## No causal overclaim

Every report must include:

> This trial compares complete agent configurations. Unless variables were explicitly held constant, it does not establish that any single model, provider, harness, or reasoning setting caused the observed result.

---

# 15. Sprint execution plan

## Phase 0: Scope lock and contest setup

### Objective

Create the contest repository and establish one authoritative implementation thread.

### Required work

1. Create `agentworkbench-arena`.
2. Add:

   * `README.md`;
   * `SCOPE.md`;
   * `CONTEST_WORK.md`;
   * `.gitignore`;
   * license;
   * minimal Node and TypeScript configuration.
3. Record the official competition deadline and requirements.
4. Start the primary Codex thread.
5. In that thread, run `/feedback` once early to confirm the mechanism works.
6. Give the primary thread this roadmap.
7. Instruct it to maintain:

   * `IMPLEMENTATION_STATE.md`;
   * current acceptance criteria;
   * current blocker;
   * commands verified;
   * next bounded step.

### Completion gate

The repository builds, tests, and contains the locked product scope.

### Prohibited work

* no UI;
* no Reasonix;
* no AgentWorkbench v1 integration;
* no research phase;
* no additional roles;
* no model-selection algorithm.

---

## Phase 1: Native six-candidate adapter feasibility spike

### Objective

Prove that the runner can execute the locked six live candidate configurations against the same fixture task: Luna Low, Medium, and High through Codex, plus Luna Low, Medium, and High through OpenCode. Candidate enumeration remains generic and supports any two-or-more candidates.

### Required work

1. Create the fixture repository.
2. Implement a minimal candidate interface:

```ts
interface CandidateAdapter {
  doctor(): Promise<DoctorResult>;
  execute(request: CandidateRequest): Promise<CandidateExecution>;
}
```

3. Implement:

   * `CodexExecAdapter`;
   * `OpenCodeRunAdapter`.
4. Make candidate enumeration independent of adapter enumeration.
5. Configure and execute all six locked candidates through generic enumeration.
6. Capture raw JSON events for each candidate.
7. Capture process status and timing for each candidate.
8. Produce a final Git diff from each worktree.
9. Do not implement judging or HTML yet.

### Feasibility gate

The spike passes only when:

* both native adapters start where used by the configured trial;
* all six configured candidate configurations are attempted;
* every candidate receives the same task contract;
* every candidate terminates or times out cleanly;
* every candidate produces raw logs;
* every candidate worktree remains inspectable;
* every final diff can be collected;
* adding a seventh candidate requires only trial-file configuration, not runner changes.

### Kill decision

If live multi-candidate execution does not work reliably, switch immediately to the contingency mode:

```text
arena compare <trial.yml> <candidate-export-directory...>
```

The contingency product imports the locked six real native-session exports, including both harnesses and all three attention settings, normalizes them, validates the resulting worktrees, and produces the same multi-candidate evaluation report. Import mode must not collapse the product back to a pairwise comparison.

Do not spend the entire remaining budget debugging native process control.

---

## Phase 2: Deterministic runner and telemetry

### Objective

Create the trustworthy factual layer.

### Required work

1. Implement trial parsing.
2. Implement baseline resolution.
3. Implement worktree creation and cleanup.
4. Run candidates sequentially.
5. Implement the normalized telemetry schema.
6. Preserve raw telemetry separately.
7. Implement canonical validation commands.
8. Detect:

   * prohibited file changes;
   * dependency changes;
   * untracked files;
   * validation failures;
   * timeout;
   * missing evidence.
9. Generate:

   * `telemetry.json`;
   * `validation.json`;
   * `manifest.json`.

### Completion gate

A complete run can answer, without an LLM:

* what configuration ran;
* what it changed;
* how long it ran;
* what usage was reported;
* what commands were validated;
* which hard gates passed;
* whether intervention occurred.

---

## Phase 3: GPT-5.6 adjudication

### Objective

Add substantive GPT-5.6 use without making it the source of objective truth.

### Required work

1. Implement identity masking.
2. Construct a bounded judge packet.
3. Invoke GPT-5.6 Sol in read-only mode.
4. Require structured output.
5. Validate the returned structure.
6. Permit one repair request if the judge returns malformed output.
7. Store the original and repaired outputs.
8. Apply hard-gate precedence after semantic adjudication.

### Judge output shape

```yaml
verdict:
recommended_candidate_id:
confidence:
ranking:
  - candidate_id:
    rank:
    tier:
    eligible:
    rationale:
criteria_by_candidate:
  <candidate_id>:
    acceptance_coverage:
    maintainability:
    architecture_fit:
    regression_risk:
    evidence_quality:
strengths_by_candidate:
  <candidate_id>:
risks_by_candidate:
  <candidate_id>:
unsupported_conclusions:
summary:
```

### Completion gate

The system can produce:

* a deterministic gate result;
* a semantic comparison;
* a final recommendation;
* a clear explanation of uncertainty.

---

## Phase 4: Product report and routing output

### Objective

Turn the evaluation pipeline into a coherent product.

### Required work

1. Generate static `report.html`.
2. Add the hard-gate matrix.
3. Add telemetry cards.
4. Add GPT-5.6 findings.
5. Reveal candidate identities after evaluation.
6. Generate `recommendation.yml`.
7. Add `arena report`.
8. Add `arena demo`.
9. Commit a sanitized sample run.

### Completion gate

A nontechnical viewer can understand within 30 seconds:

* what was compared;
* which candidate was recommended;
* why;
* what evidence supports the recommendation;
* which metrics were unavailable.

---

## Phase 5: Hardening and judge path

### Objective

Make the project installable and credible.

### Required work

1. Test from a clean clone.
2. Verify:

```text
npm install
npm test
npm run build
npm run demo
```

3. Add Windows-safe path handling.
4. Avoid shell-specific command composition.
5. Sanitize all committed artifacts.
6. Remove:

   * credentials;
   * absolute personal paths;
   * private repository names;
   * private transcripts;
   * account identifiers.
7. Add clear supported-platform language.
8. Document live-run prerequisites.
9. Document sample-mode prerequisites.
10. Add architecture diagram as simple Mermaid or text.
11. Add limitations and nonclaims.
12. Run a final adversarial review.

### Completion gate

A judge without Codex or OpenCode credentials can run the sample demonstration.

A judge with the required native tools can configure and run the live multi-candidate fixture.

---

## Phase 6: Competition packaging

### README must include

1. What Arena does.
2. The specific user problem.
3. One-command sample demo.
4. Live execution instructions.
5. Supported platforms.
6. Architecture.
7. Telemetry model.
8. Why GPT-5.6 is used.
9. Why deterministic validation remains authoritative.
10. How Codex built the project.
11. Which decisions were made by the human.
12. Which work was completed after July 13.
13. Known limitations.
14. Future AgentWorkbench integration.
15. License and third-party attribution.

### Codex collaboration record

The primary Codex thread should contain the majority of:

* adapter implementation;
* runner implementation;
* telemetry implementation;
* evaluator implementation;
* tests;
* report generation.

ChatGPT Web agents may assist with:

* product critique;
* fixture design;
* README drafting;
* video scripting;
* final adversarial review.

Do not distribute core implementation evenly across many unrelated Codex sessions.

The competition requires the `/feedback` ID from the thread where most core functionality was built.

---

# 16. Token and usage budget policy

## Current resources

Treat the available resources as:

* approximately 14 percent of the current weekly Plus Codex budget;
* two banked resets;
* existing OpenCode access;
* ChatGPT Web for planning and review.

Do not assume either reset must be used.

## Before the first reset

Use the remaining weekly allowance only for:

1. repository scaffold;
2. fixture;
3. Codex adapter;
4. OpenCode adapter;
5. one successful six-candidate spike across the locked Codex and OpenCode configurations.

Do not spend a banked reset merely to continue architecture discussion.

## First reset release condition

Use the first banked reset only after:

* both adapters have executed where required by the selected trial;
* all six configured candidate configurations have produced artifacts;
* the implementation path is proven;
* no major scope decision remains open.

Use it for:

* deterministic runner;
* telemetry normalization;
* validation;
* GPT-5.6 adjudication;
* report generation.

## Second reset release condition

Reserve the second reset for one of:

* a blocking integration defect;
* clean-install repair;
* final end-to-end test failure;
* malformed adjudicator output that requires implementation changes;
* submission packaging failure tied to code.

Do not use it for:

* Reasonix;
* a dashboard;
* expanding beyond the contest-scale four-to-six-candidate trial;
* cosmetic animation;
* automatic routing;
* additional fixtures;
* speculative refactoring.

## Model policy

Recommended build allocation:

### Primary implementation

Use GPT-5.6 Terra at an appropriate coding reasoning level for most implementation.

### Sol usage

Use GPT-5.6 Sol only for:

* one architecture lock or adversarial checkpoint;
* the Arena adjudicator;
* one final technical review if budget permits.

### ChatGPT Web

Use Web conversations for:

* roadmap interpretation;
* narrow design questions;
* video and README work;
* reviewing pasted diffs;
* identifying scope violations.

Do not ask multiple Web agents to independently regenerate the implementation.

## Context policy

The primary Codex thread must remain the authoritative build thread.

To reduce repeated context cost:

* maintain `IMPLEMENTATION_STATE.md`;
* refer to committed files rather than repasting them;
* keep each request bounded to one phase;
* do not repeatedly ask for whole-repository audits;
* commit at each completion gate;
* ask Codex to inspect only the files relevant to the current phase;
* do not reopen settled product decisions.

---

# 17. Video plan

## Total duration

Target approximately 2 minutes 40 seconds.

## 0:00 to 0:20: Problem

> Public coding-agent leaderboards cannot tell me which combination of harness, provider, model, reasoning level, permissions, and subscription works best on my own repository.

## 0:20 to 0:40: Trial

Show:

* one task contract;
* the locked six candidate configurations, visibly including both harnesses and all three attention settings;
* same baseline commit;
* same validation rules.

## 0:40 to 1:05: Native execution

Show a compressed or edited sequence of:

* multiple Codex configurations executing through the same adapter;
* the OpenCode reference configuration if included;
* separate worktrees for every candidate;
* evidence capture.

Do not make viewers watch terminal output scroll.

## 1:05 to 1:35: Deterministic result

Show the hard-gate matrix.

Example:

* several candidates passed tests;
* Candidate B was fastest but changed a prohibited file;
* Candidate C remained within scope and achieved the strongest semantic result;
* Candidate A used fewer reported tokens;
* Candidate D was valid but ranked below the leading Codex configuration.

## 1:35 to 2:05: GPT-5.6 result

Show the identity-masked Sol analysis.

Then reveal the model, attention setting, harness, and provider behind every candidate label.

## 2:05 to 2:25: Actionable output

Show:

```text
recommendation.yml
```

Explain that AgentWorkbench can later use repeated trials to calibrate model and harness routing.

## 2:25 to 2:40: Codex development story

Explain:

* Codex built the native adapter and evidence pipeline;
* GPT-5.6 performs semantic adjudication;
* deterministic evidence remains authoritative;
* the human defined the problem, scope, acceptance contract, and evaluation policy.

The competition video must include narration and clearly demonstrate both Codex and GPT-5.6 use. Judges are not required to watch beyond three minutes.

---

# 18. Submission schedule

## Sunday, July 19

Must complete:

* contest repository;
* primary Codex thread;
* fixture;
* adapter interface;
* Codex adapter;
* OpenCode adapter;
* successful or clearly salvageable six-candidate spike across both locked harnesses and attention settings.

Decision at the end of this stage:

```text
LIVE_MODE
```

or:

```text
IMPORT_COMPARISON_FALLBACK
```

No third option.

## Monday, July 20

Must complete:

* deterministic runner;
* worktree isolation;
* telemetry normalization;
* hard gates;
* Sol adjudication;
* static report;
* recommendation output;
* sample run;
* first README draft;
* first demo rehearsal.

Feature freeze Monday night.

## Tuesday, July 21

Must complete:

* clean-clone test;
* final end-to-end run;
* sanitized sample;
* final README;
* `/feedback` Session ID;
* video recording and upload;
* Devpost submission;
* repository visibility or judge sharing;
* link and permission verification.

Target submission by:

```text
5:00 p.m. Central
```

Official deadline:

```text
7:00 p.m. Central
```

The two-hour margin is reserved for upload, permission, Devpost, or YouTube failures.

---

# 19. Explicit non-goals

The following are prohibited before submission:

* more than two live adapter implementations;
* contest trials larger than six candidates unless the complete product is already stable; this operational guard is not a schema-level maximum;
* Reasonix integration;
* Claude Code integration;
* Gemini integration;
* multiple LLM judges;
* multi-round debate;
* automatic prompt optimization;
* adaptive routing;
* learned routing;
* historical benchmark database;
* statistical significance claims;
* user accounts;
* hosted service;
* React dashboard;
* real-time charts;
* parallel candidate execution;
* AgentWorkbench v1 milestone integration;
* EFS repository benchmarking;
* full permission-conformance framework;
* RTK comparison;
* Ponytail comparison;
* reviewer or debugger subagents;
* automatic Git commits or pull requests;
* automatic installation of agent harnesses.

---

# 20. Final acceptance criteria

The contest project is complete when all of the following are true:

1. A clean clone installs.
2. `arena doctor` reports actionable readiness.
3. `arena demo` produces a readable sample report.
4. `arena run` can execute or import at least four real native configuration results in one trial.
5. Each candidate starts from the same Git baseline.
6. Raw output and final diffs are preserved.
7. Canonical validation runs independently.
8. Prohibited file changes are detected.
9. Normalized telemetry distinguishes unknown from zero.
10. GPT-5.6 receives identity-masked evidence.
11. GPT-5.6 cannot override a deterministic hard failure.
12. A complete candidate ranking, recommendation, tie, inconclusive, or explicit no-winner result is produced.
13. A static HTML report explains the result.
14. A routing recommendation file is generated.
15. The README documents Codex and GPT-5.6 use.
16. The primary Codex `/feedback` Session ID is available.
17. The demo video is public, narrated, and under three minutes.
18. No secrets or private AgentWorkbench material are exposed.
19. The product does not make unsupported causal claims.
20. The submission is entered before the deadline.

---

# 21. Immediate implementation instruction

The first Codex task should be:

> Create a new TypeScript repository for AgentWorkbench Arena. Implement only Phase 0 and Phase 1 of the supplied roadmap. Build the fixture, trial schema, candidate-adapter interface, Codex Exec adapter, and OpenCode Run adapter. Candidate enumeration must be independent of adapter enumeration. Prove that the same task contract can be executed in separate worktrees by the locked six live candidate configurations: Luna Low, Medium, and High through both Codex and OpenCode. Raw events, exit status, timing, and final diffs must be collected for every candidate. Adding a seventh candidate must require only trial-file configuration. Do not implement the GPT judge, HTML report, routing recommendation, Reasonix, a dashboard, or AgentWorkbench v1 integration. Maintain `IMPLEMENTATION_STATE.md`, commit coherent milestones, and stop with a feasibility report once the six-candidate spike has either succeeded or produced exact blocking evidence.
