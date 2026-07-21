import { link, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import { validateTrial } from "./trial";

export type TemplateKind = "attention-sweep" | "harness-comparison" | "practical-comparison";

const common = `# Edit every REPLACE_* value before calibrating. This file contains no credentials or machine-local executable paths.
repository: REPLACE_REPOSITORY
baseline_ref: REPLACE_BASELINE
task_contract: |
  REPLACE_TASK_CONTRACT
allowed_paths:
  - src
diagnostic_probe:
  path: src/arena-diagnostic-probe.txt
  content: "agentworkbench-arena-diagnostic\\n"
forbidden_paths:
  - package.json
  - package-lock.json
validation_commands:
  - [npm, test]
timeout_ms: 180000
validation_timeout_ms: 180000
dependency_policy: no_changes
retry_policy:
  max_launch_transport_retries: 1
manual_intervention: forbidden
provenance:
  build_tools: {}
  ambient_tools: {}
  future_candidate_enabled_tools: []`;
const templates: Record<TemplateKind, string> = {
  "attention-sweep": `id: attention-sweep
${common}
# Same Codex configuration; only attention changes.
candidates:
  - id: codex-low
    adapter: codex-exec
    harness: codex
    model: REPLACE_CODEX_MODEL
    attention: low
    permission_policy: workspace-write
    adapter_options:
      config_overrides:
        model_reasoning_effort: low
    tool_provenance:
      explicitly_enabled: []
  - id: codex-medium
    adapter: codex-exec
    harness: codex
    model: REPLACE_CODEX_MODEL
    attention: medium
    permission_policy: workspace-write
    adapter_options:
      config_overrides:
        model_reasoning_effort: medium
    tool_provenance:
      explicitly_enabled: []
  - id: codex-high
    adapter: codex-exec
    harness: codex
    model: REPLACE_CODEX_MODEL
    attention: high
    permission_policy: workspace-write
    adapter_options:
      config_overrides:
        model_reasoning_effort: high
    tool_provenance:
      explicitly_enabled: []
`,
  "harness-comparison": `id: harness-comparison
${common}
# Matched model and attention across the two supported harnesses.
candidates:
  - id: codex-matched
    adapter: codex-exec
    harness: codex
    model: REPLACE_SHARED_MODEL
    attention: low
    permission_policy: workspace-write
    adapter_options:
      config_overrides:
        model_reasoning_effort: low
    tool_provenance:
      explicitly_enabled: []
  - id: opencode-matched
    adapter: opencode-run
    harness: opencode
    model: REPLACE_SHARED_MODEL
    attention: low
    permission_policy: configured-build-agent
    tool_provenance:
      explicitly_enabled: []
`,
  "practical-comparison": `id: practical-comparison
${common}
# Representative complete configurations. Multiple dimensions intentionally vary.
candidates:
  - id: codex-baseline
    adapter: codex-exec
    harness: codex
    model: REPLACE_MODEL_A
    attention: low
    permission_policy: workspace-write
    adapter_options:
      config_overrides:
        model_reasoning_effort: low
    tool_provenance:
      explicitly_enabled: []
  - id: codex-deliberate
    adapter: codex-exec
    harness: codex
    model: REPLACE_MODEL_A
    attention: medium
    profile: REPLACE_PROFILE
    permission_policy: workspace-write
    adapter_options:
      config_overrides:
        model_reasoning_effort: medium
    tool_provenance:
      explicitly_enabled: []
  - id: opencode-build
    adapter: opencode-run
    harness: opencode
    provider: REPLACE_PROVIDER
    model: REPLACE_MODEL_A
    attention: low
    agent: build
    permission_policy: configured-build-agent
    tool_provenance:
      explicitly_enabled: []
  - id: codex-alternative
    adapter: codex-exec
    harness: codex
    model: REPLACE_MODEL_B
    attention: low
    permission_policy: workspace-write
    adapter_options:
      config_overrides:
        model_reasoning_effort: low
    tool_provenance:
      explicitly_enabled: []
`
};

export function trialTemplate(kind: TemplateKind): string { const template = templates[kind]; if (!template) throw new Error("usage: arena init <attention-sweep|harness-comparison|practical-comparison> [output.yml]"); validateTrial(parse(template)); return template; }
export async function writeTrialTemplate(kind: TemplateKind, output = "trial.yml"): Promise<{ path: string; next_command: string }> { const path = resolve(output), temporary = `${path}.${process.pid}.${Date.now()}.tmp`; await mkdir(dirname(path), { recursive: true }); try { await writeFile(temporary, trialTemplate(kind), "utf8"); await link(temporary, path); } finally { await rm(temporary, { force: true }); } return { path, next_command: `arena preview ${output}` }; }
