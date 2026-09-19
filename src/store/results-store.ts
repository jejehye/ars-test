import type { TestResult } from '../domain/types';
import { storage } from './safe-storage';

const KEY = 'ars-test.results';

export const loadResults = (): TestResult[] => {
  try {
    return JSON.parse(storage.get(KEY) ?? '[]') as TestResult[];
  } catch {
    return [];
  }
};

export function saveResult(r: TestResult) {
  const all = loadResults().filter((x) => x.caseId !== r.caseId);
  all.push(r);
  storage.set(KEY, JSON.stringify(all));
  return all;
}

export const clearResults = () => storage.remove(KEY);

export function toCsv(results: TestResult[]): string {
  const head = [
    'caseId',
    'verdict',
    'startedAt',
    'durationMs',
    'dialPreview',
    'matchedKeywords',
    'note',
    'platform',
    'appVersion',
  ];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = results.map((r) =>
    [
      r.caseId,
      r.verdict,
      r.startedAt,
      r.durationMs,
      r.dialPreview,
      (r.matchedKeywords ?? []).join(' '),
      r.note,
      r.platform,
      r.appVersion,
    ]
      .map(esc)
      .join(','),
  );
  return [head.join(','), ...rows].join('\n');
}
