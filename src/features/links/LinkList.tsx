import { useMemo } from 'react';
import type { ArsCase, ArsConfig, Credentials, TestResult, Verdict } from '../../domain/types';
import { buildDialPreview } from '../../domain/dial-builder';
import { APP_VERSION, dialPlatform } from '../runner/engine';
import { canDial, type DialerCapabilities } from '../../platform/ars-dialer';

interface Props {
  cases: ArsCase[];
  cfg: ArsConfig;
  creds: Credentials;
  caps: DialerCapabilities;
  results: Record<string, TestResult>;
  onResult: (r: TestResult) => void;
}

/**
 * 케이스를 전화 링크 목록으로 펼친다.
 *
 * 전화를 JS 로 거는 대신 실제 `<a href="tel:...">` 를 눌러 걸게 한다.
 * 파일(`file://`)로 연 페이지처럼 스크립트 권한이 제한된 환경에서도
 * 링크 탭은 동작하기 때문이다.
 * 탭 → 통화 → 돌아와서 바로 아래 버튼으로 판정하는 흐름이 가장 빠르다.
 */
export function LinkList({ cases, cfg, creds, caps, results, onResult }: Props) {
  const platform = dialPlatform(caps);
  const dialable = canDial();

  const rows = useMemo(
    () =>
      cases.map((c) => {
        let href = '';
        let error = '';
        try {
          href = buildDialPreview(c, cfg, { platform, credentials: creds });
        } catch (e) {
          error = (e as Error).message;
        }
        const blocked =
          c.requiresAuth && creds.accountNo.length !== cfg.credentials.accountNo.digits;
        return { c, href, error, blocked };
      }),
    [cases, cfg, creds, platform],
  );

  const mark = (c: ArsCase, verdict: Verdict, href: string) =>
    onResult({
      caseId: c.id,
      verdict,
      startedAt: new Date().toISOString(),
      durationMs: 0,
      dialPreview: href,
      platform: caps.platform,
      appVersion: APP_VERSION,
    });

  return (
    <div className="card">
      <h2>전화 링크 {rows.length}건</h2>
      <p className="notice">
        링크를 탭하면 다이얼러가 열립니다. 통화가 끝나면 이 화면으로 돌아와 아래 버튼으로
        판정하세요.
        {!dialable && ' 데스크톱에서는 링크가 동작하지 않습니다 — 휴대폰에서 여세요.'}
      </p>

      <ul className="cases" style={{ borderTop: '1px solid var(--line)', borderRadius: 8 }}>
        {rows.map(({ c, href, error, blocked }) => {
          const r = results[c.id];
          return (
            <li key={c.id} style={{ flexWrap: 'wrap', gap: 6 }}>
              <span className="code">{c.id}</span>
              <span className="grow trunc">
                {c.labels.slice(1).join(' › ') || c.labels[0]}
                {c.requiresAuth && <span className="sub"> · 인증</span>}
              </span>
              {r && <span className={`v ${r.verdict}`}>{r.verdict}</span>}

              {error || blocked ? (
                <span className="sub" style={{ width: '100%', color: 'var(--warn)' }}>
                  {error || `계좌번호 ${cfg.credentials.accountNo.digits}자리를 먼저 입력하세요`}
                </span>
              ) : (
                <>
                  <a className="tel" href={href}>
                    전화
                  </a>
                  <span className="telstr">{href.replace('tel:', '')}</span>
                  <span className="marks">
                    {(['PASS', 'FAIL', 'REVIEW'] as Verdict[]).map((v) => (
                      <button key={v} className="ghost mini" onClick={() => mark(c, v, href)}>
                        {v}
                      </button>
                    ))}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
