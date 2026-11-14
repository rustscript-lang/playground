import { describe, expect, test } from "bun:test";

import { createRustScriptMonarchLanguage } from "../src/monaco/rustscriptLanguage";
import { EXPECTED_RSS_EXAMPLE_FILES, rssExamplePath } from "./rssExampleCorpus";

/**
 * Tokenizes real RustScript source with Monaco's own Monarch compiler, so these tests cover
 * what the playground editor actually renders instead of only the TextMate JSON regexes.
 * `monarchCompile` is a Monaco internal: if a future monaco-editor upgrade moves it the import
 * below fails loudly, which is the intended signal to re-point it.
 */
const { compile } = (await import(
  "monaco-editor/esm/vs/editor/standalone/common/monarch/monarchCompile.js"
)) as unknown as { compile: (languageId: string, json: unknown) => CompiledLexer };

type CompiledAction = string | { token?: string; next?: string } | { group: CompiledAction[] };

type CompiledRule = {
  matchOnlyAtLineStart: boolean;
  action: CompiledAction;
  resolveRegex(state: string): RegExp;
};

type CompiledLexer = {
  tokenizer: Record<string, CompiledRule[]>;
};

type TokenSpan = {
  token: string;
  value: string;
  start: number;
  end: number;
};

const lexer = compile("rustscript", createRustScriptMonarchLanguage());

function tokenOf(action: CompiledAction): string {
  if (typeof action === "string") {
    return action;
  }
  if (typeof action === "object" && "token" in action && typeof action.token === "string") {
    return action.token;
  }
  return "";
}

function groupOf(action: CompiledAction): CompiledAction[] | null {
  if (typeof action === "object" && "group" in action && Array.isArray(action.group)) {
    return action.group;
  }
  return null;
}

function collectTokens(rule: CompiledRule, matches: RegExpExecArray, offset: number, spans: TokenSpan[]): void {
  const group = groupOf(rule.action);
  if (group) {
    // Monaco refuses rules where the action count does not line up with the capture groups.
    expect(group).toHaveLength(matches.length - 1);
    let cursor = offset;
    for (let index = 1; index < matches.length; index += 1) {
      const token = tokenOf(group[index - 1]);
      const value = matches[index] ?? "";
      if (token.length > 0 && value.length > 0) {
        spans.push({ token, value, start: cursor, end: cursor + value.length });
      }
      cursor += value.length;
    }
    return;
  }

  const token = tokenOf(rule.action);
  if (token.length > 0 && matches[0].length > 0) {
    spans.push({ token, value: matches[0], start: offset, end: offset + matches[0].length });
  }
}

function applyTransition(rule: CompiledRule, state: string, stack: string[]): void {
  // Monarch drops a rule's third element for grouped (array/group) actions, so only plain
  // actions can switch state. Mirroring that keeps these tests honest about the editor.
  if (groupOf(rule.action)) {
    return;
  }
  const next = typeof rule.action === "object" && "next" in rule.action ? rule.action.next : undefined;
  if (typeof next !== "string") {
    return;
  }
  if (next === "@pop") {
    if (stack.length > 1) {
      stack.pop();
    }
    return;
  }
  if (next === "@push") {
    stack.push(state);
    return;
  }
  if (next === "@popall") {
    stack.length = 1;
    return;
  }
  stack.push(next.startsWith("@") ? next.slice(1) : next);
}

function tokenizeSpans(line: string, initialState = "root"): TokenSpan[] {
  const stack = [initialState];
  const spans: TokenSpan[] = [];
  let offset = 0;
  let guard = 0;

  while (offset < line.length) {
    guard += 1;
    if (guard > line.length * 20) {
      throw new Error(`Monarch tokenizer made no progress on ${JSON.stringify(line)}`);
    }

    const state = stack[stack.length - 1];
    const rules = lexer.tokenizer[state];
    if (!rules) {
      throw new Error(`unknown tokenizer state ${state}`);
    }

    const restOfLine = line.slice(offset);
    let advanced = false;
    for (const rule of rules) {
      if (offset !== 0 && rule.matchOnlyAtLineStart) {
        continue;
      }
      const matches = rule.resolveRegex(state).exec(restOfLine);
      if (!matches) {
        continue;
      }
      collectTokens(rule, matches, offset, spans);
      applyTransition(rule, state, stack);
      offset += matches[0].length === 0 ? 1 : matches[0].length;
      advanced = true;
      break;
    }

    if (!advanced) {
      offset += 1;
    }
  }

  return spans;
}

function tokenize(line: string): Array<{ token: string; value: string }> {
  return tokenizeSpans(line).map(({ token, value }) => ({ token, value }));
}

function unitTokens(line: string): Array<{ token: string; value: string }> {
  return tokenize(line).filter((token) => token.token === "constant.language.unit");
}

/** Unit tokens that sit right behind a callee, i.e. the exact `foo()` regression we guard. */
function unitTokensAfterCallee(line: string): TokenSpan[] {
  return tokenizeSpans(line).filter(
    (span) => span.token === "constant.language.unit" && /[A-Za-z0-9_]/.test(line.slice(0, span.start).slice(-1))
  );
}

describe("RustScript Monarch tokenizer", () => {
  test("does not scope null as a keyword or a function", () => {
    for (const line of ["let a = null;", "let fallback = null;", "assert(value == null);"]) {
      const tokens = tokenize(line).filter((token) => token.value === "null");
      expect(tokens).toEqual([]);
      expect(tokenize(line)).not.toContainEqual({ token: "keyword", value: "null" });
    }

    const keywordNullRules = lexer.tokenizer["root"].filter((rule) => {
      const matches = rule.resolveRegex("root").exec("null");
      return matches?.[0] === "null" && tokenOf(rule.action) === "keyword";
    });
    expect(keywordNullRules).toEqual([]);
  });

  test("scopes a standalone Unit literal without swallowing empty argument lists", () => {
    expect(unitTokens("let unit:() = ();")).toEqual([
      { token: "constant.language.unit", value: "()" },
      { token: "constant.language.unit", value: "()" }
    ]);

    // A call's empty argument list stays a call: no Unit token behind the callee.
    const zeroArgumentCalls = [
      "let unit_from_fn:() = nothing();",
      "let unit_from_explicit:() = explicit_unit();",
      "fn make_counter() {",
      "let copied = next_nodes[tail].copy();",
      "let pi = math::pi();",
      "let spaced_call = read_answer () == 42;"
    ];
    for (const line of zeroArgumentCalls) {
      expect(unitTokensAfterCallee(line)).toEqual([]);
      expect(tokenize(line)).toContainEqual({ token: "delimiter", value: "()" });
    }

    // The Unit in type position still highlights, the one in call position does not.
    expect(unitTokens("let unit_from_fn:() = nothing();")).toEqual([{ token: "constant.language.unit", value: "()" }]);
    expect(tokenize("let unit_from_fn:() = nothing();")).toContainEqual({ token: "function", value: "nothing" });

    expect(unitTokens("fn make_counter() {")).toEqual([]);
    expect(unitTokens("let unit = ();")).toEqual([{ token: "constant.language.unit", value: "()" }]);

    const memberCallTokens = tokenize("let copied = next_nodes[tail].copy();");
    expect(memberCallTokens).toContainEqual({ token: "variable", value: "copy" });
    expect(tokenize("let pi = math::pi() / 2.0;")).toContainEqual({ token: "function", value: "pi" });
    expect(unitTokens("let turbofish = apply::<int>(identity, 42);")).toEqual([]);
  });

  test("scopes Option and Result constructors", () => {
    const cases: Array<{ line: string; owner: string; constructor: string }> = [
      { line: "let some = Option::Some(0);", owner: "Option", constructor: "Some" },
      { line: "let none_variant: Option<int> = Option::None;", owner: "Option", constructor: "None" },
      { line: "let ok = Result::Ok(7);", owner: "Result", constructor: "Ok" },
      { line: "let bad = Result::Err(\"bad\");", owner: "Result", constructor: "Err" }
    ];

    for (const { line, owner, constructor } of cases) {
      const tokens = tokenize(line);
      expect(tokens).toContainEqual({ token: "support.type", value: owner });
      expect(tokens).toContainEqual({ token: "punctuation.accessor", value: "::" });
      expect(tokens).toContainEqual({ token: "support.constant.constructor", value: constructor });
      expect(tokens.filter((token) => token.token === "keyword")).toEqual([{ token: "keyword", value: "let" }]);
    }

    expect(tokenize("let wrong = Optional::Some(1);")).not.toContainEqual({
      token: "support.constant.constructor",
      value: "Some"
    });
    expect(tokenize("let wrong = Option::Missing(1);")).not.toContainEqual({
      token: "support.constant.constructor",
      value: "Missing"
    });
  });

  test("separates ? propagation from ?. optional access", () => {
    const propagation = tokenize("let item = checked(flag)?;");
    expect(propagation).toContainEqual({ token: "keyword.operator.propagation", value: "?" });
    expect(propagation).not.toContainEqual({ token: "keyword.operator.optional-access", value: "?." });

    const optionalAccess = tokenize("let name = record?.name;");
    expect(optionalAccess.filter((token) => token.value.includes("?."))).toEqual([
      { token: "keyword.operator.optional-access", value: "?." }
    ]);
    expect(optionalAccess).toContainEqual({ token: "variable", value: "name" });
    expect(optionalAccess).not.toContainEqual({ token: "keyword.operator.propagation", value: "?" });
    // `?.` must not be eaten by the member-access rule.
    expect(optionalAccess.filter((token) => token.token === "punctuation.accessor")).toEqual([]);

    const optionalIndex = tokenize("let bucket = table?.[\"b\"];");
    expect(optionalIndex).toContainEqual({ token: "keyword.operator.optional-access", value: "?." });
    expect(optionalIndex).not.toContainEqual({ token: "keyword.operator.propagation", value: "?" });
  });

  test("keeps member access, declarations and literals intact", () => {
    const memberAccess = tokenize("let row = entry.key;");
    expect(memberAccess).toContainEqual({ token: "punctuation.accessor", value: "." });
    expect(memberAccess).toContainEqual({ token: "variable", value: "key" });

    const declaration = tokenize("let mut detached: LruNode<K, V> = node;");
    expect(declaration).toContainEqual({ token: "keyword", value: "let" });
    expect(declaration).toContainEqual({ token: "keyword", value: "mut" });
    expect(declaration).toContainEqual({ token: "identifier", value: "detached" });
    expect(declaration).toContainEqual({ token: "delimiter", value: ":" });

    const functionDeclaration = tokenize("fn append_new_node<K, V>(nodes, head) {");
    expect(functionDeclaration).toContainEqual({ token: "keyword", value: "fn" });
    expect(functionDeclaration).toContainEqual({ token: "function", value: "append_new_node" });
    expect(functionDeclaration).toContainEqual({ token: "delimiter", value: "(" });

    const bytesLiteral = tokenize("let payload = b\"RSS\\x00\";");
    expect(bytesLiteral).toContainEqual({ token: "string", value: "b\"" });
    expect(bytesLiteral).toContainEqual({ token: "string.escape", value: "\\x00" });

    expect(tokenize("// comment body")).toEqual([{ token: "comment", value: "// comment body" }]);
    expect(tokenize("let flag = true;")).toContainEqual({ token: "keyword", value: "true" });
  });

  test("no example file reads an empty argument list as a Unit literal", async () => {
    const offenders: string[] = [];

    for (const fileName of EXPECTED_RSS_EXAMPLE_FILES) {
      const source = await Bun.file(rssExamplePath(fileName)).text();
      for (const [index, line] of source.split("\n").entries()) {
        for (const span of tokenizeSpans(line)) {
          if (span.token !== "constant.language.unit") {
            continue;
          }
          const preceding = line.slice(0, span.start);
          if (/[A-Za-z0-9_]/.test(preceding.slice(-1))) {
            offenders.push(`${fileName}:${index + 1}: ${line.trim()}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
