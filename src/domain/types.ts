export type Step =
  | { kind: 'menu'; digits: string }
  | { kind: 'input'; ref: 'accountNo'; terminator?: string }
  | { kind: 'secret'; ref: 'accountPw' | 'transferPw'; terminator?: string }
  | { kind: 'wait'; ms: number };

export interface ArsCase {
  id: string;
  seq: number;
  topCode: string;
  dtmf: string;
  depth: 1 | 2 | 3;
  labels: string[];
  isAgentTransfer: boolean;
  isFinancialRisk: boolean;
  requiresAuth: boolean;
  steps: Step[];
  expectedKeywords: string[];
  note?: string;
  /** Phase 0 실측 후 케이스별로 덮어쓴다. */
  initialWaitMs?: number;
  interDigitWaitMs?: number;
}

export interface NegativeCase {
  id: string;
  topCode: string;
  dtmf: string;
  labels: string[];
  expectation: string;
  steps: Step[];
}

export interface MenuData {
  source: { file: string; sheet: string; sha256: string; extractedAt: string };
  cases: ArsCase[];
  negativeCases: NegativeCase[];
}

export interface CredentialSpec {
  accountNo: { required: true; digits: number; terminator?: string };
  accountPw: { defaultValue: string; digits: number; dummy: boolean };
  transferPw: { defaultValue: string; digits: number; dummy: boolean };
}

export interface ArsConfig {
  env: 'test' | 'prod';
  number: string;
  allowedNumbers: string[];
  credentials: CredentialSpec;
  initialWaitMs: number;
  interDigitWaitMs: number;
  cooldownMs: number;
  /**
   * 쉼표 1개가 실제로 몇 ms를 대기하는지. 플랫폼마다 다르므로 Phase 0에서 실측해 채운다.
   * 미확정 상태에서는 통용값 2000을 쓰되 UI에 "미검증"으로 표시한다.
   */
  pauseUnitMs: { android: number; ios: number; verified: boolean };
}

/** 자격증명 취급 수준. 기본값을 그대로 쓰면 DUMMY, 사람이 바꾸면 SECURE. */
export type CredentialMode = 'DUMMY' | 'SECURE';

export interface Credentials {
  accountNo: string;
  accountPw: string;
  transferPw: string;
  mode: CredentialMode;
}

export type Verdict = 'PASS' | 'FAIL' | 'REVIEW' | 'BLOCKED' | 'SKIPPED';

export interface TestResult {
  caseId: string;
  verdict: Verdict;
  startedAt: string;
  durationMs: number;
  dialPreview: string;
  transcript?: string;
  matchedKeywords?: string[];
  note?: string;
  platform: string;
  appVersion: string;
}
