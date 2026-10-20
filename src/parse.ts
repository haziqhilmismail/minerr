// Readers for data from outside the code (JSON replies, files, stored values), which arrives as unknown.

// The value at path inside value, or undefined where the path does not exist.
export const at = (value: unknown, ...path: (string | number)[]): unknown => path.reduce<unknown>(
  (current, key) => (typeof current === 'object' && current !== null ? Reflect.get(current, key) : undefined), value);

export const isList = (value: unknown): value is unknown[] => Array.isArray(value);

export const isStringList = (value: unknown): value is string[] => isList(value) && value.every(item => typeof item === 'string');
