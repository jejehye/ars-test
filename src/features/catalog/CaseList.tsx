import { useMemo } from 'react';
import type { ArsCase, TestResult, Verdict } from '../../domain/types';

interface Props {
  cases: ArsCase[];
  results: Record<string, TestResult>;
  selected: string | null;
  onSelect: (id: string) => void;
  filters: Filters;
  onFilters: (f: Filters) => void;
}

export interface Filters {
  includeAgent: boolean;
  includeFinancial: boolean;
  onlyUntested: boolean;
  query: string;
}

export const defaultFilters: Filters = {
  includeAgent: false,
  includeFinancial: false,
  onlyUntested: false,
  query: '',
};

export function applyFilters(cases: ArsCase[], f: Filters, results: Record<string, TestResult>) {
  const q = f.query.trim().toLowerCase();
  return cases.filter((c) => {
    if (!f.includeAgent && c.isAgentTransfer) return false;
    if (!f.includeFinancial && c.isFinancialRisk) return false;
    if (f.onlyUntested && results[c.id]) return false;
    if (q && !(c.id.includes(q) || c.labels.join(' ').toLowerCase().includes(q))) return false;
    return true;
  });
}

export function CaseList({ cases, results, selected, onSelect, filters, onFilters }: Props) {
  const visible = useMemo(() => applyFilters(cases, filters, results), [cases, filters, results]);

  const groups = useMemo(() => {
    const map = new Map<string, ArsCase[]>();
    for (const c of visible) {
      const key = c.labels[0];
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return [...map.entries()].sort((a, b) => a[1][0].topCode.localeCompare(b[1][0].topCode));
  }, [visible]);

  const toggle = (k: keyof Filters) => onFilters({ ...filters, [k]: !filters[k] });

  return (
    <>
      <div className="card">
        <h2>필터 · {visible.length} / {cases.length}건</h2>
        <input
          type="text"
          placeholder="메뉴명 또는 코드 검색"
          value={filters.query}
          onChange={(e) => onFilters({ ...filters, query: e.target.value })}
        />
        <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 6 }}>
          <button className="ghost" onClick={() => toggle('includeAgent')}>
            {filters.includeAgent ? '☑' : '☐'} 상담원 연결 포함
          </button>
          <button className="ghost" onClick={() => toggle('includeFinancial')}>
            {filters.includeFinancial ? '☑' : '☐'} 주문·이체 포함
          </button>
          <button className="ghost" onClick={() => toggle('onlyUntested')}>
            {filters.onlyUntested ? '☑' : '☐'} 미실행만
          </button>
        </div>
        {filters.includeAgent && (
          <p className="notice warn" style={{ marginBottom: 0 }}>
            상담원 연결 케이스는 실제 상담사에게 연결됩니다. 업무시간 외에 실행하거나 연결 즉시
            종료하세요.
          </p>
        )}
        {filters.includeFinancial && (
          <p className="notice warn" style={{ marginBottom: 0 }}>
            주문·이체 케이스는 실제 체결·송금이 일어날 수 있습니다. 최종 확정 직전에 통화를
            종료하세요.
          </p>
        )}
      </div>

      {groups.map(([top, list]) => (
        <details className="group" key={top} open>
          <summary>
            {top} <span className="sub">· {list.length}건</span>
          </summary>
          <ul className="cases">
            {list.map((c) => {
              const r = results[c.id];
              return (
                <li
                  key={c.id}
                  onClick={() => onSelect(c.id)}
                  style={{
                    cursor: 'pointer',
                    background: selected === c.id ? 'var(--panel-2)' : undefined,
                  }}
                >
                  <span className="code">{c.id}</span>
                  <span className="grow trunc">
                    {c.labels.slice(1).join(' › ') || c.labels[0]}
                    {c.requiresAuth && <span className="sub"> · 인증</span>}
                  </span>
                  {r && <span className={`v ${r.verdict}`}>{r.verdict}</span>}
                </li>
              );
            })}
          </ul>
        </details>
      ))}
    </>
  );
}

export const verdictColor = (v: Verdict) => v;
