import { useMemo, useRef, useState } from 'react';
import type { ArsCase, ArsConfig, Credentials, TestResult, Verdict } from '../../domain/types';
import { SecretInDialStringError, buildDialPreview, buildDtmfPlan } from '../../domain/dial-builder';
import { canDial, webOs, type DialerCapabilities } from '../../platform/ars-dialer';
import { APP_VERSION, AbortedError, AuthFailureError, dialPlatform, isAutoMode, runCaseAuto, runCaseManual } from './engine';

interface Props {
  target: ArsCase;
  cfg: ArsConfig;
  creds: Credentials;
  caps: DialerCapabilities;
  previous?: TestResult;
  onResult: (r: TestResult) => void;
}

export function Runner({ target, cfg, creds, caps, previous, onResult }: Props) {
  const [note, setNote] = useState(previous?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const platform = dialPlatform(caps);
  const auto = isAutoMode(caps);
  const isWeb = caps.platform === 'web';
  const dialable = canDial();

  const append = (line: string) =>
    setLog((l) => [...l, `${new Date().toLocaleTimeString('ko-KR')}  ${line}`]);

  const preview = useMemo(() => {
    try {
      return buildDialPreview(target, cfg, { platform, credentials: creds });
    } catch (e) {
      return `⚠ ${(e as Error).message}`;
    }
  }, [target, cfg, creds, platform]);

  const plan = useMemo(() => buildDtmfPlan(target, cfg, creds), [target, cfg, creds]);

  const needsAccount =
    target.requiresAuth && creds.accountNo.length !== cfg.credentials.accountNo.digits;
  const secureOnDialString = !auto && creds.mode === 'SECURE' && target.requiresAuth;

  async function run() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setLog([]);
    startedAtRef.current = Date.now();

    try {
      if (auto) {
        const result = await runCaseAuto({ target, cfg, creds, caps, onLog: append, signal: ctrl.signal });
        onResult({ ...result, note: note || undefined });
        append(`→ ${result.verdict}`);
      } else {
        await runCaseManual({ target, cfg, creds, caps, onLog: append });
      }
    } catch (e) {
      if (e instanceof AbortedError) {
        append('중단되었습니다.');
      } else {
        append(`오류: ${(e as Error).message}`);
        if (e instanceof AuthFailureError) append('→ 계좌 잠금을 피하려면 자격증명을 먼저 확인하세요.');
        if (e instanceof SecretInDialStringError) append('→ Android 완전 자동 모드를 쓰거나 수동 입력하세요.');
        mark('BLOCKED');
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  const mark = (verdict: Verdict) =>
    onResult({
      caseId: target.id,
      verdict,
      startedAt: new Date(startedAtRef.current ?? Date.now()).toISOString(),
      durationMs: Date.now() - (startedAtRef.current ?? Date.now()),
      dialPreview: preview,
      note: note || undefined,
      platform: caps.platform,
      appVersion: APP_VERSION,
    });

  return (
    <div className="card">
      <h2>
        <span className="code">{target.id}</span>{' '}
        {target.labels.slice(1).join(' › ') || target.labels[0]}
      </h2>

      <div className="stats" style={{ marginBottom: 10 }}>
        <span>{auto ? '완전 자동' : '반자동 · 수동 판정'}</span>
        {isWeb && <span>웹 · {webOs()}</span>}
        <span>{caps.recording ? '녹음 가능' : '녹음 불가'}</span>
        <span>{caps.vad ? '멘트 감지' : '고정 대기'}</span>
        <span>{caps.stt ? 'STT 판정' : 'STT 없음'}</span>
        {target.requiresAuth && <span>인증 필요</span>}
        {target.isAgentTransfer && <span>⚠ 상담원 연결</span>}
        {target.isFinancialRisk && <span>⚠ 주문·이체</span>}
      </div>

      {isWeb && !dialable && (
        <p className="notice warn">
          데스크톱 브라우저에서는 전화를 걸 수 없습니다. 화면과 다이얼 문자열 확인만 가능합니다.
          실제 테스트는 휴대폰 브라우저에서 이 주소를 여세요.
        </p>
      )}

      {!cfg.pauseUnitMs.verified && !auto && (
        <p className="notice warn">
          쉼표 1개의 실제 대기시간이 아직 실측되지 않았습니다(현재 {cfg.pauseUnitMs[platform]}ms
          가정). 타이밍이 어긋날 수 있습니다.
        </p>
      )}

      <label className="field">발신 문자열 미리보기</label>
      <pre className="dial">{preview}</pre>

      {auto && (
        <>
          <label className="field" style={{ marginTop: 10 }}>
            전송 계획 {caps.vad && <span className="sub">· 멘트 종료를 감지해 보냄 (아래는 상한)</span>}
          </label>
          <ul className="cases" style={{ borderTop: '1px solid var(--line)', borderRadius: 8 }}>
            {plan.map((p, i) => (
              <li key={i}>
                <span className="code">{p.waitMsBefore}ms</span>
                <span className="grow">{p.label}</span>
                <span className="sub">{p.isSecret ? '••••' : p.digits}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {needsAccount && (
        <p className="notice warn">
          이 케이스는 인증이 필요합니다. 계좌번호 {cfg.credentials.accountNo.digits}자리를 먼저
          입력하세요.
        </p>
      )}
      {secureOnDialString && (
        <p className="notice warn">
          SECURE 모드에서는 이 플랫폼에서 비밀번호를 자동 입력할 수 없습니다. 안내가 나오면 단말
          키패드로 직접 입력하세요.
        </p>
      )}
      {target.isFinancialRisk && (
        <p className="notice warn">
          주문·이체 메뉴입니다. 최종 안내를 4초만 듣고 통화를 끊어 확정 단계로 들어가지 않습니다.
        </p>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" onClick={run} disabled={busy || needsAccount || !dialable}>
          {busy ? '실행 중…' : '발신'}
        </button>
        {busy && auto && (
          <button className="danger" onClick={() => abortRef.current?.abort()}>
            중단
          </button>
        )}
        <span className="sub">{cfg.number}</span>
      </div>

      {log.length > 0 && (
        <>
          <label className="field" style={{ marginTop: 12 }}>
            실행 로그
          </label>
          <pre className="dial" style={{ color: 'var(--muted)' }}>{log.join('\n')}</pre>
        </>
      )}

      <label className="field" style={{ marginTop: 12 }}>
        메모
      </label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="관찰한 멘트, 이상 동작 등"
      />

      <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        {(['PASS', 'FAIL', 'REVIEW', 'BLOCKED', 'SKIPPED'] as Verdict[]).map((v) => (
          <button key={v} className="ghost" onClick={() => mark(v)}>
            {v}
          </button>
        ))}
      </div>

      {previous && (
        <p className="notice" style={{ marginBottom: 0 }}>
          직전 결과: <span className={`v ${previous.verdict}`}>{previous.verdict}</span>{' '}
          {new Date(previous.startedAt).toLocaleString('ko-KR')}
          {previous.transcript && (
            <>
              <br />
              전사: {previous.transcript.slice(0, 120)}
            </>
          )}
        </p>
      )}
    </div>
  );
}
