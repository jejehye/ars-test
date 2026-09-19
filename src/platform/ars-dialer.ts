import { registerPlugin, Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

export interface DialerCapabilities {
  /** 사용자 개입 없이 발신까지 가능한가 (Android 기본 전화앱 모드) */
  autoDial: boolean;
  /** 통화 연결 후 프로그램으로 DTMF를 보낼 수 있는가 */
  dtmf: boolean;
  /** 통화 중 오디오를 녹음할 수 있는가 (Phase 0에서 실측 확정) */
  recording: boolean;
  /** 녹음본을 텍스트로 옮길 수 있는가 */
  stt: boolean;
  /** 소리 크기로 멘트 종료를 감지할 수 있는가 */
  vad: boolean;
  platform: string;
}

export type PromptOutcome = 'SILENCE_AFTER_SPEECH' | 'TIMEOUT' | 'NO_SPEECH';

export interface PromptResult {
  outcome: PromptOutcome;
  waitedMs: number;
  heardSpeech: boolean;
}

export interface CallStateEvent {
  callId: string;
  state: 'dialing' | 'ringing' | 'active' | 'disconnected' | 'failed';
  at: number;
}

export interface TranscriptEvent {
  callId: string;
  text: string;
}

export interface ArsDialerPlugin {
  getCapabilities(): Promise<DialerCapabilities>;
  requestPermissions(): Promise<DialerCapabilities>;
  /** Android 전용. 기본 전화앱(ROLE_DIALER) 권한을 요청한다. iOS는 항상 false. */
  ensureDialerRole(): Promise<{ granted: boolean }>;
  /** dtmf를 함께 주면 쉼표 다이얼 대신 통화 연결 후 자릿수를 전송한다. */
  startCall(opts: { number: string; dialString?: string }): Promise<{ callId: string }>;
  sendDtmf(opts: { callId: string; digits: string }): Promise<void>;
  setSpeaker(opts: { callId: string; on: boolean }): Promise<void>;
  /** 안내 멘트가 끝날 때까지 기다린다. 고정 대기보다 타이밍 오차가 작다. */
  waitForPrompt(opts: {
    minWaitMs?: number;
    silenceMs?: number;
    timeoutMs?: number;
  }): Promise<PromptResult>;
  startRecording(opts: { callId: string }): Promise<{ path: string }>;
  pauseRecording(opts: { callId: string }): Promise<void>;
  resumeRecording(opts: { callId: string }): Promise<void>;
  stopRecording(opts: { callId: string }): Promise<{ path: string; pcmPath: string }>;
  deleteRecordings(): Promise<void>;
  transcribe(opts: { path: string }): Promise<{ text: string }>;
  endCall(opts: { callId: string }): Promise<void>;
  addListener(
    event: 'callStateChanged',
    cb: (e: CallStateEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(event: 'transcript', cb: (e: TranscriptEvent) => void): Promise<PluginListenerHandle>;
}

/**
 * 웹(브라우저 미리보기) 폴백.
 * 발신 능력이 없으므로 화면은 자동으로 수동 판정 모드로 떨어진다.
 */
const webFallback: ArsDialerPlugin = {
  async getCapabilities() {
    return { autoDial: false, dtmf: false, recording: false, stt: false, vad: false, platform: 'web' };
  },
  async requestPermissions() {
    return this.getCapabilities();
  },
  async ensureDialerRole() {
    return { granted: false };
  },
  async startCall({ dialString, number }) {
    const href = dialString ?? `tel:${number}`;
    // 모바일 브라우저에서 가장 안정적으로 다이얼러가 뜨는 방식.
    // location.href 대입이나 window.open 은 iOS Safari 에서 팝업 차단에 걸리는 경우가 있다.
    const a = document.createElement('a');
    a.href = href;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return { callId: `web-${Date.now()}` };
  },
  async sendDtmf() {
    throw new Error('웹에서는 DTMF를 전송할 수 없습니다.');
  },
  async setSpeaker() {},
  async waitForPrompt(): Promise<PromptResult> {
    throw new Error('웹에서는 멘트 종료를 감지할 수 없습니다.');
  },
  async startRecording() {
    throw new Error('웹에서는 통화 녹음을 할 수 없습니다.');
  },
  async pauseRecording() {},
  async resumeRecording() {},
  async stopRecording() {
    return { path: '', pcmPath: '' };
  },
  async deleteRecordings() {},
  async transcribe() {
    return { text: '' };
  },
  async endCall() {},
  async addListener() {
    return { remove: async () => {} } as PluginListenerHandle;
  },
};

export const ArsDialer = registerPlugin<ArsDialerPlugin>('ArsDialer', { web: webFallback });

export const platform = () => Capacitor.getPlatform() as 'android' | 'ios' | 'web';
export const isNative = () => Capacitor.isNativePlatform();

/**
 * 브라우저에서 돌 때 어느 OS인지. 쉼표 대기시간이 OS마다 다르므로 필요하다.
 * Capacitor 는 브라우저를 전부 'web' 으로 보고하기 때문에 UA 로 따로 구분한다.
 */
export function webOs(): 'android' | 'ios' | 'desktop' {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  // iPadOS 는 데스크톱 Safari 로 위장하므로 터치 지원 여부로 걸러낸다.
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  return 'desktop';
}

/** 이 브라우저에서 전화 발신이 의미 있는가. 데스크톱에서는 tel: 이 사실상 무동작이다. */
export const canDial = () => isNative() || webOs() !== 'desktop';
