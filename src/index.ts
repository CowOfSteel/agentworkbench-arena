#!/usr/bin/env node
import { CandidateAdapter, CodexExecAdapter, OpenCodeRunAdapter } from "./adapters";
import { adjudicationDryRun, adjudicateRun, CodexJudgeAdapter, defaultJudgeConfig } from "./adjudication";
import { runDiagnostic, runTrial } from "./runner";
import { generateReport, verifyReport } from "./report";
import { loadTrial } from "./trial";
import { resolve } from "node:path";
import { calibrate } from "./calibrate";
import { previewTrial, renderTrialPreview } from "./preview";
import { trialTemplate, writeTrialTemplate } from "./templates";
import { doctorTrial } from "./doctor";
import { sanitizeSample } from "./sanitize";

const usage = `AgentWorkbench Arena — repository-specific coding-agent configuration calibration

Usage:
  arena --help
  arena init <attention-sweep|harness-comparison|practical-comparison> [output.yml]
  arena preview <trial.yml>
  arena calibrate <trial.yml> [--reasoning low|high]
  arena doctor <trial.yml>
  arena run <trial.yml>
  arena diagnose <trial.yml> <candidate-id>
  arena diagnostic <trial.yml> <candidate-id>
  arena adjudicate <run-directory> [--dry-run] [--reasoning low|high]
  arena report <run-directory>
  arena verify <run-directory>
  arena sanitize-sample <verified-run-directory> <output-directory>
  arena demo

Start with the public sample (arena demo), then init, preview, and calibrate.
Stage-specific commands remain available for advanced debugging.
Reports and verify consume completed artifacts only and never invoke candidate or judge adapters.
Square brackets in this usage describe optional arguments; do not type the brackets literally.
`;

function reasoningArgument(args: string[], command: string): "low" | "high" {
  if (!args.length) return "low";
  if (args.length === 2 && args[0] === "--reasoning" && (args[1] === "low" || args[1] === "high")) return args[1];
  throw new Error(`usage: arena ${command} <trial.yml> [--reasoning low|high]`);
}

export interface CliDependencies { loadTrial?: typeof loadTrial; calibrate?: typeof calibrate; }
export async function main(args: string[] = process.argv.slice(2), dependencies: CliDependencies = {}): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(usage);
    return 0;
  }

  if (args[0] === "--version") {
    console.log("0.1.0");
    return 0;
  }

  if (args[0] === "init") {
    if (!args[1] || args[3]) throw new Error("usage: arena init <attention-sweep|harness-comparison|practical-comparison> [output.yml]");
    trialTemplate(args[1] as "attention-sweep" | "harness-comparison" | "practical-comparison");
    const result = await writeTrialTemplate(args[1] as "attention-sweep" | "harness-comparison" | "practical-comparison", args[2]);
    console.log(`Created ${result.path}\nNext: ${result.next_command}`);
    return 0;
  }

  if (args[0] === "preview") {
    if (!args[1] || args[2]) throw new Error("usage: arena preview <trial.yml>");
    console.log(renderTrialPreview(previewTrial(await loadTrial(args[1]))));
    return 0;
  }

  if (args[0] === "calibrate") {
    if (!args[1]) throw new Error("usage: arena calibrate <trial.yml> [--reasoning low|high]");
    const summary = await (dependencies.calibrate ?? calibrate)(await (dependencies.loadTrial ?? loadTrial)(args[1]), { reasoning: reasoningArgument(args.slice(2), "calibrate"), progress: (message) => process.stderr.write(`${message}\n`) });
    console.log(JSON.stringify(summary));
    return summary.workflow_status === "completed" ? 0 : 1;
  }

  if (args[0] === "adjudicate" && args[1]) {
    const tail = args.slice(2); const dryRun = tail.includes("--dry-run"); const reasoningIndex = tail.indexOf("--reasoning");
    if (tail.some((item, index) => item !== "--dry-run" && index !== reasoningIndex && index !== reasoningIndex + 1) || (reasoningIndex >= 0 && !["low", "high"].includes(tail[reasoningIndex + 1] ?? ""))) throw new Error("usage: arena adjudicate <run-directory> [--dry-run] [--reasoning low|high]");
    const config = { ...defaultJudgeConfig, reasoning_effort: reasoningIndex >= 0 ? tail[reasoningIndex + 1] as "low" | "high" : defaultJudgeConfig.reasoning_effort };
    const result = dryRun ? await adjudicationDryRun(args[1], config) : await adjudicateRun(args[1], new CodexJudgeAdapter(), config);
    console.log(JSON.stringify(result, null, 2)); return 0;
  }

  if (args[0] === "report") {
    if (!args[1] || args[2]) throw new Error("usage: arena report <run-directory>");
    const result = await generateReport(args[1]);
    console.log(JSON.stringify({ run_directory: result.directory, report: result.report, recommendation: result.recommendation }, null, 2));
    return 0;
  }

  if (args[0] === "verify") {
    if (!args[1] || args[2]) throw new Error("usage: arena verify <run-directory>");
    const result = await verifyReport(args[1]);
    for (const check of result.checks) console.log(`${check.status === "passed" ? "[ok]" : "[failed]"} ${check.id}: ${check.reason}`);
    console.log(result.status);
    return result.status === "VERIFIED" ? 0 : 1;
  }

  if (args[0] === "sanitize-sample") {
    if (!args[1] || !args[2] || args[3]) throw new Error("usage: arena sanitize-sample <verified-run-directory> <output-directory>");
    const result = await sanitizeSample(args[1], args[2]);
    console.log(JSON.stringify({ directory: result.directory, report: result.report, recommendation: result.recommendation }, null, 2));
    return 0;
  }

  if (args[0] === "demo") {
    if (args[1]) throw new Error("usage: arena demo");
    const directory = resolve(__dirname, "..", "..", "examples", "demo-run"), result = await generateReport(directory);
    console.log(JSON.stringify({ report_path: "examples/demo-run/report.html", recommendation_path: result.recommendation }, null, 2));
    return 0;
  }

  if ((args[0] === "doctor" || args[0] === "run" || args[0] === "diagnose" || args[0] === "diagnostic") && args[1]) {
    const trial = await loadTrial(args[1]);
    const adapters: Map<string, CandidateAdapter> = new Map([
      ["codex-exec", new CodexExecAdapter()],
      ["opencode-run", new OpenCodeRunAdapter()]
    ]);
    if (args[0] === "doctor") {
      const result = await doctorTrial(trial, adapters);
      console.log(JSON.stringify(result, null, 2));
      return result.readiness === "ready" ? 0 : 1;
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
