import type { ArsCase, Verdict } from './types';

const normalize = (s: string) => s.replace(/[\s.,·/()]/g, '').toLowerCase();

/**
 * STT 전사문으로 케이스 통과 여부를 가늠한다.
 * 애매한 경우는 FAIL이 아니라 REVIEW로 두고 사람이 확인한다.
 */
export function judge(c: ArsCase, transcript: string): { verdict: Verdict; matched: string[] } {
  const haystack = normalize(transcript);
  const keywords = c.expectedKeywords.filter((k) => k.length >= 2);
  if (keywords.length === 0 || haystack.length === 0) return { verdict: 'REVIEW', matched: [] };

  const matched = keywords.filter((k) => haystack.includes(normalize(k)));
  const ratio = matched.length / keywords.length;

  if (ratio >= 0.6) return { verdict: 'PASS', matched };
  if (ratio === 0) return { verdict: 'FAIL', matched };
  return { verdict: 'REVIEW', matched };
}

/** 계좌번호처럼 보이는 숫자열을 전사문에서 가린다. SECURE 모드에서만 쓴다. */
export const maskDigits = (text: string) => text.replace(/\d{4,}/g, (m) => '•'.repeat(m.length));
