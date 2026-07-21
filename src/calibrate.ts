import { CandidateAdapter, CodexExecAdapter, OpenCodeRunAdapter } from "./adapters";
import { adjudicateRun, CodexJudgeAdapter, defaultJudgeConfig, JudgeAdapter, ReasoningEffort } from "./adjudication";
import { generateReport } from "./report";
import { runTrial } from "./runner";
import { Trial } from "./trial";

type Stages = { runTrial: typeof runTrial; adjudicateRun: typeof adjudicateRun; generateReport: typeof generateReport; };
export interface CalibrateOptions { adapters?: Map<string, CandidateAdapter>; judge?: JudgeAdapter; reasoning?: ReasoningEffort; progress?: (message: string) => void; stages?: Stages; }
export interface CalibrationSummary { run_directory: string; outcome: string; recommended_candidate: string | null; tied_candidates: string[]; report_path: string; recommendation_path: string; verification_ready: boolean; }

const defaults = (): Map<string, CandidateAdapter> => new Map([["codex-exec", new CodexExecAdapter()], ["opencode-run", new OpenCodeRunAdapter()]]);
export async function calibrate(trial: Trial, options: CalibrateOptions = {}): Promise<CalibrationSummary> {
  const stages = options.stages ?? { runTrial, adjudicateRun, generateReport }, progress = options.progress ?? (() => undefined), reasoning = options.reasoning ?? "low";
  progress("Stage 1/3: running candidates"); const run = await stages.runTrial(trial, options.adapters ?? defaults());
  progress("Stage 2/3: adjudicating finalized evidence"); const evaluation = await stages.adjudicateRun(run.directory, options.judge ?? new CodexJudgeAdapter(), { ...defaultJudgeConfig, reasoning_effort: reasoning });
  progress("Stage 3/3: generating static report"); const report = await stages.generateReport(run.directory);
  return { run_directory: run.directory, outcome: String(evaluation.outcome), recommended_candidate: typeof evaluation.recommended_candidate_id === "string" ? evaluation.recommended_candidate_id : null, tied_candidates: Array.isArray(evaluation.tied_candidate_ids) ? evaluation.tied_candidate_ids.map(String) : [], report_path: report.report, recommendation_path: report.recommendation, verification_ready: true };
}
