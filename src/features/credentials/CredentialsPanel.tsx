import type { ArsConfig, Credentials } from '../../domain/types';
import { resolveMode } from '../../domain/dial-builder';

interface Props {
  cfg: ArsConfig;
  creds: Credentials;
  onChange: (c: Credentials) => void;
}

/**
 * 계좌번호는 세션마다 입력받고, 비밀번호는 설정의 더미 기본값을 쓴다.
 * 비밀번호를 바꾸는 순간 SECURE 모드로 올라가 보호 정책이 켜진다.
 */
export function CredentialsPanel({ cfg, creds, onChange }: Props) {
  const spec = cfg.credentials;
  const secure = creds.mode === 'SECURE';

  const update = (patch: Partial<Credentials>) => {
    const next = { ...creds, ...patch };
    next.mode = resolveMode(cfg, next.accountPw, next.transferPw);
    onChange(next);
  };

  const digitsOnly = (v: string) => v.replace(/[^0-9]/g, '');
  const accountLen = creds.accountNo.length;
  const accountOk = accountLen === spec.accountNo.digits;

  return (
    <div className="card">
      <h2>
        테스트 자격증명{' '}
        <span className={`badge ${secure ? 'secure' : 'dummy'}`}>{creds.mode} 모드</span>
      </h2>

      <div className="group">
        <label className="field">
          계좌번호 · {spec.accountNo.digits}자리 {accountLen > 0 && !accountOk && `(현재 ${accountLen})`}
        </label>
        <input
          type="text"
          inputMode="numeric"
          placeholder="숫자만 입력 (하이픈 자동 제거)"
          value={creds.accountNo}
          onChange={(e) => update({ accountNo: digitsOnly(e.target.value).slice(0, spec.accountNo.digits) })}
        />
      </div>

      <div className="row">
        <div className="grow">
          <label className="field">계좌비밀번호</label>
          <input
            type={secure ? 'password' : 'text'}
            inputMode="numeric"
            autoComplete="off"
            value={creds.accountPw}
            onChange={(e) => update({ accountPw: digitsOnly(e.target.value).slice(0, spec.accountPw.digits) })}
          />
        </div>
        <div className="grow">
          <label className="field">이체비밀번호</label>
          <input
            type={secure ? 'password' : 'text'}
            inputMode="numeric"
            autoComplete="off"
            value={creds.transferPw}
            onChange={(e) => update({ transferPw: digitsOnly(e.target.value).slice(0, spec.transferPw.digits) })}
          />
        </div>
      </div>

      <p className={`notice ${secure ? 'warn' : ''}`} style={{ marginBottom: 0, marginTop: 10 }}>
        {secure ? (
          <>
            직접 입력한 비밀번호는 비밀로 취급합니다. 화면·로그·내보내기에서 가려지고, 통화 기록에
            남는 쉼표 다이얼에는 실리지 않습니다. iOS에서는 해당 구간을 수동 입력해야 합니다.
          </>
        ) : (
          <>
            설정의 더미 기본값(<code>{spec.accountPw.defaultValue}</code>)을 사용 중입니다. 값을
            수정하면 SECURE 모드로 전환됩니다.
          </>
        )}
      </p>
    </div>
  );
}
