import { describe, expect, it } from "vitest";
import { parseContentManifest } from "../src/manifest.js";

describe("parseContentManifest", () => {
  it("parses a valid manifest", () => {
    expect(parseContentManifest({ id: "flatcraft", version: "1.0.0" }, "test")).toEqual({
      id: "flatcraft",
      version: "1.0.0",
    });
  });

  it("rejects a non-object", () => {
    expect(() => parseContentManifest("nope", "test")).toThrow(/must be an object/);
    expect(() => parseContentManifest(null, "test")).toThrow(/must be an object/);
    expect(() => parseContentManifest([1, 2], "test")).toThrow(/must be an object/);
  });

  it("rejects an unknown field", () => {
    expect(() => parseContentManifest({ id: "flatcraft", version: "1.0.0", extra: true }, "test")).toThrow(
      /unknown content\.json field "extra"/,
    );
  });

  it("rejects a non-snake_case id", () => {
    expect(() => parseContentManifest({ id: "FlatCraft", version: "1.0.0" }, "test")).toThrow(/"id"/);
    expect(() => parseContentManifest({ id: "flat craft", version: "1.0.0" }, "test")).toThrow(/"id"/);
    expect(() => parseContentManifest({ version: "1.0.0" }, "test")).toThrow(/"id"/);
  });

  it("rejects a missing or empty version", () => {
    expect(() => parseContentManifest({ id: "flatcraft" }, "test")).toThrow(/"version"/);
    expect(() => parseContentManifest({ id: "flatcraft", version: "" }, "test")).toThrow(/"version"/);
  });
});
