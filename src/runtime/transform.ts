export function selectFields(data: unknown, paths: string[]): unknown {
  if (paths.length === 0) return data;

  if (paths.length === 1) {
    return pluckPath(data, parsePath(paths[0]));
  }

  const result: Record<string, unknown> = {};
  for (const raw of paths) {
    const segments = parsePath(raw);
    const key = leafKey(segments) ?? raw;
    result[key] = pluckPath(data, segments);
  }
  return result;
}

interface Segment {
  kind: 'key' | 'array';
  name?: string;
}

function parsePath(raw: string): Segment[] {
  const segments: Segment[] = [];
  const parts = raw.split('.');
  for (const part of parts) {
    if (part === '') continue;
    if (part.endsWith('[]')) {
      const name = part.slice(0, -2);
      if (name) segments.push({ kind: 'key', name });
      segments.push({ kind: 'array' });
    } else {
      segments.push({ kind: 'key', name: part });
    }
  }
  return segments;
}

function leafKey(segments: Segment[]): string | undefined {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].kind === 'key') return segments[i].name;
  }
  return undefined;
}

function pluckPath(data: unknown, segments: Segment[]): unknown {
  if (segments.length === 0) return data;
  const [head, ...rest] = segments;

  if (head.kind === 'array') {
    if (!Array.isArray(data)) return undefined;
    return data.map((item) => pluckPath(item, rest));
  }

  if (data == null) return undefined;
  if (Array.isArray(data)) {
    return data.map((item) => pluckPath(item, segments));
  }
  if (typeof data !== 'object') return undefined;
  const obj = data as Record<string, unknown>;
  if (!(head.name! in obj)) return undefined;
  return pluckPath(obj[head.name!], rest);
}

export function parseFieldList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
