import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, delimiter } from "node:path";

const VERUS_BIN = process.env.VERUS_BIN || "verus";
const VERUS_TIMEOUT_MS = Number(process.env.VERUS_TIMEOUT_MS || 60000);

// Verus shells out to `rustup` to locate its pinned toolchain, so the child
// process needs the cargo bin dir on PATH even when our own shell lacks it.
// RUST_BIN_PATH can override; otherwise default to the standard ~/.cargo/bin.
function childEnv() {
  const rustBin = process.env.RUST_BIN_PATH || join(homedir(), ".cargo", "bin");
  const path = `${rustBin}${delimiter}${process.env.PATH || ""}`;
  return { ...process.env, PATH: path };
}

/**
 * Run Verus on a source string.
 *
 * Returns one of:
 *   { available: false }                          — the verus binary was not found
 *   { available: true, verified: true,  ... }     — verification succeeded
 *   { available: true, verified: false, ... }     — verification failed / errored / timed out
 *
 * The non-`available` shape lets the pipeline keep running (spec + code) even
 * on a machine without Verus installed.
 */
export async function runVerus(source) {
  let dir;
  try {
    dir = await mkdtemp(join(tmpdir(), "verus-forge-"));
    const file = join(dir, "lib.rs");
    await writeFile(file, source, "utf8");

    return await new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;

      let child;
      try {
        child = spawn(VERUS_BIN, [file], { cwd: dir, env: childEnv() });
      } catch (err) {
        resolve({ available: false, error: String(err) });
        return;
      }

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish({
          available: true,
          verified: false,
          timedOut: true,
          output: `${stdout}\n${stderr}\n[verus timed out after ${VERUS_TIMEOUT_MS}ms]`,
        });
      }, VERUS_TIMEOUT_MS);

      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));

      child.on("error", (err) => {
        // ENOENT => the binary is not installed / not on PATH.
        if (err && err.code === "ENOENT") finish({ available: false });
        else finish({ available: false, error: String(err) });
      });

      child.on("close", (exitCode) => {
        const output = `${stdout}${stderr}`.trim();
        finish({
          available: true,
          verified: exitCode === 0,
          exitCode,
          output,
          summary: parseSummary(output),
        });
      });
    });
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Pull the "N verified, M errors" line Verus prints, if present.
function parseSummary(output) {
  const m = output.match(/(\d+)\s+verified,\s*(\d+)\s+error/i);
  if (!m) return null;
  return { verified: Number(m[1]), errors: Number(m[2]) };
}

export async function verusVersion() {
  return await new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn(VERUS_BIN, ["--version"], { env: childEnv() });
    } catch {
      resolve({ available: false });
      return;
    }
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("error", () => resolve({ available: false }));
    child.on("close", () => resolve({ available: true, version: out.trim() }));
  });
}
