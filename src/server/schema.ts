/**
 * A tiny JSON-Schema subset: enough to describe every tool's arguments, the agents' JSON replies and the
 * HTTP request bodies, and to validate them, with no dependency. The same objects are sent to the model
 * as function-tool `parameters` (they are valid JSON Schema), so the description the model sees and the
 * check the server runs can never drift apart.
 *
 * Supported: object (properties, required, additionalProperties false or a value schema, propertyNames
 * enum, maxProperties), array (items, minItems, maxItems), string (enum, minLength, maxLength, pattern),
 * number / integer (minimum, maximum), boolean, and anyOf. Anything else is deliberately absent.
 */

export type Schema =
  | ObjectSchema
  | RecordSchema
  | ArraySchema
  | StringSchema
  | NumberSchema
  | BooleanSchema
  | AnyOfSchema;

export interface ObjectSchema {
  readonly type: 'object';
  readonly description?: string;
  readonly properties: Readonly<Record<string, Schema>>;
  readonly required?: readonly string[];
  /** Always false for fixed-shape objects: unknown keys are an error, never silently ignored. */
  readonly additionalProperties: false;
}

/** A map with free keys (optionally from an enum) and one value schema, e.g. counts by category. */
export interface RecordSchema {
  readonly type: 'object';
  readonly description?: string;
  readonly propertyNames?: { readonly enum: readonly string[] } | { readonly pattern: string };
  readonly additionalProperties: Schema;
  readonly maxProperties?: number;
}

export interface ArraySchema {
  readonly type: 'array';
  readonly description?: string;
  readonly items: Schema;
  readonly minItems?: number;
  readonly maxItems?: number;
}

export interface StringSchema {
  readonly type: 'string';
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
}

export interface NumberSchema {
  readonly type: 'number' | 'integer';
  readonly description?: string;
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface BooleanSchema {
  readonly type: 'boolean';
  readonly description?: string;
}

export interface AnyOfSchema {
  readonly anyOf: readonly Schema[];
  readonly description?: string;
}

/** Stop collecting after this many errors: a reply that wrong needs rewriting, not a full report. */
const MAX_ERRORS = 8;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isRecordSchema = (s: Schema): s is RecordSchema =>
  'type' in s && s.type === 'object' && typeof s.additionalProperties === 'object';

/** Compiled patterns, cached: schemas are module constants, so this stays tiny. */
const patternCache = new Map<string, RegExp>();
function re(pattern: string): RegExp {
  let r = patternCache.get(pattern);
  if (!r) {
    r = new RegExp(pattern, 'u');
    patternCache.set(pattern, r);
  }
  return r;
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function check(schema: Schema, value: unknown, path: string, errors: string[]): void {
  if (errors.length >= MAX_ERRORS) return;
  if ('anyOf' in schema) {
    // Discriminated unions (claims) are anyOf of objects: report the closest branch's errors so the
    // model gets an actionable message rather than "matched no branch".
    let best: string[] | null = null;
    for (const branch of schema.anyOf) {
      const e: string[] = [];
      check(branch, value, path, e);
      if (e.length === 0) return;
      if (best === null || e.length < best.length) best = e;
    }
    errors.push(...(best ?? [`${path}: matches no allowed shape`]).slice(0, MAX_ERRORS - errors.length));
    return;
  }
  switch (schema.type) {
    case 'object': {
      if (!isPlainObject(value)) {
        errors.push(`${path}: expected object, got ${describe(value)}`);
        return;
      }
      if (isRecordSchema(schema)) {
        const keys = Object.keys(value);
        if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) {
          errors.push(`${path}: at most ${schema.maxProperties} keys`);
          return;
        }
        for (const k of keys) {
          const pn = schema.propertyNames;
          if (pn && 'enum' in pn && !pn.enum.includes(k)) errors.push(`${path}: unknown key "${k.slice(0, 40)}"`);
          else if (pn && 'pattern' in pn && !re(pn.pattern).test(k)) errors.push(`${path}: bad key "${k.slice(0, 40)}"`);
          else check(schema.additionalProperties, value[k], `${path}.${k}`, errors);
          if (errors.length >= MAX_ERRORS) return;
        }
        return;
      }
      for (const req of schema.required ?? []) {
        if (value[req] === undefined) errors.push(`${path}.${req}: required`);
      }
      for (const [k, v] of Object.entries(value)) {
        // Own keys only: a plain lookup would find Object.prototype members ('constructor', 'toString',
        // '__proto__'), which have no `type`, so such a key would pass unchecked.
        const sub = Object.hasOwn(schema.properties, k) ? schema.properties[k] : undefined;
        if (!sub) {
          errors.push(`${path}: unknown key "${k.slice(0, 40)}"`);
          continue;
        }
        if (v === undefined) continue;
        check(sub, v, `${path}.${k}`, errors);
        if (errors.length >= MAX_ERRORS) return;
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array, got ${describe(value)}`);
        return;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(`${path}: at least ${schema.minItems} items`);
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(`${path}: at most ${schema.maxItems} items`);
        return;
      }
      value.forEach((item, i) => check(schema.items, item, `${path}[${i}]`, errors));
      return;
    }
    case 'string': {
      if (typeof value !== 'string') {
        errors.push(`${path}: expected string, got ${describe(value)}`);
        return;
      }
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${path}: must be one of ${schema.enum.slice(0, 12).join(', ')}`);
        return;
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${path}: at least ${schema.minLength} characters`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${path}: at most ${schema.maxLength} characters`);
      }
      if (schema.pattern !== undefined && !re(schema.pattern).test(value)) {
        errors.push(`${path}: bad format`);
      }
      return;
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(`${path}: expected ${schema.type}, got ${describe(value)}`);
        return;
      }
      if (schema.type === 'integer' && !Number.isInteger(value)) errors.push(`${path}: expected integer`);
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
      return;
    }
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path}: expected boolean, got ${describe(value)}`);
      return;
  }
}

/** Validates `value` against `schema`. Returns [] when valid, else up to 8 path-qualified messages. */
export function validate(schema: Schema, value: unknown, path = '$'): string[] {
  const errors: string[] = [];
  check(schema, value, path, errors);
  return errors;
}

// -------------------------------------------------------------------------------------------------
// Small constructors so tool and request schemas read like declarations
// -------------------------------------------------------------------------------------------------

export const obj = (
  properties: Record<string, Schema>,
  required: readonly string[] = [],
  description?: string,
): ObjectSchema => ({ type: 'object', properties, required, additionalProperties: false, ...(description ? { description } : {}) });

export const str = (opts: Omit<StringSchema, 'type'> = {}): StringSchema => ({ type: 'string', ...opts });
export const int = (minimum: number, maximum: number, description?: string): NumberSchema => ({
  type: 'integer',
  minimum,
  maximum,
  ...(description ? { description } : {}),
});
export const num = (minimum: number, maximum: number, description?: string): NumberSchema => ({
  type: 'number',
  minimum,
  maximum,
  ...(description ? { description } : {}),
});
export const bool = (description?: string): BooleanSchema => ({ type: 'boolean', ...(description ? { description } : {}) });
export const arr = (items: Schema, maxItems: number, minItems?: number): ArraySchema => ({
  type: 'array',
  items,
  maxItems,
  ...(minItems !== undefined ? { minItems } : {}),
});
export const oneOfStrings = (values: readonly string[], description?: string): StringSchema => ({
  type: 'string',
  enum: values,
  ...(description ? { description } : {}),
});

/**
 * Ids in the story data are short slugs ('vey-house', 'ch4-vey-kitchen-letter'). Anything with spaces,
 * quotes, slashes or newlines is rejected outright, so an id can never smuggle text into a prompt.
 */
export const ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$';
export const id = (description?: string): StringSchema => ({
  type: 'string',
  pattern: ID_PATTERN,
  maxLength: 64,
  ...(description ? { description } : {}),
});
