import { CodexExecAdapter, OpenCodeRunAdapter } from "./adapters";
import { runTrial } from "./runner";
import { loadTrial } from "./trial";

const usage = `AgentWorkbench Arena (Phase 1 feasibility spike)

Usage:
  arena --help
  arena doctor <trial.yml>
  arena run <trial.yml> [--resume <run-directory>]

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

  if ((args[0] === "doctor" || args[0] === "run") && args[1]) {
    const trial = await loadTrial(args[1]);
    const adapters = new Map([
      ["codex-exec", new CodexExecAdapter()],
      ["opencode-run", new OpenCodeRunAdapter()]
    ]);
    if (args[0] === "doctor") {
      console.log(JSON.stringify({ trial_id: trial.id, candidate_count: trial.candidates.length, adapters: await Promise.all([...adapters.values()].map((adapter) => adapter.doctor())) }, null, 2));
      return 0;
    }
    const resume = args[2] === "--resume" ? args[3] : undefined;
    if (args[2] && !resume) throw new Error("usage: arena run <trial.yml> [--resume <run-directory>]");
    const result = await runTrial(trial, adapters, resume);
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
