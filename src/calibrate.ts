import { CandidateAdapter, CodexExecAdapter, OpenCodeRunAdapter } from "./adapters";
import { adjudicateRun, AdjudicationExecutionSummary, CodexJudgeAdapter, defaultJudgeConfig, JudgeAdapter, ReasoningEffort } from "./adjudication";
import { generateReport, VerificationResult, verifyReport } from "./report";
import { unresolvedPlaceholders } from "./preview";
import { runTrial } from "./runner";
import { Trial } from "./trial";

type Stages = { runTrial: typeof runTrial; adjudicateRun: typeof adjudicateRun; generateReport: typeof generateReport; verifyReport: typeof verifyReport; };
export interface CalibrateOptions { adapters?: Map<string, CandidateAdapter>; judge?: JudgeAdapter; reasoning?: ReasoningEffort; progress?: (message: string) => void; stages?: Partial<Stages>; }
export interface CalibrationSummary { run_directory: string; workflow_status: "completed" | "judge_execution_failed" | "verification_failed"; outcome: string; recommended_candidate: string | null; tied_candidates: string[]; adjudication_execution_status: string; adjudication_failure_classification: string | null; report_path: string; recommendation_path: string; verification: VerificationResult; verification_ready: boolean; }

const defaults = (): Map<string, CandidateAdapter> => new Map([["codex-exec", new CodexExecAdapter()], ["opencode-run", new OpenCodeRunAdapter()]]);
export async function calibrate(trial: Trial, options: CalibrateOptions = {}): Promise<CalibrationSummary> {
  const placeholders = [...new Set(unresolvedPlaceholders(trial))].sort();
  if (placeholders.length) throw new Error(`trial contains unresolved placeholders (${placeholders.join(", ")}); run arena preview <trial.yml> and replace them before calibrating`);
  const stages: Stages = { runTrial, adjudicateRun, generateReport, verifyReport, ...options.stages }, progress = options.progress ?? (() => undefined), reasoning = options.reasoning ?? "low";
  progress("Stage 1/3: running candidates"); const run = await stages.runTrial(trial, options.adapters ?? defaults());
  progress("Stage 2/3: adjudicating finalized evidence"); const evaluation = await stages.adjudicateRun(run.directory, options.judge ?? new CodexJudgeAdapter(), { ...defaultJudgeConfig, reasoning_effort: reasoning });
  progress("Stage 3/3: generating static report"); const report = await stages.generateReport(run.directory);
  progress("Verifying generated report"); const verification = await stages.verifyReport(run.directory), execution = evaluation.adjudication_execution as AdjudicationExecutionSummary | undefined, outcome = String(evaluation.outcome), acceptedInconclusive = outcome === "INCONCLUSIVE" && execution?.accepted_verdict === true;
  const workflow_status = verification.status !== "VERIFIED" ? "verification_failed" : outcome === "INCONCLUSIVE" && !acceptedInconclusive ? "judge_execution_failed" : "completed";
  return { run_directory: run.directory, workflow_status, outcome, recommended_candidate: typeof evaluation.recommended_candidate_id === "string" ? evaluation.recommended_candidate_id : null, tied_candidates: Array.isArray(evaluation.tied_candidate_ids) ? evaluation.tied_candidate_ids.map(String) : [], adjudication_execution_status: execution?.status ?? (outcome === "NO_WINNER" ? "not_invoked_no_eligible_candidates" : "completed"), adjudication_failure_classification: execution?.failure_classification ?? null, report_path: report.report, recommendation_path: report.recommendation, verification, verification_ready: verification.status === "VERIFIED" };
}
