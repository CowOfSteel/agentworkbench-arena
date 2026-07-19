const usage = `AgentWorkbench Arena (Phase 0 scaffold)

Usage:
  arena --help

Candidate execution and trial commands begin in Phase 1 and are not implemented yet.
`;

export function main(args: string[] = process.argv.slice(2)): number {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(usage);
    return 0;
  }

  if (args[0] === "--version") {
    console.log("0.1.0");
    return 0;
  }

  console.error(`Unknown option: ${args[0]}`);
  console.error("Run `arena --help` for usage.");
  return 1;
}

if (require.main === module) {
  process.exitCode = main();
}
