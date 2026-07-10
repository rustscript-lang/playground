import { describe, expect, test } from "bun:test";

const mainSource = await Bun.file(new URL("../src/main.ts", import.meta.url)).text();
const shellSource = await Bun.file(new URL("../src/playgroundShell.ts", import.meta.url)).text();

describe("playground editor integrations", () => {
  test("loads the Monaco hover contribution when using the slim editor API", () => {
    expect(mainSource).toContain('from "monaco-editor/esm/vs/editor/editor.api"');
    expect(mainSource).toContain(
      'import "monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution"'
    );
  });

  test("describes breakpoints without naming the editor implementation", () => {
    expect(shellSource).toContain(
      "Run or debug directly in wasm runtime with breakpoints, stepping controls, and hover variable inspect."
    );
    expect(shellSource).not.toContain("with Monaco breakpoints");
  });
});
