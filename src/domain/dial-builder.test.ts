import { describe, expect, it } from 'vitest';
import menu from '../assets/ars-menu.json';
import {
  NumberNotAllowedError,
  SecretInDialStringError,
  buildDialString,
  buildDtmfPlan,
  resolveMode,
} from './dial-builder';
import type { ArsCase, ArsConfig, Credentials, MenuData } from './types';

const data = menu as unknown as MenuData;

const cfg: ArsConfig = {
  env: 'test',
  number: '02-6301-6001',
  allowedNumbers: ['02-6301-6001'],
  credentials: {
    accountNo: { required: true, digits: 11, terminator: '#' },
    accountPw: { defaultValue: '0000', digits: 4, dummy: true },
    transferPw: { defaultValue: '0000', digits: 4, dummy: true },
  },
  initialWaitMs: 8000,
  interDigitWaitMs: 4000,
  cooldownMs: 3000,
  pauseUnitMs: { android: 2000, ios: 2000, verified: false },
};

const dummy: Credentials = {
  accountNo: '12345678901',
  accountPw: '0000',
  transferPw: '0000',
  mode: 'DUMMY',
};
const secure: Credentials = { ...dummy, accountPw: '1234', mode: 'SECURE' };

const find = (id: string) => data.cases.find((c) => c.id === id) as ArsCase;
const opts = { platform: 'ios' as const, credentials: dummy };

describe('메뉴 데이터', () => {
  it('101개 케이스를 담고 있다', () => {
    expect(data.cases).toHaveLength(101);
  });

  it('모든 케이스의 순번이 1..101로 유일하다', () => {
    const seqs = data.cases.map((c) => c.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 101 }, (_, i) => i + 1));
  });

  it('id와 dtmf가 서로 일치한다', () => {
    for (const c of data.cases) expect(c.id.split('-').join('')).toBe(c.dtmf);
  });
});

describe('다이얼 문자열', () => {
  it('항상 대상 번호로 시작한다', () => {
    for (const c of data.cases) {
      expect(buildDialString(c, cfg, opts).startsWith('tel:0263016001')).toBe(true);
    }
  });

  it('메뉴 전용 케이스를 예상대로 만든다', () => {
    expect(buildDialString(find('1-3-1'), cfg, opts)).toBe('tel:0263016001,,,,1,,3,,1');
    expect(buildDialString(find('7'), cfg, opts)).toBe('tel:0263016001,,,,7');
  });

  it('계좌번호의 # 종단을 %23으로 인코딩한다', () => {
    const dial = buildDialString(find('2-1'), cfg, opts);
    expect(dial).toBe('tel:0263016001,,,,2,,1,,12345678901%23,,0000');
    expect(dial).not.toContain('#');
  });

  it('쉼표 개수가 플랫폼별 pauseUnitMs를 따른다', () => {
    const android = { ...cfg, pauseUnitMs: { android: 3000, ios: 2000, verified: true } };
    expect(buildDialString(find('7'), android, { ...opts, platform: 'android' })).toBe(
      'tel:0263016001,,,7',
    );
  });

  it('SECURE 모드에서는 비밀번호 직렬화를 거부한다', () => {
    expect(() => buildDialString(find('2-1'), cfg, { platform: 'ios', credentials: secure })).toThrow(
      SecretInDialStringError,
    );
  });

  it('허용 목록에 없는 번호는 차단한다', () => {
    const bad = { ...cfg, number: '01012345678' };
    expect(() => buildDialString(find('7'), bad, opts)).toThrow(NumberNotAllowedError);
  });
});

describe('자격증명 모드', () => {
  it('기본값 + 테스트 환경이면 DUMMY', () => {
    expect(resolveMode(cfg, '0000', '0000')).toBe('DUMMY');
  });

  it('비밀번호를 바꾸면 SECURE', () => {
    expect(resolveMode(cfg, '1234', '0000')).toBe('SECURE');
  });

  it('운영 환경이면 기본값이어도 SECURE로 강등한다', () => {
    expect(resolveMode({ ...cfg, env: 'prod' }, '0000', '0000')).toBe('SECURE');
  });
});

describe('Android DTMF 플랜', () => {
  it('인증 케이스를 메뉴/계좌번호/비밀번호 순서로 나눈다', () => {
    const plan = buildDtmfPlan(find('2-1'), cfg, dummy);
    expect(plan.map((p) => p.label)).toEqual(['메뉴 2', '메뉴 1', '계좌번호', '계좌비밀번호']);
    expect(plan[0].waitMsBefore).toBe(8000);
    expect(plan[1].waitMsBefore).toBe(4000);
  });

  it('SECURE 모드의 비밀번호 스텝만 비밀로 표시한다', () => {
    const plan = buildDtmfPlan(find('2-1'), cfg, secure);
    expect(plan.filter((p) => p.isSecret).map((p) => p.label)).toEqual(['계좌비밀번호']);
  });
});
