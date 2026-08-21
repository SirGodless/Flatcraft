import { hasHandler } from "./handlers.js";
import { checkKeys, need, needId, needNumber, needOneOf, needQualifiedId, SchemaError } from "./schema.js";

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
  /** Every content instance's own top-level id, "<package>:<type>:<name>"
   * (e.g. "flatcraft:item:bow") - see schema.ts's needQualifiedId. Distinct
   * from plain "id" (bare snake_case), which stays for identifiers that
   * are deliberately not one of the namespaced content types (a type
   * declaration's own id, a block's `station` key). */
  | { kind: "qualified_id" }
  /** Opaque passthrough - accepts and returns any JSON value unvalidated.
   * For fields that are deliberately free-form by design (e.g. a
   * multiblock's handler-specific `config` blob, see multiblock.ts's
   * doc comment) - not a shortcut for "haven't written the schema yet". */
  | { kind: "any" }
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

const FIELD_KINDS = ["string", "boolean", "id", "qualified_id", "any", "number", "enum", "literal", "object", "array", "record", "oneOf", "ref"] as const;

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
    case "qualified_id":
    case "any":
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

/**
 * Every content-*instance* registry in this codebase (block/item/mob/
 * dimension/biome/vein/wood/nether_layer/multiblock/enchant/liquid/
 * structure - one Map per type file) used to hand-roll the exact same
 * three lines: check for a duplicate id, throw if found, else store it.
 * That duplication is exactly how three of those copies (block/item/mob)
 * quietly lost the duplicate check during an earlier migration and
 * nobody noticed - found in a later full-codebase audit. One shared
 * store instead of N copies makes that whole bug class structurally
 * impossible to reintroduce: there's no second place left to forget the
 * check in.
 *
 * Deliberately NOT used by world/block.ts: BlockId's dense numeric
 * storage (uint16-sized, enum-reserved ids, dynamic allocation for
 * modded blocks - see that file's own doc comment) has no equivalent
 * here, since every other type here is keyed directly by its qualified
 * string id with no secondary numeric identity to manage. Block still
 * gets the same "throw on a duplicate name" guarantee, just via its own
 * `byName` map directly rather than through this helper.
 */
export interface InstanceStore<T extends { id: string }> {
  /** Throws if `def.id` is already registered - never a silent overwrite. */
  register(def: T): T;
  get(id: string): T | undefined;
  has(id: string): boolean;
  values(): IterableIterator<T>;
  keys(): IterableIterator<string>;
}

/**
 * "Does an instance of ref_type X with this id actually exist?", one
 * resolver per instance-bearing type - the missing half of `ref` field
 * validation (see PENDING_REFS/validateAllRefs below). createInstanceStore
 * registers one of these automatically using its own kindLabel as the
 * ref_type, so every type built on it (which is all of them except
 * world/block.ts - see that function's own doc comment) gets existence-
 * checking for free, with no separate call to remember. A ref_kind
 * "handler" field needs no entry here at all - registry/handlers.ts's
 * hasHandler() is already a single universal check across every handler
 * kind, with no per-type opt-in.
 */
const REF_RESOLVERS = new Map<string, (id: string) => boolean>();

export function registerRefResolver(refType: string, exists: (id: string) => boolean): void {
  if (REF_RESOLVERS.has(refType)) {
    throw new Error(`ref resolver for "${refType}" is already registered`);
  }
  REF_RESOLVERS.set(refType, exists);
}

interface PendingRef {
  refType: string;
  refKind: "instance" | "handler";
  value: string;
  source: string;
  path: string;
}

/** Every `ref` field value validateContentInstance has ever seen,
 * checked for real existence later by validateAllRefs - see that
 * function's own doc comment for why this can't happen eagerly, right
 * where each value is first seen. */
const PENDING_REFS: PendingRef[] = [];

/** Checks every recorded `ref` field value against the actual
 * registries - the generic replacement for a bespoke validateXReferences()
 * per relationship. This was always the point of adding `ref` as a
 * schema primitive (see this module's own history: it shipped as a
 * syntax-only check with existence-checking explicitly deferred, then
 * the deferred half was never actually wired up as more types migrated
 * onto this engine - found by a later full-codebase audit). Call once,
 * after all content has finished loading (see validate.ts's
 * validateAllContent) - not incrementally - since load order between two
 * content types isn't guaranteed (a biome can reference a wood/vein
 * registered in the same pass but not necessarily before it - see
 * world/biome.ts's own doc comment on this exact case).
 *
 * ref_kind "handler" is always checkable (registry/handlers.ts's
 * hasHandler is one universal check across every handler kind, no per-
 * type opt-in needed). ref_kind "instance" needs the referenced type to
 * have called registerRefResolver - createInstanceStore does this
 * automatically for every type built on it, so the only way to end up
 * with no resolver is a `ref_type` that names something with no
 * instance store at all (a typo, or a mod inventing a new type without
 * wiring up existence-checking for it) - reported as its own problem
 * here rather than silently skipped, so that gap can't hide either. */
export function validateAllRefs(): string[] {
  const problems: string[] = [];
  for (const ref of PENDING_REFS) {
    if (ref.refKind === "handler") {
      if (!hasHandler(ref.refType, ref.value)) {
        problems.push(`"${ref.path}" (${ref.source}) references unknown ${ref.refType} "${ref.value}"`);
      }
      continue;
    }
    const resolver = REF_RESOLVERS.get(ref.refType);
    if (!resolver) {
      problems.push(`"${ref.path}" (${ref.source}) declares a ref to type "${ref.refType}", which has no registered existence check`);
    } else if (!resolver(ref.value)) {
      problems.push(`"${ref.path}" (${ref.source}) references unknown ${ref.refType} "${ref.value}"`);
    }
  }
  return problems;
}

export function createInstanceStore<T extends { id: string }>(kindLabel: string): InstanceStore<T> {
  const defs = new Map<string, T>();
  registerRefResolver(kindLabel, (id) => defs.has(id));
  return {
    register(def: T): T {
      if (defs.has(def.id)) {
        throw new Error(`${kindLabel} "${def.id}" is already registered`);
      }
      defs.set(def.id, def);
      return def;
    },
    get: (id) => defs.get(id),
    has: (id) => defs.has(id),
    values: () => defs.values(),
    keys: () => defs.keys(),
  };
}

const TYPES = createInstanceStore<TypeDeclaration>("content type");

export function registerContentType(raw: unknown, source: string): TypeDeclaration {
  return TYPES.register(parseTypeDeclaration(raw, source));
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
    case "qualified_id":
      return needQualifiedId(source, path, raw);
    case "any":
      return raw;
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
      // Both ref kinds are fully-qualified "package:type:name" ids under
      // the uniform namespacing scheme, returned as-is (no stripping) -
      // an instance ref points at another content instance's own
      // qualified id, a handler ref points at a registered trusted
      // handler function (multiblock handlers, dimension generators)
      // keyed the same way. Shape-checked here; existence is checked
      // later, exhaustively, once every type has finished loading (load
      // order between two content types isn't guaranteed - see
      // PENDING_REFS/validateAllRefs below), so every value this engine
      // ever sees in a `ref` field is recorded for that later pass.
      const value = needQualifiedId(source, path, raw);
      PENDING_REFS.push({ refType: decl.refType, refKind: decl.refKind, value, source, path });
      return value;
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
