import { describe, expect, it } from "vitest";
import { enchantDef } from "../src/enchants.js";
import { allContentTypeIds, contentTypeDecl, registerContentType, validateAllRefs, validateContentInstance } from "../src/registry/generic.js";
import sharpnessJson from "../../../content/flatcraft/enchants/sharpness.json";
import efficiencyJson from "../../../content/flatcraft/enchants/efficiency.json";

describe("generic content-type engine", () => {
  it("registers a type and rejects a duplicate id", () => {
    registerContentType({ id: "test_widget", fields: { id: { kind: "id", required: true } } }, "test");
    expect(contentTypeDecl("test_widget")).toBeDefined();
    expect(allContentTypeIds()).toContain("test_widget");
    expect(() => registerContentType({ id: "test_widget", fields: {} }, "test")).toThrow(/already registered/);
  });

  it("validates scalar, enum, and ref fields", () => {
    registerContentType(
      {
        id: "test_gadget",
        fields: {
          id: { kind: "id", required: true },
          rarity: { kind: "enum", values: ["common", "rare"], required: true },
          uses: { kind: "number", min: 0, max: 100 },
          reusable: { kind: "boolean" },
          crafted_from: { kind: "ref", ref_type: "item" },
        },
      },
      "test",
    );
    const out = validateContentInstance(
      "test_gadget",
      { id: "widget", rarity: "rare", uses: 5, reusable: true, crafted_from: "flatcraft:item:stick" },
      "test",
    );
    expect(out).toEqual({ id: "widget", rarity: "rare", uses: 5, reusable: true, crafted_from: "flatcraft:item:stick" });

    expect(() => validateContentInstance("test_gadget", { id: "widget", rarity: "legendary" }, "test")).toThrow(/must be one of/);
    expect(() => validateContentInstance("test_gadget", { rarity: "common" }, "test")).toThrow(/"\(root\)\.id" is required/);
    expect(() => validateContentInstance("test_gadget", { id: "widget", rarity: "common", nope: 1 }, "test")).toThrow(/unknown field/);
  });

  it("keeps both instance and handler refs verbatim as fully-qualified ids", () => {
    // Regression test: under the uniform "package:type:name" namespacing
    // scheme, both ref kinds are fully-qualified ids and neither is
    // stripped down to a bare tail - the dimension.ts generator/spawns/
    // arrival registries and block/item drop lookups are keyed by the
    // full qualified string (see world/dimension.ts and world/gen.ts).
    registerContentType(
      {
        id: "test_ref_kinds",
        fields: {
          instance_ref: { kind: "ref", ref_type: "item", required: true },
          handler_ref: { kind: "ref", ref_type: "some_handler", ref_kind: "handler", required: true },
        },
      },
      "test",
    );
    const out = validateContentInstance(
      "test_ref_kinds",
      { instance_ref: "flatcraft:item:stick", handler_ref: "flatcraft:dimension_generator:overworld" },
      "test",
    );
    expect(out).toEqual({ instance_ref: "flatcraft:item:stick", handler_ref: "flatcraft:dimension_generator:overworld" });
  });

  it("validates nested object/array/record/oneOf fields", () => {
    registerContentType(
      {
        id: "test_container",
        fields: {
          id: { kind: "id", required: true },
          tags: { kind: "array", items: { kind: "string" } },
          counts: { kind: "record", values: { kind: "number", min: 0, max: 10 } },
          slot: {
            kind: "object",
            fields: { x: { kind: "number", min: 0, max: 10, required: true }, y: { kind: "number", min: 0, max: 10, required: true } },
          },
          drop: {
            kind: "oneOf",
            variants: [{ kind: "literal", value: "none" }, { kind: "object", fields: { item: { kind: "ref", ref_type: "item", required: true } } }],
          },
        },
      },
      "test",
    );
    const out = validateContentInstance(
      "test_container",
      { id: "chest", tags: ["storage", "wood"], counts: { red: 3, blue: 7 }, slot: { x: 1, y: 2 }, drop: "none" },
      "test",
    );
    expect(out).toEqual({ id: "chest", tags: ["storage", "wood"], counts: { red: 3, blue: 7 }, slot: { x: 1, y: 2 }, drop: "none" });

    const out2 = validateContentInstance("test_container", { id: "chest", drop: { item: "flatcraft:item:stick" } }, "test");
    expect(out2["drop"]).toEqual({ item: "flatcraft:item:stick" });

    expect(() => validateContentInstance("test_container", { id: "chest", drop: "invalid" }, "test")).toThrow(/matched none of 2 variants/);
  });

  it("rejects an unregistered type id", () => {
    expect(() => validateContentInstance("nonexistent:type", { id: "x" }, "test")).toThrow(/is not registered/);
  });
});

/**
 * validate.ts's validateAllContent() used to fold in a hand-written
 * validateXReferences() per relationship (multiblock handlers, dimension
 * generators, biome wood/vein refs, item enchants, ...) - one generic
 * validateAllRefs() pass replaces all of them now (see that function's
 * own doc comment for the full history: a full-codebase audit found the
 * "ref" field kind had shipped as a syntax-only check with existence-
 * checking left explicitly deferred, and the deferred half never
 * actually got wired up as more types migrated onto this engine). These
 * tests exercise validateAllRefs directly against synthetic types, so
 * they can't collide with anything real flatcraft content declares.
 */
describe("validateAllRefs", () => {
  it("reports an instance-kind ref that doesn't resolve", () => {
    registerContentType(
      { id: "test_ref_missing_instance", fields: { thing: { kind: "ref", ref_type: "item", required: true } } },
      "test",
    );
    validateContentInstance(
      "test_ref_missing_instance",
      { thing: "flatcraft:item:nobody_registered_this_item_xyz" },
      "test:source:a",
    );
    expect(validateAllRefs().some((p) => p.includes("flatcraft:item:nobody_registered_this_item_xyz"))).toBe(true);
  });

  it("reports a handler-kind ref that doesn't resolve", () => {
    registerContentType(
      {
        id: "test_ref_missing_handler",
        fields: { thing: { kind: "ref", ref_type: "test_unregistered_handler_kind", ref_kind: "handler", required: true } },
      },
      "test",
    );
    validateContentInstance(
      "test_ref_missing_handler",
      { thing: "flatcraft:test_unregistered_handler_kind:nobody" },
      "test:source:b",
    );
    expect(validateAllRefs().some((p) => p.includes("flatcraft:test_unregistered_handler_kind:nobody"))).toBe(true);
  });

  it("reports a ref_type with no registered resolver as its own problem, not a silent pass", () => {
    registerContentType(
      { id: "test_ref_no_resolver", fields: { thing: { kind: "ref", ref_type: "test_totally_unknown_ref_type_xyz", required: true } } },
      "test",
    );
    validateContentInstance(
      "test_ref_no_resolver",
      { thing: "flatcraft:test_totally_unknown_ref_type_xyz:whatever" },
      "test:source:c",
    );
    const problems = validateAllRefs();
    expect(
      problems.some((p) => p.includes('"test_totally_unknown_ref_type_xyz"') && p.includes("no registered existence check")),
    ).toBe(true);
  });
});

// enchants.ts's registerEnchantJson is backed by this same generic engine
// (see enchants.ts) and is the actual production path - test/setup.ts
// already loaded content/flatcraft/enchants/*.json for real before this
// file's tests run, so this just confirms the generic validator produces
// the same fields the already-registered EnchantDef holds, for the real
// enchant JSON files (re-registering here would throw "already
// registered").
describe("enchants.ts's registerEnchantJson, backed by the generic engine", () => {
  it.each([
    ["flatcraft:enchant:sharpness", sharpnessJson],
    ["flatcraft:enchant:efficiency", efficiencyJson],
  ])("produces the same fields as the registered EnchantDef for %s", (id, json) => {
    const generic = validateContentInstance("enchant", json, `flatcraft/enchants/${id}.json`);
    const registered = enchantDef(id)!;
    expect(generic["id"]).toBe(registered.id);
    expect(generic["effect"]).toBe(registered.effect);
    expect(generic["per_level"]).toBe(registered.perLevel);
  });
});
