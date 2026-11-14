import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import grammar from "../src/monaco/rss.tmLanguage.json";

type GrammarPattern = {
  begin?: string;
  include?: string;
  match?: string;
  name?: string;
  patterns?: GrammarPattern[];
  captures?: Record<string, { name: string }>;
};

type GrammarSection = GrammarPattern & {
  end?: string;
};

type Grammar = {
  patterns?: GrammarPattern[];
  repository?: Record<string, GrammarSection>;
};

function repoSection(name: string): GrammarSection {
  const section = (grammar as Grammar).repository?.[name];
  if (!section) {
    throw new Error(`missing grammar section ${name}`);
  }
  return section;
}

function repoPattern(name: string, index = 0): GrammarSection {
  const section = repoSection(name);
  if (!section.patterns?.[index]) {
    throw new Error(`missing grammar pattern ${name}[${index}]`);
  }
  return section.patterns[index];
}

describe("RustScript TextMate grammar", () => {
  test("does not apply root type-annotation rules outside type contexts", () => {
    const rootIncludes = ((grammar as Grammar).patterns ?? [])
      .map((pattern) => pattern.include)
      .filter((value): value is string => typeof value === "string");

    expect(rootIncludes).not.toContain("#type-annotations");
  });

  test("uses contextual begin/end rules for typed lets and function signatures", () => {
    const typedLet = repoPattern("variable-declaration", 0);
    const functionDecl = repoPattern("function-declaration", 0);
    const functionParam = repoPattern("function-parameter", 0);

    expect(typedLet.begin).toBeTruthy();
    expect(functionDecl.begin).toBeTruthy();
    expect(functionParam.begin).toBeTruthy();

    expect(new RegExp(typedLet.begin ?? "").test("let mut detached: ")).toBe(true);
    expect(new RegExp(functionParam.begin ?? "").test("value: ")).toBe(true);
    expect(new RegExp(typedLet.begin ?? "").test("score: closure_value,")).toBe(false);
  });

  test("matches bytes literals before plain strings and supports hex escapes", () => {
    const strings = repoSection("strings");
    const includes = (strings?.patterns ?? [])
      .map((pattern) => pattern.include)
      .filter((value): value is string => typeof value === "string");
    const byteString = repoSection("byte-quoted-string");
    const plainString = repoSection("double-quoted-string");

    expect(includes[0]).toBe("#byte-quoted-string");
    expect(new RegExp(byteString.begin ?? "").test("b\"")).toBe(true);
    expect(new RegExp(byteString.patterns?.[0]?.match ?? "").test("\\x4f")).toBe(true);
    expect(new RegExp(plainString.patterns?.[0]?.match ?? "").test("\\x4f")).toBe(true);
  });

  test("lets declaration headers reuse generic-type-arguments for K/V highlighting", () => {
    const structDecl = repoPattern("struct-declaration", 0);
    const pubFunctionDecl = repoPattern("function-declaration", 0);
    const functionDecl = repoPattern("function-declaration", 1);

    const structIncludes = (structDecl.patterns ?? [])
      .map((pattern) => pattern.include)
      .filter((value): value is string => typeof value === "string");
    const pubFunctionIncludes = (pubFunctionDecl.patterns ?? [])
      .map((pattern) => pattern.include)
      .filter((value): value is string => typeof value === "string");
    const functionIncludes = (functionDecl.patterns ?? [])
      .map((pattern) => pattern.include)
      .filter((value): value is string => typeof value === "string");

    expect(new RegExp(structDecl.begin ?? "").test("struct LruNode")).toBe(true);
    expect(new RegExp(pubFunctionDecl.begin ?? "").test("pub fn append_new_node")).toBe(true);
    expect(new RegExp(functionDecl.begin ?? "").test("fn append_new_node")).toBe(true);

    expect(structIncludes).toContain("#generic-type-arguments");
    expect(pubFunctionIncludes).toContain("#generic-type-arguments");
    expect(functionIncludes).toContain("#generic-type-arguments");
  });

  test("highlights the Unit literal and no longer highlights a null keyword", () => {
    const rootIncludes = ((grammar as Grammar).patterns ?? [])
      .map((pattern) => pattern.include)
      .filter((value): value is string => typeof value === "string");
    const repository = (grammar as Grammar).repository ?? {};

    expect(rootIncludes).toContain("#unit-literal");
    expect(rootIncludes).not.toContain("#null-literal");
    expect(repository).not.toHaveProperty("null-literal");

    const unitLiteral = repoSection("unit-literal");
    expect(unitLiteral.name).toBe("constant.language.unit.rss");

    const unitPattern = new RegExp(unitLiteral.match ?? "");
    expect(unitPattern.test("let unit:() = ();")).toBe(true);
    expect(unitPattern.test("let unit_from_fn:() = nothing();")).toBe(true);
    expect(unitPattern.test("nothing()")).toBe(false);
    expect(unitPattern.test("print(1)")).toBe(false);

    expect(JSON.stringify(grammar)).not.toContain("constant.language.null");
    expect(repository["null-literal"]).toBeUndefined();
  });

  test("scopes Option and Result constructors as typed constructors", () => {
    const constructor = repoSection("option-result-constructor");
    const pattern = new RegExp(constructor.match ?? "");

    expect(constructor.name).toBe("meta.constructor.rss");
    expect(constructor.captures?.["1"]).toEqual({ name: "support.type.rss" });
    expect(constructor.captures?.["3"]).toEqual({ name: "punctuation.accessor.rss" });
    expect(constructor.captures?.["5"]).toEqual({ name: "support.constant.constructor.rss" });

    const some = pattern.exec("Option::Some(0)");
    expect(some?.[1]).toBe("Option");
    expect(some?.[3]).toBe("::");
    expect(some?.[5]).toBe("Some");

    expect(pattern.exec("let empty: Option<int> = Option::None;")?.[5]).toBe("None");
    expect(pattern.exec("Result::Ok(7)")?.[1]).toBe("Result");
    expect(pattern.exec("Result::Ok(7)")?.[5]).toBe("Ok");
    expect(pattern.exec("Result::Err(\"bad\")")?.[5]).toBe("Err");

    expect(pattern.test("Optional::Some(1)")).toBe(false);
    expect(pattern.test("Option::Missing(1)")).toBe(false);
  });

  test("separates ? propagation from ?. optional access", () => {
    const operators = repoSection("operators");
    const propagation = repoSection("propagation-operator");
    const optionalAccess = repoSection("optional-access-operator");

    expect(operators.match ?? "").not.toContain("\\?");

    expect(propagation.name).toBe("keyword.operator.propagation.rss");
    expect(optionalAccess.name).toBe("keyword.operator.optional-access.rss");

    const propagationPattern = new RegExp(propagation.match ?? "");
    expect(propagationPattern.test("let item = value?;")).toBe(true);
    expect(propagationPattern.test("let number = checked(flag)?;")).toBe(true);
    expect(propagationPattern.test("record?.name")).toBe(false);

    const optionalAccessPattern = new RegExp(optionalAccess.match ?? "");
    expect(optionalAccessPattern.test("match record?.name")).toBe(true);
    expect(optionalAccessPattern.test("table?.[\"b\"]")).toBe(true);
    expect(optionalAccessPattern.test("let item = value?;")).toBe(false);
  });

  test("keeps synced grammar copies aligned when sibling copies exist", async () => {
    const siblings = [
      "../../../pd-controller/webui/src/app/monaco/rss.tmLanguage.json",
      "../../../.vscode/rss-language-extension/syntaxes/rss.tmLanguage.json"
    ];
    for (const relativePath of siblings) {
      const path = fileURLToPath(new URL(relativePath, import.meta.url));
      if (!existsSync(path)) {
        continue;
      }
      expect(await Bun.file(path).json()).toEqual(grammar);
    }
  });
});
