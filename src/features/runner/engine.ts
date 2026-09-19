import type { ArsCase, ArsConfig, Credentials, TestResult, Verdict } from '../../domain/types';
import { buildDialPreview, buildDtmfPlan } from '../../domain/dial-builder';
import { judge, maskDigits } from '../../domain/verdict';
import { ArsDialer, webOs, type DialerCapabilities } from '../../platform/ars-dialer';

export const APP_VERSION = '0.1.0';

/** ARS가 인증 실패를 알릴 때 쓰는 표현. 하나라도 걸리면 배치를 멈춘다. */
const AUTH_FAILURE_PATTERNS = [
  '일치하지',
  '잘못',
  '다시 입력',
  '확인되지',
  '등록되지',
  '오류',
  '제한',
  '정지',
];

export class AuthFailureError extends Error {
  constructor(readonly transcript: string) {
    super('인증에 실패한 것으로 보입니다. 계좌 잠금을 피하기 위해 실행을 중단합니다.');
    this.name = 'AuthFailureError';
  }
}

export class AbortedError extends Error {
  constructor() {
    super('사용자가 실행을 중단했습니다.');
    this.name = 'AbortedError';
  }
}

export interface RunContext {
  target: ArsCase;
  cfg: ArsConfig;
  creds: Credentials;
  caps: DialerCapabilities;
  onLog: (line: string) => void;
  signal?: AbortSignal;
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new AbortedError());
    });
  });

export const isAutoMode = (caps: DialerCapabilities) => caps.autoDial && caps.dtmf;

/**
 * 완전 자동 모드로 한 케이스를 실행한다.
 *
 * 흐름: 발신 → 스피커폰 → 녹음 → (멘트 종료 대기 → DTMF) 반복 → 최종 안내 수집 → 전사 → 판정.
 * VAD를 쓸 수 있으면 멘트가 끝나는 순간에 맞춰 보내고, 아니면 설정된 고정 대기를 쓴다.
 */
export async function runCaseAuto(ctx: RunContext): Promise<TestResult> {
  const { target, cfg, creds, caps, onLog, signal } = ctx;
  const t0 = Date.now();
  const dialPreview = safePreview(ctx);

  const { callId } = await ArsDialer.startCall({ number: cfg.number });
  onLog(`발신 ${cfg.number} · callId=${callId}`);

  let recording = false;
  let transcript = '';

  try {
    await waitForActive(callId, onLog, signal);
    await ArsDialer.setSpeaker({ callId, on: true }).catch(() => onLog('스피커폰 전환 실패 (계속 진행)'));

    if (caps.recording) {
      try {
        await ArsDialer.startRecording({ callId });
        recording = true;
        onLog('녹음 시작');
      } catch (e) {
        onLog(`녹음 불가: ${(e as Error).message}`);
      }
    }

    const plan = buildDtmfPlan(target, cfg, creds);
    for (const step of plan) {
      await waitBeforeStep(step.waitMsBefore, recording && caps.vad, onLog, signal);

      if (step.isSecret && recording) {
        await ArsDialer.pauseRecording({ callId });
        onLog(`${step.label} 전송 (녹음 일시정지)`);
      } else {
        onLog(`${step.label} 전송: ${step.digits}`);
      }
      await ArsDialer.sendDtmf({ callId, digits: step.digits });
      if (step.isSecret && recording) await ArsDialer.resumeRecording({ callId });
    }

    // 주문·이체 케이스는 확정 단계로 더 들어가지 않도록 최종 안내만 짧게 듣고 끊는다.
    const captureMs = target.isFinancialRisk ? 4000 : 9000;
    onLog(`최종 안내 수집 ${captureMs}ms${target.isFinancialRisk ? ' (주문·이체 보호 모드)' : ''}`);
    await waitBeforeStep(captureMs, recording && caps.vad, onLog, signal);

    if (recording) {
      const { path } = await ArsDialer.stopRecording({ callId });
      recording = false;
      if (caps.stt) {
        onLog('전사 중…');
        transcript = (await ArsDialer.transcribe({ path })).text;
        onLog(transcript ? `전사: ${transcript.slice(0, 90)}` : '전사 결과 없음');
      }
    }
  } finally {
    if (recording) await ArsDialer.stopRecording({ callId }).catch(() => {});
    await ArsDialer.endCall({ callId }).catch(() => {});
    onLog('통화 종료');
  }

  if (target.requiresAuth && transcript && looksLikeAuthFailure(transcript)) {
    throw new AuthFailureError(transcript);
  }

  const stored = creds.mode === 'SECURE' ? maskDigits(transcript) : transcript;
  const { verdict, matched } = transcript ? judge(target, transcript) : { verdict: 'REVIEW' as Verdict, matched: [] };

  return {
    caseId: target.id,
    verdict,
    startedAt: new Date(t0).toISOString(),
    durationMs: Date.now() - t0,
    dialPreview,
    transcript: stored || undefined,
    matchedKeywords: matched,
    platform: caps.platform,
    appVersion: APP_VERSION,
  };
}

/** iOS·폴백 경로. 다이얼러를 띄우기만 하고 판정은 사람이 한다. */
export async function runCaseManual(ctx: RunContext): Promise<{ dialPreview: string }> {
  const dialPreview = safePreview(ctx);
  await ArsDialer.startCall({ number: ctx.cfg.number, dialString: dialPreview });
  ctx.onLog('다이얼러를 열었습니다. 통화 버튼을 누른 뒤 안내를 듣고 판정하세요.');
  return { dialPreview };
}

/**
 * 쉼표 1개의 길이가 OS마다 다르다.
 * Capacitor 는 브라우저를 전부 'web' 으로 보고하므로, 그때는 UA 로 판단한다.
 */
export function dialPlatform(caps: DialerCapabilities): 'android' | 'ios' {
  if (caps.platform === 'ios') return 'ios';
  if (caps.platform === 'android') return 'android';
  return webOs() === 'ios' ? 'ios' : 'android';
}

function safePreview({ target, cfg, creds, caps }: RunContext) {
  try {
    return buildDialPreview(target, cfg, {
      platform: dialPlatform(caps),
      credentials: creds,
    });
  } catch (e) {
    return `⚠ ${(e as Error).message}`;
  }
}

/** VAD를 쓸 수 있으면 멘트 종료에 맞추고, 실패하면 고정 대기로 되돌아간다. */
async function waitBeforeStep(
  fallbackMs: number,
  useVad: boolean,
  onLog: (s: string) => void,
  signal?: AbortSignal,
) {
  if (!useVad) return sleep(fallbackMs, signal);
  try {
    const r = await ArsDialer.waitForPrompt({ minWaitMs: 1200, silenceMs: 900, timeoutMs: fallbackMs + 12000 });
    if (r.outcome === 'NO_SPEECH') {
      onLog(`멘트를 듣지 못해 고정 대기 ${fallbackMs}ms로 전환`);
      return sleep(fallbackMs, signal);
    }
    onLog(`멘트 종료 감지 (${r.waitedMs}ms, ${r.outcome})`);
  } catch (e) {
    if (e instanceof AbortedError) throw e;
    onLog(`멘트 감지 실패, 고정 대기 ${fallbackMs}ms`);
    return sleep(fallbackMs, signal);
  }
}

async function waitForActive(callId: string, onLog: (s: string) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      handle?.remove();
      onLog('연결 상태를 확인하지 못했습니다. 그대로 진행합니다.');
      resolve();
    }, 20000);

    let handle: { remove: () => void } | undefined;
    ArsDialer.addListener('callStateChanged', (e) => {
      if (settled || e.callId !== callId) return;
      if (e.state === 'active') {
        settled = true;
        clearTimeout(timer);
        handle?.remove();
        onLog('통화 연결됨');
        resolve();
      } else if (e.state === 'disconnected' || e.state === 'failed') {
        settled = true;
        clearTimeout(timer);
        handle?.remove();
        reject(new Error(`통화가 ${e.state} 상태로 끝났습니다.`));
      }
    }).then((h) => {
      handle = h;
      if (settled) h.remove();
    });

    signal?.addEventListener('abort', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handle?.remove();
      reject(new AbortedError());
    });
  });
}

export const looksLikeAuthFailure = (text: string) =>
  AUTH_FAILURE_PATTERNS.some((p) => text.includes(p));
