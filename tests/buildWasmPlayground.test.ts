import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import {
  assertCoreRevision,
  compiledWasmArtifactPath,
  coreRevisionPinPath,
  parseCoreRevision,
  readPinnedCoreRevision,
  resolveCargoTargetDir,
  resolveExpectedCoreRevision,
  resolveRustscriptRoot,
  WASM_NAME,
  WASM_TARGET
} from "../scripts/build-wasm-playground.mjs";

const PINNED = "b1d6cffede77f49410bf63525f30b9a46b02dc01";
const OTHER = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REPO_ROOT = resolve(import.meta.dir, "..");

describe("wasm playground build contract", () => {
  test("defaults CARGO_TARGET_DIR to the RustScript target directory", () => {
    const rustscriptRoot = "/opt/rustscript";
    expect(resolveCargoTargetDir({}, rustscriptRoot)).toBe(resolve(rustscriptRoot, "target"));
  });

  test("honors an explicit absolute CARGO_TARGET_DIR", () => {
    const rustscriptRoot = "/opt/rustscript";
    const cargoTargetDir = "/mnt/build/slot-1/target";
    expect(resolveCargoTargetDir({ CARGO_TARGET_DIR: cargoTargetDir }, rustscriptRoot)).toBe(
      cargoTargetDir
    );
    expect(compiledWasmArtifactPath(cargoTargetDir)).toBe(
      resolve(cargoTargetDir, WASM_TARGET, "release", WASM_NAME)
    );
  });

  test("resolves a relative CARGO_TARGET_DIR against the RustScript root", () => {
    const rustscriptRoot = "/opt/rustscript";
    expect(resolveCargoTargetDir({ CARGO_TARGET_DIR: "custom-target" }, rustscriptRoot)).toBe(
      resolve(rustscriptRoot, "custom-target")
    );
  });

  test("uses RUSTSCRIPT_REPO when provided", () => {
    expect(resolveRustscriptRoot({ RUSTSCRIPT_REPO: "/opt/frozen-core" }, "/app")).toBe(
      "/opt/frozen-core"
    );
  });

  test("pins the frozen RustScript core revision", () => {
    expect(readPinnedCoreRevision(coreRevisionPinPath(REPO_ROOT))).toBe(PINNED);
  });

  test("rejects a malformed core revision", () => {
    expect(() => parseCoreRevision("not-a-sha", "pinned core revision")).toThrow(
      /40-character git SHA/
    );
  });

  test("rejects RUSTSCRIPT_CORE_REV when it disagrees with the pin", () => {
    expect(() => resolveExpectedCoreRevision({ RUSTSCRIPT_CORE_REV: OTHER }, PINNED)).toThrow(
      /does not match pinned RustScript core revision/
    );
  });

  test("accepts RUSTSCRIPT_CORE_REV when it matches the pin", () => {
    expect(resolveExpectedCoreRevision({ RUSTSCRIPT_CORE_REV: PINNED }, PINNED)).toBe(PINNED);
    expect(resolveExpectedCoreRevision({}, PINNED)).toBe(PINNED);
  });

  test("fails closed when the checkout HEAD is a different core revision", () => {
    expect(() => assertCoreRevision(OTHER, PINNED)).toThrow(/does not match pinned core revision/);
    expect(assertCoreRevision(PINNED, PINNED)).toBe(PINNED);
  });
});
