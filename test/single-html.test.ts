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

const dom = (userAgent = 'test', androidDefaults = false) => {
  const d = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/',
    beforeParse(window) { Object.defineProperty(window.navigator, 'userAgent', { value: userAgent });
      // 기존 다이얼 조합 회귀는 설정을 명시하여 검증한다. 새 기본값은 별도 테스트한다.
      const settings: Record<string, string | number> = { interDigitWaitMs: 6000, terminator: 'hash', stockTerminator: 'hash', terminatorDefaultsVersion: 1, androidFullDefaultVersion: 1, androidRunMode: 'adaptive' };
      if (/Android/.test(userAgent) && !androidDefaults) Object.assign(settings, { dialMode: 'android', androidRunMode: 'full' });
      window.localStorage.setItem('ars-test', JSON.stringify({ settings }));
    }
  });
  // 기존 다이얼 조합 테스트용 비밀번호. 실제 화면 기본값은 빈 값이다.
  d.window.document.querySelectorAll('[data-credential=accountPw]').forEach(el => (el as HTMLInputElement).value = '0000');
  return {
    d,
    href: (id: string) =>
      d.window.document.querySelector(`li[data-id="${id}"] a.tel`)?.getAttribute('href') ?? '',
    shown: (id: string) =>
      d.window.document.querySelector(`li[data-id="${id}"] [data-ds]`)?.textContent ?? '',
    type: (field: string, value: string) => {
      if (field === 'all-menu-accounts') {
        d.window.document.querySelectorAll('[data-credential=accountNo]').forEach(el => (el as HTMLInputElement).value = value);
        (d.window.document.getElementById('apply-settings') as HTMLButtonElement).click();
        return;
      }
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
  it('기본 ARS 번호가 스크립트 없이도 전화 링크에 포함된다', () => {
    const page = new JSDOM(html);
    const links = page.window.document.querySelectorAll('a.tel[data-dtmf]');
    expect(links.length).toBe(140);
    for (const link of links) expect(link.getAttribute('href')).toMatch(/^tel:0263016001,/);
  });

  it('전화 링크 140개가 HTML 에 박혀 있다', () => {
    expect((html.match(/href="tel:/g) ?? []).length).toBe(140);
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
    expect(href('2-1')).toBe('tel:0263016001,,,,2,,,1');
    type('all-menu-accounts', '12345678901');
    expect(href('2-1')).toBe('tel:0263016001,,,,2,,,,12345678901%23,,,,,,0000,,,1');
    expect(shown('2-1')).toBe('0263016001,,,,2,,,,12345678901#,,,,,,0000,,,1');
  });

  it('라디오로 직접입력을 고르면 계좌번호가 빠진다', () => {
    const { href, type, pick } = dom();
    type('all-menu-accounts', '12345678901');
    pick('2-1', 'acc', 'manual');
    expect(href('2-1')).toBe('tel:0263016001,,,,2,,,1');
    pick('2-1', 'acc', 'auto');
    expect(href('2-1')).toContain('12345678901%23');
  });

  it('선택은 해당 메뉴에만 적용된다', () => {
    const { href, type, pick } = dom();
    type('all-menu-accounts', '12345678901');
    pick('2-1', 'acc', 'manual');
    expect(href('2-2-1')).toContain('12345678901%23');
  });

  it('인증이 없는 메뉴에는 붙지 않는다', () => {
    const { href, type } = dom();
    type('all-menu-accounts', '12345678901');
    expect(href('1-1')).toBe('tel:0263016001,,,,1,,,1');
  });
});

describe('종목코드', () => {
  it('추정 대상에만 기본으로 붙는다', () => {
    const { href, type } = dom();
    type('f-stockCode', '005930');
    expect(href('1-3-1')).toBe('tel:0263016001,,,,1,,,3,,,1,,,,005930%23');
    // 추정 대상이 아닌 메뉴는 사람이 켜기 전까지 붙지 않는다.
    expect(href('1-1')).toBe('tel:0263016001,,,,1,,,1');
  });

  it('대상이 아닌 메뉴도 직접 켜면 붙는다', () => {
    const { href, type, pick } = dom();
    type('f-stockCode', '005930');
    pick('1-1', 'stk', 'auto');
    expect(href('1-1')).toBe('tel:0263016001,,,,1,,,1,,,,005930%23');
  });

  it('계좌번호와 함께 쓰면 계좌 → 비밀번호 → 종목 순으로 붙는다', () => {
    const { href, type, pick } = dom();
    type('all-menu-accounts', '12345678901');
    type('f-stockCode', '005930');
    pick('3-1-1', 'stk', 'auto');
    expect(href('3-1-1')).toBe(
      'tel:0263016001,,,,3,,,,12345678901%23,,,,,,0000,,,1,,,1,,,,005930%23',
    );
  });
});

describe('대기시간 · 형식 설정', () => {
  it('묻는 시점을 대메뉴 직후로 바꾸면 위치가 옮겨진다', () => {
    const { d, href, type } = dom();
    type('all-menu-accounts', '12345678901');
    const sel = d.window.document.getElementById('f-authPosition') as HTMLSelectElement;
    sel.value = 'top';
    sel.dispatchEvent(new d.window.Event('change', { bubbles: true }));
    expect(href('2-1')).toBe('tel:0263016001,,,,2,,,,12345678901%23,,,,,,0000,,,1');
  });

  it('# 을 빼면 종단 문자가 사라진다', () => {
    const { d, href, type } = dom();
    type('all-menu-accounts', '12345678901');
    const sel = d.window.document.getElementById('f-terminator') as HTMLSelectElement;
    sel.value = 'none';
    sel.dispatchEvent(new d.window.Event('change', { bubbles: true }));
    expect(href('2-1')).toBe('tel:0263016001,,,,2,,,,12345678901,,,,,,0000,,,1');
  });

  it('대기시간을 늘리면 쉼표가 늘어난다', () => {
    const { href, type } = dom();
    type('all-menu-accounts', '12345678901');
    type('f-authWaitMs', '12000');
    expect(href('2-1')).toBe('tel:0263016001,,,,2,,,,,,12345678901%23,,,,,,0000,,,1');
  });
});


describe('모바일 전화 앱 호환', () => {
  it('Android는 인증·종목·대기 문자를 보존하여 다이얼러를 연다', () => {
    const { href, shown, type, pick } = dom('Mozilla/5.0 (Linux; Android 14) Chrome/120');
    type('all-menu-accounts', '12345678901');
    type('f-stockCode', '005930');
    pick('3-1-1', 'stk', 'auto');
    expect(href('3-1-1')).toBe('intent:0263016001,,,,3,,,,12345678901%23,,,,,,0000,,,1,,,1,,,,005930%23#Intent;scheme=tel;action=android.intent.action.DIAL;end');
    expect(shown('3-1-1')).not.toContain('#Intent');
  });

  it('iOS는 기존 tel 링크를 유지한다', () => {
    expect(dom('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)').href('2-1'))
      .toBe('tel:0263016001,,,,2,,,1');
  });

  it('Android 호환 모드는 메뉴와 직접 다이얼을 함께 전환하고 저장한다', () => {
    const { d, href, type } = dom('Android');
    type('f-probe', 'tel:0263016001,,1#;2');
    const probe = d.window.document.getElementById('probe-tel')!;
    expect(probe.getAttribute('href')).toBe('intent:0263016001,,1%23;2#Intent;scheme=tel;action=android.intent.action.DIAL;end');
    const select = d.window.document.getElementById('f-dialMode') as HTMLSelectElement;
    select.value = 'tel';
    select.dispatchEvent(new d.window.Event('change', { bubbles: true }));
    expect(href('2-1')).toBe('tel:0263016001,,,,2,,,1');
    expect(probe.getAttribute('href')).toBe('tel:0263016001,,1%23;2');
    expect(JSON.parse(d.window.localStorage.getItem('ars-test')!).settings.dialMode).toBe('tel');
    type('f-probe', '');
    expect(probe.hasAttribute('href')).toBe(false);
    select.value = 'auto';
    select.dispatchEvent(new d.window.Event('change', { bubbles: true }));
    expect(href('2-1')).toMatch(/^tel:/);
  });
});


describe('케이스 관리', () => {
  it('분류와 결과를 교차 필터링하고 빈 결과를 안내한다', () => {
    const { d } = dom();
    const doc = d.window.document;
    const kind = doc.getElementById('case-kind') as HTMLSelectElement;
    kind.value = 'negative'; kind.dispatchEvent(new d.window.Event('change'));
    expect(doc.querySelectorAll('li.leaf:not([hidden])').length).toBe(37);
    const li = doc.querySelector('li[data-id="neg-1-8"]')!;
    (li.querySelector('[data-v="FAIL"]') as HTMLButtonElement).click();
    const result = doc.getElementById('case-result') as HTMLSelectElement;
    result.value = 'FAIL'; result.dispatchEvent(new d.window.Event('change'));
    expect(doc.querySelectorAll('li.leaf:not([hidden])').length).toBe(1);
    (li.querySelector('[data-v="BLOCKED"]') as HTMLButtonElement).click();
    expect(doc.querySelectorAll('li.leaf:not([hidden])').length).toBe(0);
    expect((doc.getElementById('case-empty') as HTMLElement).hidden).toBe(false);
    expect(JSON.parse(d.window.localStorage.getItem('ars-test')!).results['neg-1-8']).toBe('BLOCKED');
  });

});


describe('첨부 엑셀 반영', () => {
  it('엑셀 인증·종목 표시를 유지하고 불필요한 기록 입력란을 제거한다', () => {
    const { d, type, href } = dom();
    const doc = d.window.document;
    expect(doc.querySelectorAll('[data-case-account], [data-note], .account-record')).toHaveLength(0);
    type('all-menu-accounts', '12345678901');
    expect(href('6-1')).toContain('12345678901%23');
    type('f-stockCode', '005930');
    expect(href('1-2')).toContain('005930%23');
    expect(href('3-1-1')).toContain('005930');

  });
});


describe('모바일 설정 적용', () => {
  it('입력 이벤트가 없어도 적용 버튼이 현재 입력값을 읽어 Android 링크를 갱신한다', () => {
    const { d, href } = dom('Android');
    const doc = d.window.document;
    (doc.getElementById('account-2-1') as HTMLInputElement).value = '12345678901';
    (doc.getElementById('f-stockCode') as HTMLInputElement).value = '005930';
    (doc.getElementById('f-interDigitWaitMs') as HTMLInputElement).value = '8000';
    expect(href('2-1')).not.toContain('12345678901');
    (doc.getElementById('apply-settings') as HTMLButtonElement).click();
    expect(href('2-1')).toBe('intent:0263016001,,,,2,,,,12345678901%23,,,,,,0000,,,,1#Intent;scheme=tel;action=android.intent.action.DIAL;end');
    expect(href('1-2')).toContain('005930%23');
    expect(doc.getElementById('apply-status')!.textContent).toContain('적용 완료');
    expect(JSON.parse(d.window.localStorage.getItem('ars-test')!).settings.stockCode).toBe('005930');
  });

  it('change 이벤트로도 반영하며 직접입력 선택은 유지한다', () => {
    const { d, href, type, pick } = dom();
    const input = d.window.document.getElementById('account-2-1') as HTMLInputElement;
    input.value = '12345678901'; input.dispatchEvent(new d.window.Event('change'));
    expect(href('2-1')).toContain('12345678901');
    pick('2-1', 'acc', 'manual');
    (d.window.document.getElementById('apply-settings') as HTMLButtonElement).click();
    expect(href('2-1')).not.toContain('12345678901');
    type('all-menu-accounts', '');
    expect(href('2-1')).not.toContain('12345678901');
  });
});


it('전화 버튼 클릭 직전에 화면 값을 읽고 계좌 삽입 순서를 표시한다', () => {
  const { d, href } = dom('Android');
  const doc = d.window.document;
  (doc.getElementById('account-2-1') as HTMLInputElement).value = '12345678901';
  (doc.getElementById('f-authPosition') as HTMLSelectElement).value = 'top';
  const a = doc.querySelector('li[data-id="2-1"] a.tel')!;
  a.addEventListener('click', e => e.preventDefault());
  a.dispatchEvent(new d.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(href('2-1')).toBe('intent:0263016001,,,,2,,,,12345678901%23,,,,,,0000,,,1#Intent;scheme=tel;action=android.intent.action.DIAL;end');
  const sequence = doc.querySelector('li[data-id="2-1"] [data-sequence]')!.textContent!;
  expect(sequence).toContain('메뉴 2 → 약 8초 대기 → 입력값');
  expect(sequence).toContain('약 6초 대기 → 메뉴 1');
  expect(sequence).toContain('계좌 자동');
});


it('비밀번호 대기시간은 계좌번호 앞 대기와 독립적으로 적용된다', () => {
  const { d, href, type } = dom('Android');
  type('all-menu-accounts', '12345678901');
  expect(href('2-1')).toContain(',,,,12345678901%23,,,,,,0000');
  (d.window.document.getElementById('f-passwordWaitMs') as HTMLInputElement).value = '16000';
  (d.window.document.getElementById('apply-settings') as HTMLButtonElement).click();
  expect(href('2-1')).toContain(',,,,12345678901%23,,,,,,,,0000');
  type('f-authWaitMs', '4000');
  expect(href('2-1')).toContain(',,12345678901%23,,,,,,,,0000');
});


it('대메뉴 3·4 진입 전화와 테스트 하위 메뉴 전화를 바로 제공한다', () => {
  const { d, href } = dom('Android');
  expect(href('entry-3')).toBe('intent:0263016001,,,,3#Intent;scheme=tel;action=android.intent.action.DIAL;end');
  expect(href('entry-4')).toBe('intent:0263016001,,,,4#Intent;scheme=tel;action=android.intent.action.DIAL;end');
  for (const id of ['3-1-1', '4-1-1']) {
    const li = d.window.document.querySelector('li[data-id="' + id + '"]')!;
    expect(li.querySelector('a.tel')).not.toBeNull();
    expect(li.querySelector('.guard')).toBeNull();
    expect(li.textContent).not.toContain('실거래');
  }
});


it('공통 계좌를 제거하고 메뉴별 인증값을 독립 적용한다', () => {
  const { d, href } = dom('Android');
  const doc = d.window.document;
  expect(doc.getElementById('f-accountNo')).toBeNull();
  expect(doc.getElementById('f-accountPw')).toBeNull();
  expect(doc.querySelectorAll('[data-credential=accountNo]').length).toBeGreaterThan(56);
  (doc.getElementById('account-2-1') as HTMLInputElement).value = '11111111111';
  (doc.getElementById('password-2-1') as HTMLInputElement).value = '1234';
  (doc.querySelector('li[data-id="2-1"] [data-apply-menu]') as HTMLButtonElement).click();
  expect(href('2-1')).toContain('11111111111%23,,,,,,1234');
  expect(href('2-2-1')).not.toContain('11111111111');
  (doc.getElementById('account-2-2-1') as HTMLInputElement).value = '22222222222';
  (doc.getElementById('password-2-2-1') as HTMLInputElement).value = '5678';
  (doc.querySelector('li[data-id="2-2-1"] [data-apply-menu]') as HTMLButtonElement).click();
  expect(href('2-2-1')).toContain('22222222222%23,,,,,,5678');
  expect(href('2-1')).not.toContain('5678');
  (doc.getElementById('password-2-1') as HTMLInputElement).value = '';
  (doc.querySelector('li[data-id="2-1"] [data-apply-menu]') as HTMLButtonElement).click();
  expect(href('2-1')).not.toContain('11111111111');
  const saved = JSON.parse(d.window.localStorage.getItem('ars-test')!);
  expect(saved.menuCredentials['2-2-1'].accountPw).toBe('5678');
  expect(saved.settings.accountNo).toBeUndefined();
});


it('2·4·5번은 공통 인증 시점과 무관하게 대메뉴 직후 인증하고 나머지 메뉴를 선택한다', () => {
  const { d, href, type } = dom('Android');
  type('all-menu-accounts', '12345678901');
  const select = d.window.document.getElementById('f-authPosition') as HTMLSelectElement;
  for (const position of ['end', 'mid']) {
    select.value = position; select.dispatchEvent(new d.window.Event('change'));
    for (const id of ['2-2-1', '4-1-1', '5-1-3']) {
      const [top, mid, leaf] = id.split('-');
      expect(href(id)).toBe('intent:0263016001,,,,' + top + ',,,,12345678901%23,,,,,,0000,,,' + mid + ',,,' + leaf + '#Intent;scheme=tel;action=android.intent.action.DIAL;end');
    }
  }
  select.value = 'end'; select.dispatchEvent(new d.window.Event('change'));
  expect(href('3-1-1')).toContain(',,,,3,,,,12345678901%23,,,,,,0000,,,1,,,1');
});


describe('Android 자동·반자동 전달', () => {
  it('기본값은 tel이며 민감 입력이 있으면 대표번호만 발신한다', () => {
    const { d, href, type } = dom('Android', true);
    expect(href('1-1')).toBe('tel:0263016001,,,,1,,,1');
    type('account-4-1-1', '12345678901');
    expect(href('4-1-1')).toBe('tel:0263016001');
    const panel = d.window.document.querySelector('li[data-id="4-1-1"] [data-android-panel]')!;
    expect(panel.textContent).toContain('반자동');
    expect(panel.textContent).toContain('12345678901');
    expect(panel.querySelector('[data-steps]')!.textContent).toContain('7초 대기 → 계좌번호#');
    expect(panel.querySelector('[data-debug]')!.textContent).toContain('최종 URI 길이: 14');
    type('f-stockCode', '005930');
    expect(href('1-2')).toBe('tel:0263016001');
  });
  it('설정한 URI 길이를 초과할 때만 전환하며 수동 모드와 intent를 선택할 수 있다', () => {
    const { d, href, type } = dom('Android', true);
    const original = href('1-1');
    type('f-androidMaxUriLength', String(original.length));
    expect(href('1-1')).toBe(original);
    type('f-androidMaxUriLength', String(original.length - 1));
    expect(href('1-1')).toBe('tel:0263016001');
    const select = (id: string, value: string) => {
      const el = d.window.document.getElementById(id) as HTMLSelectElement;
      el.value = value; el.dispatchEvent(new d.window.Event('change'));
    };
    select('f-androidRunMode', 'full');
    expect(href('1-1')).toBe(original);
    select('f-dialMode', 'android');
    expect(href('1-1')).toBe('intent:0263016001,,,,1,,,1#Intent;scheme=tel;action=android.intent.action.DIAL;end');
    select('f-androidRunMode', 'semi');
    expect(href('1-1')).toBe('intent:0263016001#Intent;scheme=tel;action=android.intent.action.DIAL;end');
  });
  it('Android pause 단위와 디버그 원문 공개·복사 폴백을 지원한다', () => {
    const { d, href, type } = dom('Android', true);
    type('f-androidPauseUnitMs', '1000');
    expect(href('1-1')).toBe('tel:0263016001,,,,,,,,1,,,,,,1');
    type('account-2-1', '12345678901');
    const panel = d.window.document.querySelector('li[data-id="2-1"] [data-android-panel]')!;
    expect(panel.querySelector('[data-debug]')!.textContent).toContain('12345678901%23');
    (panel.querySelector('[data-copy]') as HTMLButtonElement).click();
    expect((panel.querySelector('[data-copy-text]') as HTMLTextAreaElement).hidden).toBe(false);
    expect((panel.querySelector('[data-copy-text]') as HTMLTextAreaElement).value).toContain('12345678901');
  });
  it('iOS는 Android 설정을 저장해도 기존 tel·pause·인증 동작을 유지한다', () => {
    const { d, href, type } = dom('iPhone');
    type('account-2-1', '12345678901');
    const before = href('2-1');
    type('f-androidPauseUnitMs', '1000'); type('f-androidMaxUriLength', '1');
    const mode = d.window.document.getElementById('f-androidRunMode') as HTMLSelectElement;
    mode.value = 'semi'; mode.dispatchEvent(new d.window.Event('change'));
    const transport = d.window.document.getElementById('f-dialMode') as HTMLSelectElement;
    transport.value = 'android'; transport.dispatchEvent(new d.window.Event('change'));
    expect(href('2-1')).toBe(before);
    expect((d.window.document.getElementById('android-options') as HTMLElement).hidden).toBe(true);
  });
});


it('4·5번 모든 하위 정상·결번·상담원 시나리오에 선인증을 적용하고 테스트 비밀번호를 표시한다', () => {
  const { d, type, href } = dom('Android');
  type('all-menu-accounts', '12345678901');
  const doc = d.window.document;
  const rows = Array.from(doc.querySelectorAll('li.leaf')).filter(li => {
    const dtmf = li.querySelector('a.tel')!.getAttribute('data-dtmf')!;
    return /^[45]/.test(dtmf) && dtmf.length > 1;
  });
  expect(rows.length).toBeGreaterThan(35);
  for (const li of rows) {
    const a = li.querySelector('a.tel')!;
    const dtmf = a.getAttribute('data-dtmf')!;
    expect(a.getAttribute('data-auth')).toBe('1');
    expect(href(li.getAttribute('data-id')!)).toContain(',,,,' + dtmf[0] + ',,,,12345678901%23,,,,,,0000,,,' + dtmf[1]);
    expect(li.querySelector('[data-credential=accountPw]')!.getAttribute('type')).toBe('text');
    expect(li.querySelector('[data-debug]')!.textContent).toContain('12345678901');
  }
});

it('계좌 이력은 입력 당시 값을 누적하고 분류·CSV·재열기를 지원한다', () => {
  const { d, type } = dom();
  const doc = d.window.document;
  const li = doc.querySelector('li[data-id="2-1"]')!;
  const normal = li.querySelector('[data-account-result="normal"]') as HTMLButtonElement;
  const failure = li.querySelector('[data-account-result="failure"]') as HTMLButtonElement;
  normal.click();
  expect(JSON.parse(d.window.localStorage.getItem('ars-test')!).accountHistory).toHaveLength(0);
  type('account-2-1', '11111111111'); normal.click();
  type('account-2-1', '22222222222'); failure.click();
  const saved = d.window.localStorage.getItem('ars-test')!;
  const history = JSON.parse(saved).accountHistory;
  expect(history).toHaveLength(2);
  expect(history[0].account).toBe('11111111111');
  expect(history[1].account).toBe('22222222222');
  expect(history[0].note).toBe('');
  expect(JSON.parse(saved).results['2-1']).toBeUndefined();
  const filter = doc.getElementById('history-filter') as HTMLSelectElement;
  filter.value = 'failure'; filter.dispatchEvent(new d.window.Event('change'));
  expect(doc.querySelectorAll('#history-list li')).toHaveLength(1);
  (doc.getElementById('history-export') as HTMLButtonElement).click();
  const csv = (doc.getElementById('history-csv') as HTMLTextAreaElement).value;
  expect(csv).toContain('22222222222'); expect(csv).not.toContain('11111111111');
  const reopened = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/',
    beforeParse(window) { window.localStorage.setItem('ars-test', saved); }
  });
  expect(reopened.window.document.querySelectorAll('#history-list li')).toHaveLength(2);
  reopened.window.close();
});


it('2번 모든 하위는 선인증 후 메뉴 선택하며 Android 반자동에도 같은 순서를 표시한다', () => {
  const { d, href, type } = dom('Android', true);
  type('all-menu-accounts', '12345678901');
  const doc = d.window.document;
  const mode = doc.getElementById('f-androidRunMode') as HTMLSelectElement;
  const rows = Array.from(doc.querySelectorAll('li.leaf')).filter(li => /^2./.test(li.querySelector('a.tel')!.getAttribute('data-dtmf')!));
  expect(rows.length).toBe(13);
  for (const li of rows) {
    expect(li.querySelector('a.tel')!.getAttribute('data-auth')).toBe('1');
    expect(href(li.getAttribute('data-id')!)).toBe('tel:0263016001');
    const sequence = li.querySelector('[data-steps]')!.textContent!;
    expect(sequence.indexOf('계좌번호')).toBeLessThan(sequence.lastIndexOf('메뉴'));
  }
  mode.value = 'full'; mode.dispatchEvent(new d.window.Event('change'));
  expect(href('2-2-1')).toBe('tel:0263016001,,,,2,,,,12345678901%23,,,,,,0000,,,2,,,1');
});

it('WebView 자동 감지와 수동 호출 방식, 실행 전 URI 표시를 지원한다', () => {
  const uas = [
    'Mozilla/5.0 (Linux; Android 14; Pixel; wv) AppleWebKit/537.36 Version/4.0 Chrome/120.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 4.4) AppleWebKit/537.36 Version/4.0 Chrome/30.0 Mobile Safari/537.36',
    'Android HTML Viewer', 'Android App Preview'
  ];
  for (const ua of uas) {
    const { d, href } = dom(ua, true);
    const doc = d.window.document;
    expect(href('1-1')).toBe('intent:0263016001,,,,1,,,1#Intent;scheme=tel;action=android.intent.action.DIAL;end');
    expect(doc.querySelector('[data-call-info]')).toBeNull();
    const mode = doc.getElementById('f-dialMode') as HTMLSelectElement;
    mode.value = 'chrome'; mode.dispatchEvent(new d.window.Event('change'));
    expect(href('1-1')).toBe('tel:0263016001,,,,1,,,1');
    d.window.close();
  }
});

it('Chrome·iOS는 tel을 유지하고 수동 intent 및 직접 다이얼에도 같은 규칙을 적용한다', () => {
  for (const ua of ['Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36', 'iPhone']) {
    const { d, href, type } = dom(ua, true);
    expect(href('1-1')).toBe('tel:0263016001,,,,1,,,1');
    const select = d.window.document.getElementById('f-dialMode') as HTMLSelectElement;
    select.value = 'android'; select.dispatchEvent(new d.window.Event('change'));
    expect(href('1-1').startsWith(ua === 'iPhone' ? 'tel:' : 'intent:')).toBe(true);
    type('f-probe', '0263016001,,1#');
    const link = d.window.document.getElementById('probe-tel')!;
    type('f-probe', '');
    d.window.close();
  }
});


it('새 기본값은 단계간 4초와 # 없음이며 9번은 선인증한다', () => {
  const d = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/', beforeParse(w) {
    Object.defineProperty(w.navigator, 'userAgent', { value: 'Android' });
  } });
  const doc = d.window.document;
  expect((doc.getElementById('f-interDigitWaitMs') as HTMLInputElement).value).toBe('4000');
  expect((doc.getElementById('f-terminator') as HTMLSelectElement).value).toBe('none');
  expect((doc.getElementById('f-stockTerminator') as HTMLSelectElement).value).toBe('none');
  (doc.getElementById('f-androidRunMode') as HTMLSelectElement).value = 'full';
  (doc.getElementById('account-9-1') as HTMLInputElement).value = '12345678901';
  (doc.getElementById('password-9-1') as HTMLInputElement).value = '1234';
  (doc.getElementById('f-stockCode') as HTMLInputElement).value = '005930';
  (doc.getElementById('apply-settings') as HTMLButtonElement).click();
  const href = (id: string) => doc.querySelector('li[data-id="' + id + '"] a.tel')!.getAttribute('href');
  expect(href('9-1')).toBe('tel:0263016001,,,,9,,,,12345678901,,,,,,1234,,1,,,,005930');
  expect(href('1-2')).toBe('tel:0263016001,,,,1,,2,,,,005930');
  const select = doc.getElementById('f-terminator') as HTMLSelectElement;
  select.value = 'hash'; select.dispatchEvent(new d.window.Event('change'));
  expect(href('9-1')).toContain('12345678901%23');
  d.window.close();
});


it('기존 저장된 # 붙임 설정을 한 번 안 붙임으로 전환하고 이후 수동 선택을 유지한다', () => {
  function open(saved: string) {
    return new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/', beforeParse(w) {
      w.localStorage.setItem('ars-test', saved);
    } });
  }
  const d = open(JSON.stringify({ settings: { terminator: 'hash', stockTerminator: 'hash', interDigitWaitMs: 4000 },
    menuCredentials: { '2-1': { accountNo: '12345678901', accountPw: '1234' } }, results: { '2-1': 'PASS' } }));
  const doc = d.window.document;
  expect((doc.getElementById('f-terminator') as HTMLSelectElement).value).toBe('none');
  expect((doc.getElementById('f-stockTerminator') as HTMLSelectElement).value).toBe('none');
  expect(doc.querySelector('li[data-id="2-1"] a.tel')!.getAttribute('href')).not.toContain('%23');
  expect(JSON.parse(d.window.localStorage.getItem('ars-test')!).results['2-1']).toBe('PASS');
  const select = doc.getElementById('f-terminator') as HTMLSelectElement;
  select.value = 'hash'; select.dispatchEvent(new d.window.Event('change'));
  const next = open(d.window.localStorage.getItem('ars-test')!);
  expect((next.window.document.getElementById('f-terminator') as HTMLSelectElement).value).toBe('hash');
  d.window.close(); next.window.close();
});


it('1-5 보유종목 현재가 안내에 메뉴별 계좌·비밀번호를 입력하고 적용한다', () => {
  const d = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/' });
  const doc = d.window.document;
  const li = doc.querySelector('li[data-id="1-5"]')!;
  const a = li.querySelector('a.tel')!;
  expect(a.getAttribute('data-auth')).toBe('1');
  (doc.getElementById('account-1-5') as HTMLInputElement).value = '12345678901';
  (doc.getElementById('password-1-5') as HTMLInputElement).value = '1234';
  (li.querySelector('[data-apply-menu]') as HTMLButtonElement).click();
  expect(a.getAttribute('href')).toBe('tel:0263016001,,,,1,,5,,,,12345678901,,,,,,1234');
  expect(doc.querySelector('li[data-id="1-2"] a.tel')!.getAttribute('href')).not.toContain('12345678901');
  const manual = li.querySelector('[data-mode="acc"] input[value="manual"]') as HTMLInputElement;
  manual.checked = true; manual.dispatchEvent(new d.window.Event('change', { bubbles: true }));
  expect(a.getAttribute('href')).toBe('tel:0263016001,,,,1,,5');
  d.window.close();
});


it('1-5는 종목 선택을 표시하지 않고 모두 자동 설정에서도 종목을 전송하지 않는다', () => {
  const { d, type, href } = dom();
  const doc = d.window.document;
  const li = doc.querySelector('li[data-id="1-5"]')!;
  expect(li.querySelector('[data-mode="stk"]')).toBeNull();
  expect(li.querySelector('[data-credential="accountNo"]')).not.toBeNull();
  expect(li.querySelector('a.tel')!.getAttribute('data-stock')).toBe('');
  type('f-stockCode', '005930');
  (doc.getElementById('stk-auto') as HTMLButtonElement).click();
  const show = doc.getElementById('f-showStock') as HTMLInputElement;
  show.checked = true; show.dispatchEvent(new d.window.Event('change'));
  expect(li.querySelector('[data-mode="stk"]')).toBeNull();
  expect(href('1-5')).not.toContain('005930');
  expect(href('1-2')).toContain('005930');
});


it('3번 하위는 선인증하고 3-1 ARS 주문에 종목 선택을 표시한다', () => {
  const d = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/' });
  const doc = d.window.document;
  const rows = Array.from(doc.querySelectorAll('li.leaf')).filter(li => /^3./.test(li.querySelector('a.tel')!.getAttribute('data-dtmf')!));
  expect(rows.length).toBeGreaterThan(10);
  for (const li of rows) {
    expect(li.querySelector('a.tel')!.getAttribute('data-auth')).toBe('1');
    (li.querySelector('[data-credential=accountNo]') as HTMLInputElement).value = '12345678901';
    (li.querySelector('[data-credential=accountPw]') as HTMLInputElement).value = '1234';
  }
  (doc.getElementById('f-stockCode') as HTMLInputElement).value = '005930';
  (doc.getElementById('apply-settings') as HTMLButtonElement).click();
  const li = doc.querySelector('li[data-id="3-1-1"]')!;
  expect(li.querySelector('[data-mode="stk"]')!.className).not.toContain('optional');
  expect(li.querySelector('a.tel')!.getAttribute('href')).toBe('tel:0263016001,,,,3,,,,12345678901,,,,,,1234,,1,,1,,,,005930');
  const manual = li.querySelector('[data-mode="stk"] input[value="manual"]') as HTMLInputElement;
  manual.checked = true; manual.dispatchEvent(new d.window.Event('change', { bubbles: true }));
  expect(li.querySelector('a.tel')!.getAttribute('href')).not.toContain('005930');
  for (const row of rows) expect(row.querySelector('a.tel')!.getAttribute('href')).toContain(',,,,3,,,,12345678901,,,,,,1234,,');
  d.window.close();
});


it('1-7은 중메뉴 후 인증하며 등록·삭제의 종목 자동/직접입력 선택을 지원한다', () => {
  const { d, type, href, pick } = dom('Android');
  type('all-menu-accounts', '12345678901');
  type('f-stockCode', '005930');
  const doc = d.window.document;
  const position = doc.getElementById('f-authPosition') as HTMLSelectElement;
  for (const value of ['top', 'end']) {
    position.value = value; position.dispatchEvent(new d.window.Event('change'));
    for (const suffix of ['1','2','3','0']) {
      const id = '1-7-' + suffix;
      expect(href(id)).toContain(',,,,1,,,7,,,,12345678901%23,,,,,,0000,,,' + suffix);
    }
  }
  for (const id of ['1-7-1','1-7-2']) {
    const row = doc.querySelector('li[data-id="' + id + '"]')!;
    expect(row.querySelector('[data-mode="stk"]')!.className).not.toContain('optional');
    expect(href(id)).toContain(',,,,005930%23');
    pick(id, 'stk', 'manual'); expect(href(id)).not.toContain('005930');
    pick(id, 'stk', 'auto'); expect(href(id)).toContain('005930');
  }
  expect(href('1-5')).not.toContain('005930');
});


it('Android 기본은 full이며 기존 자동 판단은 한 번 전환하고 명시적인 반자동 선택은 유지한다', () => {
  function open(settings: object) {
    return new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/', beforeParse(w) {
      Object.defineProperty(w.navigator, 'userAgent', { value: 'Android' });
      w.localStorage.setItem('ars-test', JSON.stringify({ settings,
        menuCredentials: { '9-1': { accountNo: '12345678901', accountPw: '1234' } } }));
    } });
  }
  for (const settings of [{}, { androidRunMode: 'adaptive' }]) {
    const d = open(settings), doc = d.window.document;
    expect((doc.getElementById('f-androidRunMode') as HTMLSelectElement).value).toBe('full');
    expect(doc.querySelector('li[data-id="9-1"] a.tel')!.getAttribute('href')).toBe('tel:0263016001,,,,9,,,,12345678901,,,,,,1234,,1');
    expect(JSON.parse(d.window.localStorage.getItem('ars-test')!).settings.androidFullDefaultVersion).toBe(1);
    d.window.close();
  }
  for (const settings of [{ androidRunMode: 'semi' }, { androidRunMode: 'adaptive', androidFullDefaultVersion: 1 }]) {
    const d = open(settings);
    expect(d.window.document.querySelector('li[data-id="9-1"] a.tel')!.getAttribute('href')).toBe('tel:0263016001');
    d.window.close();
  }
});


it('9번 빠른주문 네 메뉴에 종목 자동/직접입력을 제공하고 선인증 순서를 유지한다', () => {
  const { d, href, type, pick } = dom('Android');
  type('all-menu-accounts', '12345678901');
  type('f-stockCode', '005930');
  for (const digit of ['1', '2', '3', '4']) {
    const id = '9-' + digit;
    const group = d.window.document.querySelector('li[data-id="' + id + '"] [data-mode="stk"]')!;
    expect(group).not.toBeNull();
    expect(group.className).not.toContain('optional');
    expect(href(id)).toBe('intent:0263016001,,,,9,,,,12345678901%23,,,,,,0000,,,' + digit + ',,,,005930%23#Intent;scheme=tel;action=android.intent.action.DIAL;end');
    pick(id, 'stk', 'manual'); expect(href(id)).not.toContain('005930');
    pick(id, 'stk', 'auto'); expect(href(id)).toContain('005930');
  }
  expect(d.window.document.querySelector('li[data-id="9-0"] [data-mode="stk"]')).toBeNull();
});


it('4번 하위 이체대상 계좌를 메뉴별 저장하고 인증·메뉴 뒤에 추가한다', () => {
  const { d, href, type } = dom('Android');
  const doc = d.window.document;
  expect(doc.getElementById('transfer-4-1-1')).not.toBeNull();
  expect(doc.getElementById('transfer-3-1-1')).toBeNull();
  type('account-4-1-1', '12345678901');
  const original = href('4-1-1');
  (doc.getElementById('transfer-4-1-1') as HTMLInputElement).value = '012-345-6789';
  (doc.getElementById('transfer-wait-4-1-1') as HTMLInputElement).value = '8000';
  (doc.querySelector('li[data-id="4-1-1"] [data-apply-menu]') as HTMLButtonElement).click();
  expect(href('4-1-1')).toBe('intent:0263016001,,,,4,,,,12345678901%23,,,,,,0000,,,1,,,1,,,,0123456789#Intent;scheme=tel;action=android.intent.action.DIAL;end');
  expect(href('4-1-2')).not.toContain('0123456789');
  const saved = d.window.localStorage.getItem('ars-test')!;
  expect(JSON.parse(saved).menuCredentials['4-1-1'].transferAccount).toBe('012-345-6789');
  const reopened = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/', beforeParse(w) {
    w.localStorage.setItem('ars-test', saved); Object.defineProperty(w.navigator, 'userAgent', {value:'Android'});
  } });
  expect((reopened.window.document.getElementById('transfer-4-1-1') as HTMLInputElement).value).toBe('012-345-6789');
  expect(reopened.window.document.querySelector('li[data-id="4-1-1"] a.tel')!.getAttribute('href')).toBe(href('4-1-1'));
  reopened.window.close();
  const mode = doc.getElementById('f-androidRunMode') as HTMLSelectElement;
  mode.value = 'adaptive'; mode.dispatchEvent(new d.window.Event('change'));
  expect(href('4-1-1')).toBe('intent:0263016001#Intent;scheme=tel;action=android.intent.action.DIAL;end');
  expect(doc.querySelector('li[data-id="4-1-1"] [data-steps]')!.textContent).toContain('이체대상 계좌번호 0123456789');
  mode.value = 'full'; mode.dispatchEvent(new d.window.Event('change'));
  type('transfer-4-1-1', ''); expect(href('4-1-1')).toBe(original);
});
