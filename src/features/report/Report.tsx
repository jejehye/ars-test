import { useState } from 'react';
import type { ArsCase, TestResult, Verdict } from '../../domain/types';
import { clearResults, toCsv } from '../../store/results-store';
import { isPersistent } from '../../store/safe-storage';

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
  const [csv, setCsv] = useState<string | null>(null);
  const counts = ORDER.map((v) => [v, results.filter((r) => r.verdict === v).length] as const);
  const untested = cases.length - results.length;

  // 파일로 연 페이지에서는 Blob 다운로드가 막히는 경우가 있어 본문 표시로도 꺼낼 수 있게 한다.
  const showCsv = () => setCsv(toCsv(results));
  const copyCsv = async () => {
    const text = toCsv(results);
    try {
      await navigator.clipboard.writeText(text);
      alert('결과를 클립보드에 복사했습니다.');
    } catch {
      setCsv(text);
    }
  };

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
        {!isPersistent() && (
          <p className="notice warn">
            이 환경에서는 결과가 저장되지 않습니다. 화면을 닫으면 사라지니, 끝내기 전에 아래에서
            CSV를 복사해 두세요.
          </p>
        )}

        <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <button className="primary" onClick={download} disabled={results.length === 0}>
            CSV 내려받기
          </button>
          <button className="ghost" onClick={copyCsv} disabled={results.length === 0}>
            복사
          </button>
          <button className="ghost" onClick={showCsv} disabled={results.length === 0}>
            본문 보기
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
        {csv && (
          <>
            <label className="field" style={{ marginTop: 12 }}>
              CSV — 길게 눌러 전체 선택 후 복사하세요
            </label>
            <textarea readOnly value={csv} style={{ minHeight: 160 }} onFocus={(e) => e.currentTarget.select()} />
          </>
        )}

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
