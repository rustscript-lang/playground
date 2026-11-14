import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  EXPECTED_RSS_EXAMPLE_COUNT,
  EXPECTED_RSS_EXAMPLE_FILES,
  listCheckedInRssExamples,
  programKeyForRssExample
} from "./rssExampleCorpus";

describe("checked-in RSS playground corpus", () => {
  test("enumerates exactly seven RSS example files", () => {
    const files = listCheckedInRssExamples();
    expect(files).toHaveLength(EXPECTED_RSS_EXAMPLE_COUNT);
    expect(files).toEqual([...EXPECTED_RSS_EXAMPLE_FILES]);
    expect(new Set(files).size).toBe(EXPECTED_RSS_EXAMPLE_COUNT);
  });

  test("registers each RSS example in playgroundConfig", () => {
    const configSource = readFileSync(resolve(import.meta.dir, "../src/playgroundConfig.ts"), "utf8");
    const importMatches = [...configSource.matchAll(/from "\.\/examples\/([^"]+\.rss)\?raw"/g)].map(
      (match) => match[1]
    );
    expect(importMatches.sort()).toEqual([...EXPECTED_RSS_EXAMPLE_FILES]);

    for (const fileName of EXPECTED_RSS_EXAMPLE_FILES) {
      const key = programKeyForRssExample(fileName);
      expect(configSource).toContain(`key: "${key}"`);
      expect(configSource).toContain(`./examples/${fileName}?raw`);
    }

    const registeredKeys = [...configSource.matchAll(/^ {4}key: "([a-z_]+)",$/gm)].map(
      (match) => match[1]!
    );
    const expectedKeys = EXPECTED_RSS_EXAMPLE_FILES.map((fileName) =>
      programKeyForRssExample(fileName)
    );
    expect(registeredKeys).toHaveLength(EXPECTED_RSS_EXAMPLE_COUNT);
    expect(new Set(registeredKeys)).toEqual(new Set(expectedKeys));
    expect(registeredKeys[0]).toBe("complex");
    expect(registeredKeys).toContain("option_result");
    expect(registeredKeys).toContain("callable_values");
  });
});
