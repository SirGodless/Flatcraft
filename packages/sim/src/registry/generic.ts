import { checkKeys, ID_PATTERN, need, needId, needNumber, needOneOf, SchemaError } from "./schema.js";

/**
 * The generic content-type engine: content-defined game-content types
 * (block/item/mob/... - eventually including ones a mod invents that the
 * engine has never heard of) instead of one hand-written `validateXJson`
 * function per type. Two runtime primitives:
 *
 *   registerContentType(rawTypeDeclaration, source)  - declare a new type
 *   validateContentInstance(typeId, rawInstance, source) - validate one
 *     instance of an already-declared type, returning a plain validated
 *     object (never a hand-written TS interface - there isn't one for a
 *     type the engine didn't know about at compile time).
 *
 * A type declaration describes its fields with a small DSL covering the
 * vocabulary registry/schema.ts's hand-written validators already
 * exercise field-by-field: string/number/boolean/enum/id/literal for
 * scalars, object/array/record/oneOf for structure, and `ref` - new here
 * - for "this value must be another type's instance id" (`ref_kind:
 * "instance"`, e.g. a block's drops.item) or "this value must resolve to
 * a registered trusted handler function" (`ref_kind: "handler"`, e.g. a
 * multiblock's handler id). `ref` only checks the value is id-shaped at
 * parse time; confirming it actually resolves to something registered is
 * a deferred, exhaustive pass (mirroring today's validateAllContent()
 * cross-reference checks) added once a real ref-bearing type migrates
 * onto this engine - not yet wired here, to keep this module's first
 * version focused on proving the shape works at all.
 *
 * This is intentionally a *pilot*: only flatcraft:type:enchant is
 * declared through it so far (see data/types/enchant.json and
 * enchants.ts's own validator, kept side-by-side for comparison) -
 * migrating every hand-written validator onto this engine is later work.
 */

export type FieldDecl =
  | { kind: "string" }
  | { kind: "boolean" }
  | { kind: "id" }
  | { kind: "number"; min: number; max: number }
  | { kind: "enum"; values: string[] }
  | { kind: "literal"; value: string }
  | { kind: "object"; fields: Record<string, FieldDecl>; required: string[] }
  | { kind: "array"; items: FieldDecl }
  | { kind: "record"; values: FieldDecl }
  | { kind: "oneOf"; variants: FieldDecl[] }
  | { kind: "ref"; refType: string; refKind: "instance" | "handler" };

export interface TypeDeclaration {
  id: string;
  fields: Record<string, FieldDecl>;
  required: string[];
  /** Opt-in dense numeric storage (e.g. a chunk-array-friendly uint16 id)
   * for types that need it, generalizing the BlockId enum's numeric-id-
   * for-storage/string-id-for-identity split to any future type that
   * wants the same. Not consumed yet in this pilot stage. */
  denseStorage?: { idKind: "uint16" };
}

const FIELD_KINDS = ["string", "boolean", "id", "number", "enum", "literal", "object", "array", "record", "oneOf", "ref"] as const;

function stripRequired(source: string, path: string, raw: Record<string, unknown>): Record<string, unknown> {
  const { required, ...rest } = raw;
  if (required !== undefined) need<boolean>(source, `${path}.required`, required, "boolean");
  return rest;
}

export function parseFieldDecl(raw: unknown, source: string, path: string): FieldDecl {
  const value = need<Record<string, unknown>>(source, path, raw, "object");
  const kind = needOneOf(source, `${path}.kind`, value["kind"], FIELD_KINDS);
  switch (kind) {
    case "string":
    case "boolean":
    case "id":
      checkKeys(source, `${path}.`, value, ["kind"]);
      return { kind };
    case "number": {
      checkKeys(source, `${path}.`, value, ["kind", "min", "max"]);
      const min = value["min"] !== undefined ? needNumber(source, `${path}.min`, value["min"], -Infinity, Infinity) : -Infinity;
      const max = value["max"] !== undefined ? needNumber(source, `${path}.max`, value["max"], -Infinity, Infinity) : Infinity;
      return { kind, min, max };
    }
    case "enum": {
      checkKeys(source, `${path}.`, value, ["kind", "values"]);
      const raw2 = need<unknown[]>(source, `${path}.values`, value["values"], "array");
      return { kind, values: raw2.map((v, i) => need<string>(source, `${path}.values[${i}]`, v, "string")) };
    }
    case "literal":
      checkKeys(source, `${path}.`, value, ["kind", "value"]);
      return { kind, value: need<string>(source, `${path}.value`, value["value"], "string") };
    case "object": {
      checkKeys(source, `${path}.`, value, ["kind", "fields"]);
      const fieldsRaw = need<Record<string, unknown>>(source, `${path}.fields`, value["fields"], "object");
      const fields: Record<string, FieldDecl> = {};
      const required: string[] = [];
      for (const [name, fdRaw] of Object.entries(fieldsRaw)) {
        const fv = need<Record<string, unknown>>(source, `${path}.fields.${name}`, fdRaw, "object");
        if (fv["required"] === true) required.push(name);
        fields[name] = parseFieldDecl(stripRequired(source, `${path}.fields.${name}`, fv), source, `${path}.fields.${name}`);
      }
      return { kind, fields, required };
    }
    case "array":
      checkKeys(source, `${path}.`, value, ["kind", "items"]);
      return { kind, items: parseFieldDecl(value["items"], source, `${path}.items`) };
    case "record":
      checkKeys(source, `${path}.`, value, ["kind", "values"]);
      return { kind, values: parseFieldDecl(value["values"], source, `${path}.values`) };
    case "oneOf": {
      checkKeys(source, `${path}.`, value, ["kind", "variants"]);
      const variantsRaw = need<unknown[]>(source, `${path}.variants`, value["variants"], "array");
      return { kind, variants: variantsRaw.map((v, i) => parseFieldDecl(v, source, `${path}.variants[${i}]`)) };
    }
    case "ref": {
      checkKeys(source, `${path}.`, value, ["kind", "ref_type", "ref_kind"]);
      const refType = needId(source, `${path}.ref_type`, value["ref_type"]);
      const refKind =
        value["ref_kind"] !== undefined ? needOneOf(source, `${path}.ref_kind`, value["ref_kind"], ["instance", "handler"] as const) : "instance";
      return { kind, refType, refKind };
    }
  }
}

export function parseTypeDeclaration(raw: unknown, source: string): TypeDeclaration {
  const value = need<Record<string, unknown>>(source, "(root)", raw, "object");
  checkKeys(source, "", value, ["id", "fields", "dense_storage"]);
  const id = needId(source, "id", value["id"]);
  const fieldsRaw = need<Record<string, unknown>>(source, "fields", value["fields"], "object");
  const fields: Record<string, FieldDecl> = {};
  const required: string[] = [];
  for (const [name, fdRaw] of Object.entries(fieldsRaw)) {
    const fv = need<Record<string, unknown>>(source, `fields.${name}`, fdRaw, "object");
    if (fv["required"] === true) required.push(name);
    fields[name] = parseFieldDecl(stripRequired(source, `fields.${name}`, fv), source, `fields.${name}`);
  }
  const out: TypeDeclaration = { id, fields, required };
  if (value["dense_storage"] !== undefined) {
    const ds = need<Record<string, unknown>>(source, "dense_storage", value["dense_storage"], "object");
    checkKeys(source, "dense_storage.", ds, ["id_kind"]);
    out.denseStorage = { idKind: needOneOf(source, "dense_storage.id_kind", ds["id_kind"], ["uint16"] as const) };
  }
  return out;
}

const TYPES = new Map<string, TypeDeclaration>();

export function registerContentType(raw: unknown, source: string): TypeDeclaration {
  const decl = parseTypeDeclaration(raw, source);
  if (TYPES.has(decl.id)) {
    throw new Error(`content type "${decl.id}" is already registered`);
  }
  TYPES.set(decl.id, decl);
  return decl;
}

export function contentTypeDecl(id: string): TypeDeclaration | undefined {
  return TYPES.get(id);
}

export function allContentTypeIds(): readonly string[] {
  return [...TYPES.keys()];
}

function validateFieldValue(decl: FieldDecl, raw: unknown, source: string, path: string): unknown {
  switch (decl.kind) {
    case "string":
      return need<string>(source, path, raw, "string");
    case "boolean":
      return need<boolean>(source, path, raw, "boolean");
    case "id":
      return needId(source, path, raw);
    case "number":
      return needNumber(source, path, raw, decl.min, decl.max);
    case "enum":
      return needOneOf(source, path, raw, decl.values);
    case "literal": {
      const s = need<string>(source, path, raw, "string");
      if (s !== decl.value) throw new SchemaError(source, `"${path}" must be "${decl.value}", got "${s}"`);
      return s;
    }
    case "ref": {
      // Syntax only for now - see the module doc comment on why existence
      // checking is deferred rather than attempted here. Tolerates (and
      // strips) an optional "flatcraft:" prefix, matching every other
      // ref-like field elsewhere in this codebase (needIngredientRef,
      // multiblock.ts's stripNs) - full <package>:<type>:<name>
      // namespacing isn't rolled out yet, but some existing content
      // (recipe ingredients, trades) already writes plain-namespace-
      // prefixed refs today and this must keep accepting them.
      const s = need<string>(source, path, raw, "string");
      const stripped = s.startsWith("flatcraft:") ? s.slice("flatcraft:".length) : s;
      if (!ID_PATTERN.test(stripped)) {
        throw new SchemaError(source, `"${path}" must be a lowercase snake_case id (optionally "flatcraft:"-prefixed), got "${s}"`);
      }
      return stripped;
    }
    case "array": {
      const arr = need<unknown[]>(source, path, raw, "array");
      return arr.map((v, i) => validateFieldValue(decl.items, v, source, `${path}[${i}]`));
    }
    case "record": {
      const rec = need<Record<string, unknown>>(source, path, raw, "object");
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rec)) out[k] = validateFieldValue(decl.values, v, source, `${path}.${k}`);
      return out;
    }
    case "oneOf": {
      const errors: string[] = [];
      for (const variant of decl.variants) {
        try {
          return validateFieldValue(variant, raw, source, path);
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }
      throw new SchemaError(source, `"${path}" matched none of ${decl.variants.length} variants: ${errors.join("; ")}`);
    }
    case "object": {
      const obj = need<Record<string, unknown>>(source, path, raw, "object");
      checkKeys(source, `${path}.`, obj, Object.keys(decl.fields));
      for (const name of decl.required) {
        if (obj[name] === undefined) throw new SchemaError(source, `"${path}.${name}" is required`);
      }
      const out: Record<string, unknown> = {};
      for (const [name, fieldDecl] of Object.entries(decl.fields)) {
        if (obj[name] === undefined) continue;
        out[name] = validateFieldValue(fieldDecl, obj[name], source, `${path}.${name}`);
      }
      return out;
    }
  }
}

/** Validate one instance of an already-registered content type, returning
 * a plain validated object - the generic replacement for calling e.g.
 * `validateBlockJson` directly, for any type declared through
 * registerContentType instead of hand-written TS. */
export function validateContentInstance(typeId: string, raw: unknown, source: string): Record<string, unknown> {
  const decl = TYPES.get(typeId);
  if (!decl) throw new Error(`content type "${typeId}" is not registered (validating "${source}")`);
  return validateFieldValue({ kind: "object", fields: decl.fields, required: decl.required }, raw, source, "(root)") as Record<string, unknown>;
}
