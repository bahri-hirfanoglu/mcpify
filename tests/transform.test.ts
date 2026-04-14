import { describe, it, expect } from 'vitest';
import { selectFields, parseFieldList } from '../src/runtime/transform.js';

describe('selectFields', () => {
  it('returns data as-is when paths empty', () => {
    expect(selectFields({ a: 1 }, [])).toEqual({ a: 1 });
  });

  it('plucks single top-level key', () => {
    expect(selectFields({ a: 1, b: 2 }, ['a'])).toBe(1);
  });

  it('plucks nested key', () => {
    expect(selectFields({ a: { b: { c: 42 } } }, ['a.b.c'])).toBe(42);
  });

  it('returns object when multiple paths', () => {
    const result = selectFields({ a: 1, b: 2, c: 3 }, ['a', 'b']);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('supports array traversal with []', () => {
    const data = {
      items: [
        { id: 1, name: 'x' },
        { id: 2, name: 'y' },
      ],
    };
    const result = selectFields(data, ['items[].id']);
    expect(result).toEqual([1, 2]);
  });

  it('supports multiple array paths', () => {
    const data = {
      items: [
        { id: 1, name: 'x' },
        { id: 2, name: 'y' },
      ],
    };
    const result = selectFields(data, ['items[].id', 'items[].name']);
    expect(result).toEqual({ id: [1, 2], name: ['x', 'y'] });
  });

  it('returns undefined for missing keys', () => {
    expect(selectFields({ a: 1 }, ['missing'])).toBeUndefined();
  });

  it('handles null gracefully', () => {
    expect(selectFields(null, ['a'])).toBeUndefined();
  });
});

describe('parseFieldList', () => {
  it('splits comma-separated list', () => {
    expect(parseFieldList('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('trims whitespace', () => {
    expect(parseFieldList(' a , b ')).toEqual(['a', 'b']);
  });

  it('returns empty on undefined', () => {
    expect(parseFieldList(undefined)).toEqual([]);
  });

  it('filters empty entries', () => {
    expect(parseFieldList('a,,b')).toEqual(['a', 'b']);
  });
});
