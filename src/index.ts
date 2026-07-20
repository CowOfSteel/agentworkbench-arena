import { CandidateAdapter, CodexExecAdapter, OpenCodeRunAdapter } from "./adapters";
import { adjudicationDryRun, adjudicateRun, CodexJudgeAdapter, defaultJudgeConfig } from "./adjudication";
import { runDiagnostic, runTrial } from "./runner";
import { loadTrial } from "./trial";

const usage = `AgentWorkbench Arena (Phase 3 deterministic adjudication)

Usage:
  arena --help
  arena doctor <trial.yml>
  arena run <trial.yml>
  arena diagnose <trial.yml> <candidate-id>
  arena diagnostic <trial.yml> <candidate-id>
  arena adjudicate <run-directory> [--dry-run] [--reasoning low|high]

Runs native candidates sequentially in isolated Git worktrees and preserves raw evidence.
`;

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(usage);
    return 0;
  }

  if (args[0] === "--version") {
    console.log("0.1.0");
    return 0;
  }

  if (args[0] === "adjudicate" && args[1]) {
    const tail = args.slice(2); const dryRun = tail.includes("--dry-run"); const reasoningIndex = tail.indexOf("--reasoning");
    if (tail.some((item, index) => item !== "--dry-run" && index !== reasoningIndex && index !== reasoningIndex + 1) || (reasoningIndex >= 0 && !["low", "high"].includes(tail[reasoningIndex + 1] ?? ""))) throw new Error("usage: arena adjudicate <run-directory> [--dry-run] [--reasoning low|high]");
    const config = { ...defaultJudgeConfig, reasoning_effort: reasoningIndex >= 0 ? tail[reasoningIndex + 1] as "low" | "high" : defaultJudgeConfig.reasoning_effort };
    const result = dryRun ? await adjudicationDryRun(args[1], config) : await adjudicateRun(args[1], new CodexJudgeAdapter(), config);
    console.log(JSON.stringify(result, null, 2)); return 0;
  }

  if ((args[0] === "doctor" || args[0] === "run" || args[0] === "diagnose" || args[0] === "diagnostic") && args[1]) {
    const trial = await loadTrial(args[1]);
    const adapters: Map<string, CandidateAdapter> = new Map([
      ["codex-exec", new CodexExecAdapter()],
      ["opencode-run", new OpenCodeRunAdapter()]
    ]);
    if (args[0] === "doctor") {
      const required = new Set<string>(trial.candidates.map((candidate) => candidate.adapter));
      const checks = await Promise.all([...adapters.entries()].map(async ([id, adapter]) => ({ id, result: await adapter.doctor(trial.candidates.find((candidate) => candidate.adapter === id)) })));
      console.log(JSON.stringify({ trial_id: trial.id, candidate_count: trial.candidates.length, adapters: checks.map(({ result }) => result) }, null, 2));
      return checks.every(({ id, result }) => !required.has(id) || result.ok) ? 0 : 1;
    }
    if (args[0] === "diagnose" || args[0] === "diagnostic") {
      if (!args[2] || args[3]) throw new Error("usage: arena diagnose <trial.yml> <candidate-id>");
      const result = await runDiagnostic(trial, args[2], adapters);
      console.log(JSON.stringify({ run_directory: result.directory, candidate: result.candidate.candidateId, passed: result.passed, diagnostic: result.diagnosticPath }, null, 2));
      return result.passed ? 0 : 1;
    }
    if (args[2]) throw new Error("usage: arena run <trial.yml>");
    const result = await runTrial(trial, adapters);
    console.log(JSON.stringify({ run_directory: result.directory, attempted: result.candidates.map((candidate) => candidate.candidateId) }, null, 2));
    return 0;
  }

  console.error(`Unknown option: ${args[0]}`);
  console.error("Run `arena --help` for usage.");
  return 1;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
