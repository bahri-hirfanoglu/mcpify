import { describe, it, expect } from 'vitest';
import {
  parseLinkHeader,
  findNextUrlFromBody,
  findNextCursorFromBody,
  applyCursorToUrl,
  mergePages,
} from '../src/runtime/pagination.js';

describe('parseLinkHeader', () => {
  it('parses rel=next', () => {
    const header = '<https://api/x?page=2>; rel="next", <https://api/x?page=1>; rel="prev"';
    const parsed = parseLinkHeader(header);
    expect(parsed.next).toBe('https://api/x?page=2');
    expect(parsed.prev).toBe('https://api/x?page=1');
  });

  it('handles unquoted rel', () => {
    const header = '<https://api/x?page=2>; rel=next';
    expect(parseLinkHeader(header).next).toBe('https://api/x?page=2');
  });

  it('returns empty when null', () => {
    expect(parseLinkHeader(null)).toEqual({});
  });
});

describe('findNextUrlFromBody', () => {
  it('finds a next field', () => {
    const url = findNextUrlFromBody(
      { next: 'https://api/x?page=2' },
      'https://api/x',
    );
    expect(url).toBe('https://api/x?page=2');
  });

  it('resolves relative URLs', () => {
    const url = findNextUrlFromBody(
      { next: '/v1/pets?page=2' },
      'https://api.example.com/v1/pets',
    );
    expect(url).toBe('https://api.example.com/v1/pets?page=2');
  });

  it('handles HAL-style links.next.href', () => {
    const url = findNextUrlFromBody(
      { links: { next: { href: 'https://api/x?page=2' } } },
      'https://api/x',
    );
    expect(url).toBe('https://api/x?page=2');
  });

  it('returns undefined when nothing matches', () => {
    expect(findNextUrlFromBody({ foo: 'bar' }, 'https://api/x')).toBeUndefined();
  });
});

describe('findNextCursorFromBody', () => {
  it('finds common cursor keys', () => {
    expect(findNextCursorFromBody({ nextCursor: 'abc' })).toBe('abc');
    expect(findNextCursorFromBody({ next_cursor: 'xyz' })).toBe('xyz');
    expect(findNextCursorFromBody({ nextToken: 'tok' })).toBe('tok');
  });

  it('returns undefined when no cursor', () => {
    expect(findNextCursorFromBody({ foo: 'bar' })).toBeUndefined();
  });
});

describe('applyCursorToUrl', () => {
  it('updates existing cursor param', () => {
    const url = applyCursorToUrl('https://api/x?cursor=old', 'new');
    expect(url).toBe('https://api/x?cursor=new');
  });

  it('adds cursor param when absent', () => {
    const url = applyCursorToUrl('https://api/x?limit=10', 'abc');
    expect(url).toContain('cursor=abc');
    expect(url).toContain('limit=10');
  });

  it('uses existing pageToken param name', () => {
    const url = applyCursorToUrl('https://api/x?pageToken=old', 'new');
    expect(url).toBe('https://api/x?pageToken=new');
  });
});

describe('mergePages', () => {
  it('concatenates array pages', () => {
    expect(mergePages([[1, 2], [3, 4]])).toEqual([1, 2, 3, 4]);
  });

  it('merges primary array inside object', () => {
    const merged = mergePages([
      { data: [1, 2], total: 4 },
      { data: [3, 4], total: 4 },
    ]);
    expect(merged).toEqual({ data: [1, 2, 3, 4], total: 4 });
  });

  it('returns single page as-is', () => {
    expect(mergePages([{ data: [1] }])).toEqual({ data: [1] });
  });

  it('handles empty array', () => {
    expect(mergePages([])).toEqual([]);
  });

  it('falls back to pages array when structure unclear', () => {
    const merged = mergePages([{ a: 1 }, { a: 2 }]);
    expect(merged).toEqual([{ a: 1 }, { a: 2 }]);
  });
});
