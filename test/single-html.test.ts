import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

/**
 * 배포용 단일 HTML 을 실제 DOM 에 올려 확인한다.
 *
 * 이 파일은 사람이 휴대폰에서 직접 쓰는 산출물이라, 링크가 갱신되지 않는 종류의
 * 문제가 조용히 지나가면 그대로 현장에 나간다.
 */
let html: string;

const dom = () => {
  const d = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/' });
  return {
    d,
    href: (id: string) =>
      d.window.document.querySelector(`li[data-id="${id}"] a.tel`)?.getAttribute('href') ?? '',
    shown: (id: string) =>
      d.window.document.querySelector(`li[data-id="${id}"] [data-ds]`)?.textContent ?? '',
    type: (field: string, value: string) => {
      const el = d.window.document.getElementById(field) as HTMLInputElement;
      el.value = value;
      el.dispatchEvent(new d.window.Event('input', { bubbles: true }));
    },
    pick: (id: string, kind: 'acc' | 'stk', value: 'auto' | 'manual') => {
      const el = d.window.document.querySelector(
        `li[data-id="${id}"] [data-mode="${kind}"] input[value="${value}"]`,
      ) as HTMLInputElement;
      el.checked = true;
      el.dispatchEvent(new d.window.Event('change', { bubbles: true }));
    },
  };
};

beforeAll(() => {
  execFileSync('npm', ['run', 'build'], { stdio: 'pipe' });
  html = readFileSync('dist-single/ars-test.html', 'utf-8');
});

describe('스크립트 없이도 동작하는 부분', () => {
  it('전화 링크 101개가 HTML 에 박혀 있다', () => {
    expect((html.match(/href="tel:/g) ?? []).length).toBe(101);
  });

  it('케이스 링크에는 모두 data-dtmf 가 있다', () => {
    // 하나라도 없으면 갱신 루프가 그 자리에서 멈춘다.
    const tags = html.match(/<a class="tel"[^>]*>/g) ?? [];
    expect(tags.filter((t) => !t.includes('data-dtmf'))).toHaveLength(0);
  });

  it('외부 파일을 참조하지 않는다', () => {
    expect(html).not.toMatch(/(src|href)="(?!tel:|data:|#)[^"]+"/);
  });
});

describe('계좌번호 자동 입력', () => {
  it('계좌번호를 입력하면 인증 메뉴 링크에 바로 반영된다', () => {
    const { href, shown, type } = dom();
    expect(href('2-1')).toBe('tel:0263016001,,,,2,,1');
    type('f-accountNo', '12345678901');
    expect(href('2-1')).toBe('tel:0263016001,,,,2,,1,,,,12345678901%23,,,,0000');
    expect(shown('2-1')).toBe('0263016001,,,,2,,1,,,,12345678901%23,,,,0000');
  });

  it('라디오로 직접입력을 고르면 계좌번호가 빠진다', () => {
    const { href, type, pick } = dom();
    type('f-accountNo', '12345678901');
    pick('2-1', 'acc', 'manual');
    expect(href('2-1')).toBe('tel:0263016001,,,,2,,1');
    pick('2-1', 'acc', 'auto');
    expect(href('2-1')).toContain('12345678901%23');
  });

  it('선택은 해당 메뉴에만 적용된다', () => {
    const { href, type, pick } = dom();
    type('f-accountNo', '12345678901');
    pick('2-1', 'acc', 'manual');
    expect(href('2-2-1')).toContain('12345678901%23');
  });

  it('인증이 없는 메뉴에는 붙지 않는다', () => {
    const { href, type } = dom();
    type('f-accountNo', '12345678901');
    expect(href('1-1')).toBe('tel:0263016001,,,,1,,1');
  });
});

describe('종목코드', () => {
  it('추정 대상에만 기본으로 붙는다', () => {
    const { href, type } = dom();
    type('f-stockCode', '005930');
    expect(href('1-3-1')).toBe('tel:0263016001,,,,1,,3,,1,,,,005930%23');
    // 추정 대상이 아닌 메뉴는 사람이 켜기 전까지 붙지 않는다.
    expect(href('1-1')).toBe('tel:0263016001,,,,1,,1');
  });

  it('대상이 아닌 메뉴도 직접 켜면 붙는다', () => {
    const { href, type, pick } = dom();
    type('f-stockCode', '005930');
    pick('1-1', 'stk', 'auto');
    expect(href('1-1')).toBe('tel:0263016001,,,,1,,1,,,,005930%23');
  });

  it('계좌번호와 함께 쓰면 계좌 → 비밀번호 → 종목 순으로 붙는다', () => {
    const { href, type } = dom();
    type('f-accountNo', '12345678901');
    type('f-stockCode', '005930');
    expect(href('3-1-1')).toBe(
      'tel:0263016001,,,,3,,1,,1,,,,12345678901%23,,,,0000,,,,005930%23',
    );
  });
});

describe('대기시간 · 형식 설정', () => {
  it('묻는 시점을 대메뉴 직후로 바꾸면 위치가 옮겨진다', () => {
    const { d, href, type } = dom();
    type('f-accountNo', '12345678901');
    const sel = d.window.document.getElementById('f-authPosition') as HTMLSelectElement;
    sel.value = 'top';
    sel.dispatchEvent(new d.window.Event('change', { bubbles: true }));
    expect(href('2-1')).toBe('tel:0263016001,,,,2,,,,12345678901%23,,,,0000,,1');
  });

  it('# 을 빼면 종단 문자가 사라진다', () => {
    const { d, href, type } = dom();
    type('f-accountNo', '12345678901');
    const sel = d.window.document.getElementById('f-terminator') as HTMLSelectElement;
    sel.value = 'none';
    sel.dispatchEvent(new d.window.Event('change', { bubbles: true }));
    expect(href('2-1')).toBe('tel:0263016001,,,,2,,1,,,,12345678901,,,,0000');
  });

  it('대기시간을 늘리면 쉼표가 늘어난다', () => {
    const { href, type } = dom();
    type('f-accountNo', '12345678901');
    type('f-authWaitMs', '12000');
    expect(href('2-1')).toBe('tel:0263016001,,,,2,,1,,,,,,12345678901%23,,,,,,0000');
  });
});
