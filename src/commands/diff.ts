import { parseSpec } from '../parser/openapi.js';
import type { ParsedOperation, ParsedSpec } from '../types.js';

export interface OperationDiff {
  added: ParsedOperation[];
  removed: ParsedOperation[];
  changed: ChangedOperation[];
  unchanged: number;
}

export interface ChangedOperation {
  operationId: string;
  method: string;
  path: string;
  changes: string[];
}

export interface DiffResult {
  left: { title: string; version: string };
  right: { title: string; version: string };
  operations: OperationDiff;
}

export async function runDiff(leftSource: string, rightSource: string): Promise<DiffResult> {
  const [left, right] = await Promise.all([parseSpec(leftSource), parseSpec(rightSource)]);
  return diffSpecs(left, right);
}

export function diffSpecs(left: ParsedSpec, right: ParsedSpec): DiffResult {
  const leftOps = new Map(left.operations.map((op) => [op.operationId, op]));
  const rightOps = new Map(right.operations.map((op) => [op.operationId, op]));

  const added: ParsedOperation[] = [];
  const removed: ParsedOperation[] = [];
  const changed: ChangedOperation[] = [];
  let unchanged = 0;

  for (const [id, op] of rightOps) {
    if (!leftOps.has(id)) {
      added.push(op);
      continue;
    }
    const leftOp = leftOps.get(id)!;
    const diffs = compareOperation(leftOp, op);
    if (diffs.length > 0) {
      changed.push({
        operationId: id,
        method: op.method,
        path: op.path,
        changes: diffs,
      });
    } else {
      unchanged++;
    }
  }

  for (const [id, op] of leftOps) {
    if (!rightOps.has(id)) removed.push(op);
  }

  return {
    left: { title: left.title, version: left.version },
    right: { title: right.title, version: right.version },
    operations: { added, removed, changed, unchanged },
  };
}

function compareOperation(a: ParsedOperation, b: ParsedOperation): string[] {
  const diffs: string[] = [];
  if (a.method !== b.method) diffs.push(`method: ${a.method} → ${b.method}`);
  if (a.path !== b.path) diffs.push(`path: ${a.path} → ${b.path}`);

  const aParams = new Set(a.parameters.map((p) => `${p.in}:${p.name}`));
  const bParams = new Set(b.parameters.map((p) => `${p.in}:${p.name}`));
  for (const p of bParams) if (!aParams.has(p)) diffs.push(`+ param ${p}`);
  for (const p of aParams) if (!bParams.has(p)) diffs.push(`- param ${p}`);

  const aRequired = new Set(a.parameters.filter((p) => p.required).map((p) => `${p.in}:${p.name}`));
  const bRequired = new Set(b.parameters.filter((p) => p.required).map((p) => `${p.in}:${p.name}`));
  for (const p of bRequired) if (aParams.has(p) && !aRequired.has(p)) diffs.push(`~ ${p} now required`);
  for (const p of aRequired) if (bParams.has(p) && !bRequired.has(p)) diffs.push(`~ ${p} no longer required`);

  const aBody = a.requestBody ? 1 : 0;
  const bBody = b.requestBody ? 1 : 0;
  if (aBody !== bBody) diffs.push(aBody ? '- requestBody removed' : '+ requestBody added');

  return diffs;
}

export function formatDiff(result: DiffResult): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`${result.left.title} v${result.left.version}  →  ${result.right.title} v${result.right.version}`);
  lines.push('');

  const { added, removed, changed, unchanged } = result.operations;
  lines.push(`Added:     ${added.length}`);
  lines.push(`Removed:   ${removed.length}`);
  lines.push(`Changed:   ${changed.length}`);
  lines.push(`Unchanged: ${unchanged}`);
  lines.push('');

  if (added.length > 0) {
    lines.push('Added operations:');
    for (const op of added) lines.push(`  + ${op.operationId}  ${op.method} ${op.path}`);
    lines.push('');
  }

  if (removed.length > 0) {
    lines.push('Removed operations:');
    for (const op of removed) lines.push(`  - ${op.operationId}  ${op.method} ${op.path}`);
    lines.push('');
  }

  if (changed.length > 0) {
    lines.push('Changed operations:');
    for (const c of changed) {
      lines.push(`  ~ ${c.operationId}  ${c.method} ${c.path}`);
      for (const change of c.changes) lines.push(`      ${change}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function hasBreakingChanges(result: DiffResult): boolean {
  if (result.operations.removed.length > 0) return true;
  for (const c of result.operations.changed) {
    if (c.changes.some((s) => s.startsWith('- ') || s.includes('now required') || s.includes('method:') || s.includes('path:'))) {
      return true;
    }
  }
  return false;
}
