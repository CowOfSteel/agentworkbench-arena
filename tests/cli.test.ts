import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { join } from "node:path";

test("CLI exposes the Phase 0 help path", () => {
  const cli = join(__dirname, "..", "src", "index.js");
  const output = execFileSync(process.execPath, [cli, "--help"], {
    encoding: "utf8"
  });

  assert.match(output, /AgentWorkbench Arena/);
  assert.match(output, /Phase 0 scaffold/);
  assert.match(output, /Phase 1/);
});
