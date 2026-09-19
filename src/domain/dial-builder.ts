import type { ArsConfig, ArsCase, Credentials, NegativeCase, Step } from './types';

export class SecretInDialStringError extends Error {
  constructor(ref: string) {
    super(
      `SECURE 모드에서는 비밀번호(${ref})를 다이얼 문자열에 넣을 수 없습니다. ` +
        '통화 기록에 평문으로 남기 때문입니다. Android 완전 자동 모드를 쓰거나 수동 입력하세요.',
    );
    this.name = 'SecretInDialStringError';
  }
}

export class NumberNotAllowedError extends Error {
  constructor(number: string) {
    super(`허용 목록에 없는 번호로는 발신할 수 없습니다: ${number}`);
    this.name = 'NumberNotAllowedError';
  }
}

export const normalizeNumber = (raw: string) => raw.replace(/[^0-9*#+]/g, '');

export function assertAllowed(cfg: ArsConfig, number = cfg.number) {
  const target = normalizeNumber(number);
  const allowed = cfg.allowedNumbers.map(normalizeNumber);
  if (!allowed.includes(target)) throw new NumberNotAllowedError(number);
  return target;
}

/**
 * 기본값을 그대로 쓰고 있고 대상이 테스트 환경일 때만 DUMMY 모드를 허용한다.
 * 운영 환경으로 설정이 바뀌면 더미 비밀번호가 새어 나가지 않도록 SECURE로 강등한다.
 */
export function resolveMode(cfg: ArsConfig, pw: string, transferPw: string): Credentials['mode'] {
  const usingDefaults =
    pw === cfg.credentials.accountPw.defaultValue &&
    transferPw === cfg.credentials.transferPw.defaultValue;
  const testEnv = cfg.env === 'test' && cfg.allowedNumbers.map(normalizeNumber).includes(normalizeNumber(cfg.number));
  return usingDefaults && testEnv ? 'DUMMY' : 'SECURE';
}

const PLATFORMS = ['android', 'ios'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** 대기시간을 쉼표 개수로 환산한다. 쉼표 1개의 실제 길이는 플랫폼마다 다르다. */
export function pauseCount(ms: number, unitMs: number) {
  return Math.max(1, Math.ceil(ms / unitMs));
}

const pauses = (ms: number, unitMs: number) => ','.repeat(pauseCount(ms, unitMs));

export interface DialOptions {
  platform: Platform;
  credentials?: Credentials;
}

/**
 * `tel:` 쉼표(post-dial) 다이얼 문자열을 만든다.
 * iOS 전 케이스와 Android 폴백 경로에서 쓴다.
 * Android 완전 자동 모드는 쉼표를 쓰지 않고 통화 연결 뒤 자릿수를 직접 전송한다.
 */
export function buildDialString(
  target: ArsCase | NegativeCase,
  cfg: ArsConfig,
  opts: DialOptions,
): string {
  const number = assertAllowed(cfg);
  const unitMs = cfg.pauseUnitMs[opts.platform];
  const initialMs = ('initialWaitMs' in target && target.initialWaitMs) || cfg.initialWaitMs;
  const interMs = ('interDigitWaitMs' in target && target.interDigitWaitMs) || cfg.interDigitWaitMs;

  let out = `tel:${number}${pauses(initialMs, unitMs)}`;
  let first = true;

  for (const step of target.steps) {
    const chunk = serializeStep(step, cfg, opts);
    if (chunk === null) continue;
    out += (first ? '' : pauses(interMs, unitMs)) + chunk;
    first = false;
  }
  return out;
}

function serializeStep(step: Step, cfg: ArsConfig, opts: DialOptions): string | null {
  switch (step.kind) {
    case 'menu':
      return step.digits;

    case 'wait':
      return pauses(step.ms, cfg.pauseUnitMs[opts.platform]);

    case 'input': {
      const value = opts.credentials?.accountNo;
      if (!value) throw new Error('계좌번호가 입력되지 않았습니다.');
      return value + encodeTerminator(step.terminator);
    }

    case 'secret': {
      const creds = opts.credentials;
      if (!creds) throw new Error('자격증명이 설정되지 않았습니다.');
      // 평문이 통화 기록에 남는 경로이므로, 더미가 아닌 값은 절대 싣지 않는다.
      if (creds.mode === 'SECURE') throw new SecretInDialStringError(step.ref);
      return creds[step.ref] + encodeTerminator(step.terminator);
    }
  }
}

/** `#`은 URI 프래그먼트 구분자라 반드시 퍼센트 인코딩해야 한다. */
function encodeTerminator(t?: string) {
  if (!t) return '';
  return t.replace(/#/g, '%23').replace(/\*/g, '%2A');
}

/** 화면 표시용. SECURE 모드의 비밀번호는 가린다. */
export function buildDialPreview(
  target: ArsCase | NegativeCase,
  cfg: ArsConfig,
  opts: DialOptions,
): string {
  try {
    return buildDialString(target, cfg, opts);
  } catch (e) {
    if (e instanceof SecretInDialStringError) {
      return buildDialString(target, cfg, {
        ...opts,
        credentials: { ...opts.credentials!, mode: 'DUMMY', accountPw: '••••', transferPw: '••••' },
      });
    }
    throw e;
  }
}

/** Android 완전 자동 모드에서 통화 연결 후 한 자리씩 보낼 시퀀스. */
export interface DtmfStep {
  digits: string;
  isSecret: boolean;
  waitMsBefore: number;
  label: string;
}

export function buildDtmfPlan(
  target: ArsCase | NegativeCase,
  cfg: ArsConfig,
  creds: Credentials,
): DtmfStep[] {
  const initialMs = ('initialWaitMs' in target && target.initialWaitMs) || cfg.initialWaitMs;
  const interMs = ('interDigitWaitMs' in target && target.interDigitWaitMs) || cfg.interDigitWaitMs;
  const plan: DtmfStep[] = [];

  for (const step of target.steps) {
    const waitMsBefore = plan.length === 0 ? initialMs : interMs;
    switch (step.kind) {
      case 'menu':
        plan.push({ digits: step.digits, isSecret: false, waitMsBefore, label: `메뉴 ${step.digits}` });
        break;
      case 'input':
        plan.push({
          digits: creds.accountNo + (step.terminator ?? ''),
          isSecret: false,
          waitMsBefore,
          label: '계좌번호',
        });
        break;
      case 'secret':
        plan.push({
          digits: creds[step.ref] + (step.terminator ?? ''),
          isSecret: creds.mode === 'SECURE',
          waitMsBefore,
          label: step.ref === 'accountPw' ? '계좌비밀번호' : '이체비밀번호',
        });
        break;
      case 'wait':
        break;
    }
  }
  return plan;
}
