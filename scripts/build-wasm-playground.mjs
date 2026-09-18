import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const WASM_TARGET = "wasm32-unknown-unknown";
export const WASM_NAME = "pd_vm_wasm.wasm";
export const CORE_REVISION_FILE_NAME = "rustscript-core-revision";

export function repoRootFromScript(scriptUrl = import.meta.url) {
  return resolve(dirname(fileURLToPath(scriptUrl)), "..");
}

export function resolveRustscriptRoot(env = process.env, repoRoot = repoRootFromScript()) {
  const configured = typeof env.RUSTSCRIPT_REPO === "string" ? env.RUSTSCRIPT_REPO.trim() : "";
  if (configured.length > 0) {
    return resolve(configured);
  }
  return resolve(repoRoot, "..", "rustscript");
}

export function resolveCargoTargetDir(env = process.env, rustscriptRoot) {
  const configured = typeof env.CARGO_TARGET_DIR === "string" ? env.CARGO_TARGET_DIR.trim() : "";
  if (configured.length > 0) {
    return isAbsolute(configured) ? configured : resolve(rustscriptRoot, configured);
  }
  return resolve(rustscriptRoot, "target");
}

export function compiledWasmArtifactPath(cargoTargetDir, wasmTarget = WASM_TARGET, wasmName = WASM_NAME) {
  return resolve(cargoTargetDir, wasmTarget, "release", wasmName);
}

export function coreRevisionPinPath(repoRoot = repoRootFromScript()) {
  return resolve(repoRoot, "scripts", CORE_REVISION_FILE_NAME);
}

export function parseCoreRevision(raw, label) {
  const revision = String(raw ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error(`${label} must be a 40-character git SHA, got ${JSON.stringify(String(raw ?? ""))}`);
  }
  return revision;
}

export function readPinnedCoreRevision(pinPath) {
  if (!existsSync(pinPath)) {
    throw new Error(`pinned RustScript core revision file not found: ${pinPath}`);
  }
  return parseCoreRevision(readFileSync(pinPath, "utf8"), `pinned core revision at ${pinPath}`);
}

export function resolveExpectedCoreRevision(env = process.env, pinnedRevision) {
  const configured = typeof env.RUSTSCRIPT_CORE_REV === "string" ? env.RUSTSCRIPT_CORE_REV.trim() : "";
  if (configured.length === 0) {
    return pinnedRevision;
  }
  const fromEnv = parseCoreRevision(configured, "RUSTSCRIPT_CORE_REV");
  if (fromEnv !== pinnedRevision) {
    throw new Error(
      `RUSTSCRIPT_CORE_REV ${fromEnv} does not match pinned RustScript core revision ${pinnedRevision}`
    );
  }
  return pinnedRevision;
}

export function assertCoreRevision(actualHead, expectedRevision) {
  const actual = parseCoreRevision(actualHead, "RustScript HEAD");
  if (actual !== expectedRevision) {
    throw new Error(
      `RustScript checkout ${actual} does not match pinned core revision ${expectedRevision}`
    );
  }
  return actual;
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim() ?? "";
    const stdout = result.stdout?.toString().trim() ?? "";
    const detail = stderr || stdout || `exit ${result.status ?? -1}`;
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return result;
}

function runInherited(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? -1}`);
  }
}

function ensureFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} not found: ${path}`);
  }
}

function copyFileTo(from, to, label) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`${label}: ${to}`);
}

export function readGitHead(repoRoot) {
  const result = run("git", ["rev-parse", "HEAD"], repoRoot);
  return result.stdout.toString().trim();
}

export function buildPlaygroundWasm({
  env = process.env,
  repoRoot = repoRootFromScript(),
  runCommand = runInherited
} = {}) {
  const rustscriptRoot = resolveRustscriptRoot(env, repoRoot);
  ensureFile(resolve(rustscriptRoot, "Cargo.toml"), "RustScript repository");

  const pinnedRevision = readPinnedCoreRevision(coreRevisionPinPath(repoRoot));
  const expectedRevision = resolveExpectedCoreRevision(env, pinnedRevision);
  assertCoreRevision(readGitHead(rustscriptRoot), expectedRevision);

  const cargoTargetDir = resolveCargoTargetDir(env, rustscriptRoot);
  const compiledWasmPath = compiledWasmArtifactPath(cargoTargetDir);

  runCommand("rustup", ["target", "add", WASM_TARGET], rustscriptRoot, env);
  runCommand(
    "cargo",
    ["build", "-p", "pd-vm-wasm", "--features", "runtime", "--target", WASM_TARGET, "--release"],
    rustscriptRoot,
    { ...env, CARGO_TARGET_DIR: cargoTargetDir }
  );
  ensureFile(compiledWasmPath, "compiled playground wasm");
  copyFileTo(compiledWasmPath, resolve(repoRoot, "public", "wasm", WASM_NAME), "copied playground wasm");
  return {
    rustscriptRoot,
    cargoTargetDir,
    compiledWasmPath,
    coreRevision: expectedRevision
  };
}

if (import.meta.main) {
  buildPlaygroundWasm();
}
