import type { ArsCase, TestResult, Verdict } from '../../domain/types';
import { clearResults, toCsv } from '../../store/results-store';

const ORDER: Verdict[] = ['PASS', 'FAIL', 'REVIEW', 'BLOCKED', 'SKIPPED'];

export function Report({
  cases,
  results,
  onCleared,
}: {
  cases: ArsCase[];
  results: TestResult[];
  onCleared: () => void;
}) {
  const counts = ORDER.map((v) => [v, results.filter((r) => r.verdict === v).length] as const);
  const untested = cases.length - results.length;

  const download = () => {
    const blob = new Blob(['﻿' + toCsv(results)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ars-test-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div className="card">
        <h2>진행 현황</h2>
        <div className="stats">
          {counts.map(([v, n]) => (
            <span key={v} className={`v ${v}`}>
              {v} {n}
            </span>
          ))}
          <span>미실행 {untested}</span>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" onClick={download} disabled={results.length === 0}>
            CSV 내보내기
          </button>
          <button
            className="danger"
            onClick={() => {
              if (confirm('이 회차 결과를 모두 지웁니다. 계속할까요?')) {
                clearResults();
                onCleared();
              }
            }}
            disabled={results.length === 0}
          >
            결과 초기화
          </button>
        </div>
        <p className="notice" style={{ marginBottom: 0 }}>
          CSV에는 비밀번호가 포함되지 않습니다. SECURE 모드에서 수집한 전사문은 숫자열이 가려진
          상태로 저장됩니다.
        </p>
      </div>

      <div className="card">
        <h2>실행 결과 {results.length}건</h2>
        <ul className="cases" style={{ borderTop: '1px solid var(--line)', borderRadius: 8 }}>
          {[...results]
            .sort((a, b) => a.caseId.localeCompare(b.caseId))
            .map((r) => (
              <li key={r.caseId}>
                <span className="code">{r.caseId}</span>
                <span className="grow trunc">
                  {cases.find((c) => c.id === r.caseId)?.labels.slice(1).join(' › ') ?? ''}
                  {r.note && <span className="sub"> · {r.note}</span>}
                </span>
                <span className="sub">{Math.round(r.durationMs / 1000)}s</span>
                <span className={`v ${r.verdict}`}>{r.verdict}</span>
              </li>
            ))}
        </ul>
        {results.length === 0 && <p className="notice">아직 실행한 케이스가 없습니다.</p>}
      </div>
    </>
  );
}
