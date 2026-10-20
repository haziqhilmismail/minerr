// Readers for data from outside the code (JSON replies, files, stored values), which arrives as unknown.

// The value at path inside value, or undefined where the path does not exist.
export const at = (value: unknown, ...path: (string | number)[]): unknown => path.reduce<unknown>(
  (current, key) => (typeof current === 'object' && current !== null ? Reflect.get(current, key) : undefined), value);

export const isList = (value: unknown): value is unknown[] => Array.isArray(value);

export const isStringList = (value: unknown): value is string[] => isList(value) && value.every(item => typeof item === 'string');

// A plain object whose values all pass isValue, for example a stored map of names to strings.
export const isRecordOf = <T>(value: unknown, isValue: (item: unknown) => item is T): value is Record<string, T> =>
  typeof value === 'object' && value !== null && !isList(value) && Object.values(value).every(isValue);

export const isString = (value: unknown): value is string => typeof value === 'string';
