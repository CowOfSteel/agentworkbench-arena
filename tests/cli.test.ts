import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("CLI exposes the Phase 1 help path", () => {
  const cli = join(__dirname, "..", "src", "index.js");
  const output = execFileSync(process.execPath, [cli, "--help"], {
    encoding: "utf8"
  });

  assert.match(output, /AgentWorkbench Arena/);
  assert.match(output, /Phase 1 feasibility spike/);
  assert.match(output, /arena run/);
});

test("doctor exits unsuccessfully when required adapters are unavailable", async () => {
  const cli = join(__dirname, "..", "src", "index.js");
  const trial = join(process.cwd(), "examples", "bounded-fix", "trial.yml");
  const emptyPath = await mkdtemp(join(tmpdir(), "arena-doctor-"));
  try {
    assert.throws(() => execFileSync(process.execPath, [cli, "doctor", trial], {
      cwd: join(__dirname, ".."),
      encoding: "utf8",
      env: { ...process.env, PATH: emptyPath }
    }), (error: unknown) => (error as { status?: number }).status === 1);
  } finally { await rm(emptyPath, { recursive: true, force: true }); }
});
