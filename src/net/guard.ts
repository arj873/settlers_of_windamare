/**
 * Tiny runtime validators for untrusted JSON (no dependencies). A check returns the value with
 * the expected type or throws `Invalid` naming the path. Objects are rebuilt from known keys,
 * so stray keys (`__proto__`, junk) never reach the engine.
 */

export class Invalid extends Error {
  constructor(
    readonly path: string,
    readonly why: string,
  ) {
    super(`${path}: ${why}`);
  }
}

export type Check<T> = (x: unknown, path: string) => T;

export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function record(x: unknown, path: string): Record<string, unknown> {
  if (!isRecord(x)) throw new Invalid(path, 'expected an object');
  return x;
}

/** Throws if `o` has keys outside `allowed`. */
export function onlyKeys(o: Record<string, unknown>, allowed: readonly string[], path: string) {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) throw new Invalid(`${path}.${k}`, 'unexpected key');
  }
}

export const str =
  (max: number, opts: { min?: number; pattern?: RegExp } = {}): Check<string> =>
  (x, path) => {
    if (typeof x !== 'string') throw new Invalid(path, 'expected a string');
    if (x.length > max) throw new Invalid(path, `longer than ${max}`);
    if (x.length < (opts.min ?? 0)) throw new Invalid(path, `shorter than ${opts.min ?? 0}`);
    if (opts.pattern && !opts.pattern.test(x)) throw new Invalid(path, 'bad format');
    return x;
  };

export const int =
  (min: number, max: number): Check<number> =>
  (x, path) => {
    if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max) {
      throw new Invalid(path, `expected an integer ${min}..${max}`);
    }
    return x;
  };

export const bool: Check<boolean> = (x, path) => {
  if (typeof x !== 'boolean') throw new Invalid(path, 'expected a boolean');
  return x;
};

export const oneOf =
  <T extends string | number>(values: readonly T[]): Check<T> =>
  (x, path) => {
    if (!values.includes(x as T)) throw new Invalid(path, `expected one of ${values.join(', ')}`);
    return x as T;
  };

export const nullable =
  <T>(check: Check<T>): Check<T | null> =>
  (x, path) =>
    x === null ? null : check(x, path);

export const arrayOf =
  <T>(check: Check<T>, max: number): Check<T[]> =>
  (x, path) => {
    if (!Array.isArray(x)) throw new Invalid(path, 'expected an array');
    if (x.length > max) throw new Invalid(path, `more than ${max} items`);
    return x.map((item, i) => check(item, `${path}[${i}]`));
  };

/** `o[key]` through `check`; absent / undefined -> undefined. */
export function optional<T>(
  o: Record<string, unknown>,
  key: string,
  check: Check<T>,
  path: string,
) {
  const x = o[key];
  return x === undefined ? undefined : check(x, `${path}.${key}`);
}

/** `o[key]` through `check` (required). */
export function field<T>(
  o: Record<string, unknown>,
  key: string,
  check: Check<T>,
  path: string,
): T {
  return check(o[key], `${path}.${key}`);
}
