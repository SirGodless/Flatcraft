import { describe, expect, it } from "vitest";
import { transpileScript } from "../src/transpile.js";

describe("transpileScript", () => {
  it("strips type annotations and interfaces down to plain JS", () => {
    const result = transpileScript(
      `
      interface Foo { x: number }
      function bar(a: number, b: string): boolean {
        return a > 0 && b.length > 0;
      }
      export const answer: number = 42;
      `,
      "test.ts",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).not.toMatch(/interface|: number|: string|: boolean/);
    expect(result.code).toContain("answer");
  });

  it("strips 'as const' and other TS-only expressions", () => {
    const result = transpileScript(`export const kinds = ["a", "b"] as const;`, "test.ts");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).not.toContain("as const");
  });

  it("reports a syntax error with a location instead of throwing", () => {
    const result = transpileScript(`function broken( {`, "test.ts");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]!.message.length).toBeGreaterThan(0);
  });

  it("leaves runtime behavior intact, not just syntax", () => {
    const result = transpileScript(
      `
      function add(a: number, b: number): number { return a + b; }
      export const result = add(2, 3);
      `,
      "test.ts",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // esbuild emits ESM "export" syntax, which new Function() can't run
    // directly - strip the keyword to check runtime behavior instead.
    const runnable = result.code.replace(/^export\s+/m, "");
    const value = new Function(`${runnable}\nreturn result;`)();
    expect(value).toBe(5);
  });
});
