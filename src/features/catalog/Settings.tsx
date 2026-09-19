import { useState } from 'react';
import type { ArsConfig } from '../../domain/types';
import { isConfigured } from '../../store/config-store';

export function Settings({ cfg, onSave }: { cfg: ArsConfig; onSave: (c: ArsConfig) => void }) {
  const [draft, setDraft] = useState(cfg);
  const dirty = JSON.stringify(draft) !== JSON.stringify(cfg);

  const set = (patch: Partial<ArsConfig>) => setDraft({ ...draft, ...patch });

  return (
    <div className="card">
      <h2>설정</h2>

      <div className="group">
        <label className="field">발신 번호 (이 단말에만 저장됩니다)</label>
        <input
          type="text"
          inputMode="tel"
          placeholder="02-0000-0000"
          value={draft.number}
          onChange={(e) => set({ number: e.target.value, allowedNumbers: [e.target.value] })}
        />
        {!isConfigured(draft) && (
          <p className="notice warn" style={{ marginBottom: 0 }}>
            발신 번호를 설정해야 테스트를 실행할 수 있습니다.
          </p>
        )}
      </div>

      <div className="row">
        <div className="grow">
          <label className="field">초기 대기 (ms)</label>
          <input
            type="number"
            value={draft.initialWaitMs}
            onChange={(e) => set({ initialWaitMs: Number(e.target.value) })}
          />
        </div>
        <div className="grow">
          <label className="field">단계간 대기 (ms)</label>
          <input
            type="number"
            value={draft.interDigitWaitMs}
            onChange={(e) => set({ interDigitWaitMs: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="row">
        <div className="grow">
          <label className="field">쉼표 1개 = ms (Android)</label>
          <input
            type="number"
            value={draft.pauseUnitMs.android}
            onChange={(e) =>
              set({ pauseUnitMs: { ...draft.pauseUnitMs, android: Number(e.target.value) } })
            }
          />
        </div>
        <div className="grow">
          <label className="field">쉼표 1개 = ms (iOS)</label>
          <input
            type="number"
            value={draft.pauseUnitMs.ios}
            onChange={(e) =>
              set({ pauseUnitMs: { ...draft.pauseUnitMs, ios: Number(e.target.value) } })
            }
          />
        </div>
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <button
          className="ghost"
          onClick={() =>
            set({ pauseUnitMs: { ...draft.pauseUnitMs, verified: !draft.pauseUnitMs.verified } })
          }
        >
          {draft.pauseUnitMs.verified ? '☑' : '☐'} 실측 완료로 표시
        </button>
      </div>

      <p className="notice">
        대기시간 기본값은 추정치입니다. Phase 0 실측 후 이 값을 갱신하고 “실측 완료”를 켜세요.
      </p>

      <button className="primary" onClick={() => onSave(draft)} disabled={!dirty}>
        저장
      </button>
    </div>
  );
}
