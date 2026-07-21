import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("CLI exposes product workflow paths while retaining earlier commands", () => {
  const cli = join(__dirname, "..", "src", "index.js");
  const output = execFileSync(process.execPath, [cli, "--help"], {
    encoding: "utf8"
  });

  assert.match(output, /AgentWorkbench Arena/);
  assert.match(output, /configuration calibration/);
  assert.match(output, /arena init/);
  assert.match(output, /arena preview/);
  assert.match(output, /arena calibrate/);
  assert.match(output, /arena run/);
  assert.match(output, /arena diagnose/);
  assert.match(output, /arena diagnostic/);
  assert.match(output, /arena adjudicate/);
  assert.match(output, /arena report/);
  assert.match(output, /arena verify/);
  assert.match(output, /arena demo/);
  assert.doesNotMatch(output, /--resume/);
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
