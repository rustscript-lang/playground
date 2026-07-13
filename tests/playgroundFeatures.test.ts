import { describe, expect, test } from "bun:test";

const mainSource = await Bun.file(new URL("../src/main.ts", import.meta.url)).text();
const shellSource = await Bun.file(new URL("../src/playgroundShell.ts", import.meta.url)).text();
const styleSource = await Bun.file(new URL("../src/style.css", import.meta.url)).text();

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

  test("moves the program selector into a collapsible mobile tools window", () => {
    expect(shellSource).toContain('id="desktop-sample-slot"');
    expect(shellSource).toContain('id="mobile-sample-slot"');
    expect(shellSource).toContain('data-mobile-expanded="false"');
    expect(shellSource).toContain("setMobileExpanded");
    expect(styleSource).toContain('position: fixed;');
    expect(styleSource).toContain('height: 33.333dvh;');
  });

  test("shows the standard lint hover when the mobile cursor enters an error span", () => {
    expect(mainSource).toContain('editor.onDidChangeCursorPosition');
    expect(mainSource).toContain('marker.severity !== monaco.MarkerSeverity.Error');
    expect(mainSource).toContain('editor.action.showHover');
    expect(mainSource).toContain('window.matchMedia("(max-width: 760px)")');
  });
});
