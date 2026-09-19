import { useEffect, useMemo, useState } from 'react';
import menuData from './assets/ars-menu.json';
import type { ArsCase, ArsConfig, Credentials, MenuData, TestResult } from './domain/types';
import { resolveMode } from './domain/dial-builder';
import { ArsDialer, type DialerCapabilities } from './platform/ars-dialer';
import { loadConfig, saveConfig, isConfigured } from './store/config-store';
import { loadResults, saveResult } from './store/results-store';
import { CaseList, applyFilters, defaultFilters, type Filters } from './features/catalog/CaseList';
import { Settings } from './features/catalog/Settings';
import { CredentialsPanel } from './features/credentials/CredentialsPanel';
import { Runner } from './features/runner/Runner';
import { BatchRunner } from './features/runner/BatchRunner';
import { Report } from './features/report/Report';

const data = menuData as unknown as MenuData;
type Tab = 'cases' | 'run' | 'batch' | 'report' | 'settings';

export default function App() {
  const [cfg, setCfg] = useState<ArsConfig>(loadConfig);
  const [caps, setCaps] = useState<DialerCapabilities | null>(null);
  const [tab, setTab] = useState<Tab>('cases');
  const [selected, setSelected] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [results, setResults] = useState<TestResult[]>(loadResults);

  const [creds, setCreds] = useState<Credentials>(() => {
    const c = loadConfig();
    return {
      accountNo: '',
      accountPw: c.credentials.accountPw.defaultValue,
      transferPw: c.credentials.transferPw.defaultValue,
      mode: 'DUMMY',
    };
  });

  useEffect(() => {
    ArsDialer.getCapabilities().then(setCaps);
  }, []);

  // 설정이 바뀌면 자격증명 모드를 다시 판정한다 (운영 환경 전환 시 SECURE로 강등).
  useEffect(() => {
    setCreds((c) => ({ ...c, mode: resolveMode(cfg, c.accountPw, c.transferPw) }));
  }, [cfg]);

  const byId = useMemo(() => Object.fromEntries(results.map((r) => [r.caseId, r])), [results]);
  const batchTargets = useMemo(
    () => applyFilters(data.cases, filters, byId),
    [filters, byId],
  );
  const target = useMemo<ArsCase | undefined>(
    () => data.cases.find((c) => c.id === selected),
    [selected],
  );

  const persistCfg = (next: ArsConfig) => {
    saveConfig(next);
    setCfg(next);
  };

  const onResult = (r: TestResult) => setResults(saveResult(r));

  const ready = isConfigured(cfg);

  return (
    <div className="app">
      <header className="bar">
        <h1>ARS 메뉴 테스트</h1>
        <div className="target">
          <span>{ready ? cfg.number : '발신 번호 미설정'}</span>
          <span className="badge">{caps?.platform ?? '…'}</span>
          <span className={`badge ${creds.mode === 'SECURE' ? 'secure' : 'dummy'}`}>{creds.mode}</span>
          {caps && <span className="badge">{caps.autoDial && caps.dtmf ? '완전 자동' : '반자동'}</span>}
          {!cfg.pauseUnitMs.verified && <span className="badge warn">대기시간 미검증</span>}
        </div>
      </header>

      <nav className="tabs">
        {(
          [
            ['cases', `케이스 ${data.cases.length}`],
            ['run', '실행'],
            ['batch', '배치'],
            ['report', `결과 ${results.length}`],
            ['settings', '설정'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {!ready && tab !== 'settings' && (
        <div className="card">
          <p className="notice warn" style={{ margin: 0 }}>
            발신 번호가 설정되지 않았습니다. 설정 탭에서 먼저 입력하세요.
          </p>
        </div>
      )}

      {tab === 'cases' && (
        <CaseList
          cases={data.cases}
          results={byId}
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            setTab('run');
          }}
          filters={filters}
          onFilters={setFilters}
        />
      )}

      {tab === 'run' && (
        <>
          <CredentialsPanel cfg={cfg} creds={creds} onChange={setCreds} />
          {target && caps && ready ? (
            <Runner
              target={target}
              cfg={cfg}
              creds={creds}
              caps={caps}
              previous={byId[target.id]}
              onResult={onResult}
            />
          ) : (
            <div className="card">
              <p className="notice" style={{ margin: 0 }}>
                케이스 탭에서 실행할 메뉴를 선택하세요.
              </p>
            </div>
          )}
        </>
      )}

      {tab === 'batch' && (
        <>
          <CredentialsPanel cfg={cfg} creds={creds} onChange={setCreds} />
          {caps && ready ? (
            <BatchRunner
              cases={batchTargets}
              cfg={cfg}
              creds={creds}
              caps={caps}
              onResult={onResult}
            />
          ) : (
            <div className="card">
              <p className="notice" style={{ margin: 0 }}>발신 번호를 먼저 설정하세요.</p>
            </div>
          )}
          <div className="card">
            <p className="notice" style={{ margin: 0 }}>
              배치 대상은 케이스 탭의 필터를 그대로 따릅니다. 현재 {batchTargets.length}건이
              선택되어 있습니다.
            </p>
          </div>
        </>
      )}

      {tab === 'report' && (
        <Report cases={data.cases} results={results} onCleared={() => setResults([])} />
      )}

      {tab === 'settings' && (
        <>
          <Settings cfg={cfg} onSave={persistCfg} />
          <div className="card">
            <h2>원본 시트</h2>
            <p className="notice" style={{ margin: 0 }}>
              {data.source.file} · {data.source.sheet}
              <br />
              sha256 {data.source.sha256.slice(0, 24)}…
              <br />
              추출 {new Date(data.source.extractedAt).toLocaleString('ko-KR')} · 케이스{' '}
              {data.cases.length}건 · 결번 케이스 {data.negativeCases.length}건
            </p>
          </div>
        </>
      )}
    </div>
  );
}
