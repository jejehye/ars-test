import { useRef, useState } from 'react';
import type { ArsCase, ArsConfig, Credentials, TestResult } from '../../domain/types';
import type { DialerCapabilities } from '../../platform/ars-dialer';
import { AbortedError, AuthFailureError, isAutoMode, runCaseAuto, sleep } from './engine';

interface Props {
  cases: ArsCase[];
  cfg: ArsConfig;
  creds: Credentials;
  caps: DialerCapabilities;
  onResult: (r: TestResult) => void;
}

/**
 * 선택된 케이스를 순서대로 실행한다. 완전 자동 모드에서만 쓸 수 있다.
 *
 * 인증 실패가 감지되면 즉시 멈춘다. 반복 오입력으로 계좌가 잠기면
 * 이후 케이스가 전부 무의미해지기 때문이다.
 */
export function BatchRunner({ cases, cfg, creds, caps, onResult }: Props) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [current, setCurrent] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [stoppedBy, setStoppedBy] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const auto = isAutoMode(caps);
  const needsAccount =
    cases.some((c) => c.requiresAuth) && creds.accountNo.length !== cfg.credentials.accountNo.digits;

  const append = (line: string) =>
    setLog((l) => [...l.slice(-200), `${new Date().toLocaleTimeString('ko-KR')}  ${line}`]);

  async function start() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setDone(0);
    setLog([]);
    setStoppedBy(null);

    let authFailures = 0;

    for (const [i, target] of cases.entries()) {
      if (ctrl.signal.aborted) break;
      setCurrent(target.id);
      append(`[${i + 1}/${cases.length}] ${target.id} ${target.labels.slice(1).join(' › ')}`);

      try {
        const result = await runCaseAuto({
          target,
          cfg,
          creds,
          caps,
          onLog: append,
          signal: ctrl.signal,
        });
        onResult(result);
        append(`→ ${result.verdict} (${Math.round(result.durationMs / 1000)}s)`);
      } catch (e) {
        if (e instanceof AbortedError) {
          setStoppedBy('사용자 중단');
          break;
        }
        if (e instanceof AuthFailureError) {
          authFailures += 1;
          append(`⚠ ${e.message}`);
          onResult(blocked(target, caps, e.message));
          if (authFailures >= 2) {
            setStoppedBy('인증 연속 실패 — 계좌 잠금을 피하기 위해 중단했습니다.');
            break;
          }
          continue;
        }
        append(`오류: ${(e as Error).message}`);
        onResult(blocked(target, caps, (e as Error).message));
      } finally {
        setDone((d) => d + 1);
      }

      if (i < cases.length - 1) {
        append(`회선 보호 대기 ${cfg.cooldownMs}ms`);
        try {
          await sleep(cfg.cooldownMs, ctrl.signal);
        } catch {
          setStoppedBy('사용자 중단');
          break;
        }
      }
    }

    setCurrent(null);
    setRunning(false);
    abortRef.current = null;
  }

  return (
    <div className="card">
      <h2>배치 실행 · 대상 {cases.length}건</h2>

      {!auto && (
        <p className="notice warn">
          배치 실행은 Android 완전 자동 모드에서만 됩니다. 현재는 케이스를 하나씩 선택해 실행하세요.
        </p>
      )}

      {auto && (
        <>
          <p className="notice">
            예상 소요 약 {estimateMinutes(cases.length, cfg.cooldownMs)}분. 실행 중에는 단말을
            건드리지 마세요. 인증 실패가 두 번 감지되면 자동으로 멈춥니다.
          </p>

          <div className="row">
            <button className="primary" onClick={start} disabled={running || needsAccount || cases.length === 0}>
              {running ? `실행 중 ${done}/${cases.length}` : '배치 시작'}
            </button>
            <button className="danger" onClick={() => abortRef.current?.abort()} disabled={!running}>
              중단
            </button>
            {current && <span className="sub">현재 {current}</span>}
          </div>

          {needsAccount && (
            <p className="notice warn">
              인증이 필요한 케이스가 포함되어 있습니다. 계좌번호를 먼저 입력하세요.
            </p>
          )}
        </>
      )}

      {stoppedBy && <p className="notice warn">중단됨: {stoppedBy}</p>}

      {log.length > 0 && (
        <>
          <label className="field" style={{ marginTop: 12 }}>
            실행 로그
          </label>
          <pre className="dial" style={{ color: 'var(--muted)', maxHeight: 260, overflowY: 'auto' }}>
            {log.join('\n')}
          </pre>
        </>
      )}
    </div>
  );
}

function blocked(target: ArsCase, caps: DialerCapabilities, note: string): TestResult {
  return {
    caseId: target.id,
    verdict: 'BLOCKED',
    startedAt: new Date().toISOString(),
    durationMs: 0,
    dialPreview: '',
    note,
    platform: caps.platform,
    appVersion: '0.1.0',
  };
}

/** 케이스당 통화 약 35초로 어림한다. Phase 0 실측 후 조정한다. */
const estimateMinutes = (n: number, cooldownMs: number) =>
  Math.ceil((n * (35000 + cooldownMs)) / 60000);
