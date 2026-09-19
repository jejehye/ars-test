import { describe, expect, it } from 'vitest';
import menu from '../assets/ars-menu.json';
import { judge, maskDigits } from './verdict';
import { looksLikeAuthFailure } from '../features/runner/engine';
import type { ArsCase, MenuData } from './types';

const data = menu as unknown as MenuData;
const find = (id: string) => data.cases.find((c) => c.id === id) as ArsCase;

describe('판정', () => {
  it('기대 키워드가 충분히 나오면 PASS', () => {
    const c = find('1-3-1'); // 호가정보
    expect(judge(c, '호가 정보를 안내해 드리겠습니다.').verdict).toBe('PASS');
  });

  it('전혀 다른 멘트면 FAIL', () => {
    expect(judge(find('1-3-1'), '청약 경쟁률을 안내합니다.').verdict).toBe('FAIL');
  });

  it('일부만 맞으면 REVIEW', () => {
    const c = find('5-1-9'); // 공모주 입고계좌 변경
    expect(judge(c, '공모주 안내입니다').verdict).toBe('REVIEW');
  });

  it('전사문이 비어 있으면 사람이 보도록 REVIEW', () => {
    expect(judge(find('1-1'), '').verdict).toBe('REVIEW');
  });

  it('띄어쓰기·문장부호 차이를 무시한다', () => {
    expect(judge(find('2-1'), '자산 평가 금액 안내입니다').verdict).toBe('PASS');
  });
});

describe('마스킹', () => {
  it('네 자리 이상 숫자열을 가린다', () => {
    expect(maskDigits('계좌번호 12345678901 확인')).toBe('계좌번호 ••••••••••• 확인');
  });

  it('짧은 숫자는 남긴다', () => {
    expect(maskDigits('3번을 누르세요')).toBe('3번을 누르세요');
  });
});

describe('인증 실패 감지', () => {
  it.each([
    '비밀번호가 일치하지 않습니다',
    '입력하신 정보가 확인되지 않습니다',
    '등록되지 않은 계좌입니다',
    '오류가 발생했습니다',
  ])('%s → 실패로 본다', (text) => {
    expect(looksLikeAuthFailure(text)).toBe(true);
  });

  it('정상 안내는 실패로 보지 않는다', () => {
    expect(looksLikeAuthFailure('자산평가금액을 안내해 드리겠습니다')).toBe(false);
  });
});
