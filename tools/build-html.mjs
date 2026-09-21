/**
 * 배포용 단일 HTML 생성기.
 *
 * 메뉴 트리와 전화 링크를 **빌드 시점에 전부 HTML 로 찍어 둔다.**
 * iOS 파일 앱 미리보기처럼 스크립트가 제한되는 환경에서도
 * 메뉴를 펼치고(`<details>`) 전화를 거는(`<a href="tel:">`) 동작이 그대로 된다.
 *
 * 스크립트가 도는 환경에서는 설정(대기시간·계좌번호·종목코드)에 따라 링크를 다시 계산하고,
 * 메뉴별 자동/수동 선택과 결과 기록이 켜진다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const menu = JSON.parse(readFileSync(resolve(ROOT, 'src/assets/ars-menu.json'), 'utf-8'));
const cfg = JSON.parse(readFileSync(resolve(ROOT, 'src/assets/ars-config.json'), 'utf-8'));
const OUT = resolve(ROOT, 'dist-single/ars-test.html');
const spreadsheet = JSON.parse(readFileSync(resolve(ROOT, 'config/spreadsheet-menu.json'), 'utf-8'));
if (Object.keys(spreadsheet.cases).length !== menu.cases.length || menu.cases.some(c => !spreadsheet.cases[c.id])) {
  throw new Error('첨부 엑셀과 메뉴 ID가 일치하지 않습니다.');
}
for (const c of menu.cases) Object.assign(c, spreadsheet.cases[c.id]);
// 사용자 지정: 2·3·4·5·9번의 모든 하위 시나리오는 대메뉴 진입 직후 인증한다.
for (const c of menu.cases.concat(menu.negativeCases)) {
  if (/^[23459]/.test(c.dtmf) && c.dtmf.length > 1) c.requiresAuth = true;
}

const NUMBER = cfg.number.replace(/[^0-9]/g, '');
const ACC = cfg.credentials.accountNo;
const PW = cfg.credentials.accountPw;
const STOCK = cfg.credentials.stockCode;

const BAKED_ACCOUNT = (ACC.value || '').replace(/[^0-9]/g, '');
const BAKED_PW = PW.defaultValue || '';
const BAKED_STOCK = (STOCK.value || '').replace(/[^0-9]/g, '');
const AUTH_BAKED = false; // 계좌 인증값은 각 메뉴에서 입력한다.
const STOCK_BAKED = BAKED_STOCK.length === STOCK.digits;

const authCount = menu.cases.concat(menu.negativeCases).filter((c) => c.requiresAuth).length;
const stockCount = menu.cases.filter((c) => c.requiresStockCode).length;

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ------------------------------------------------------------------ 트리 구성

/** ARS 에서 0 은 언제나 마지막(상담원 연결)이다. 숫자 정렬만 하면 맨 앞으로 와 버린다. */
const order = (code) => (code === '0' ? 99 : Number(code));
const byMenuCode = (a, b) => order(a.code) - order(b.code);

/** 시트의 평평한 케이스 목록을 대 → 중 → 소 3단으로 접는다. */
function buildTree() {
  const tops = new Map();
  for (const c of menu.cases) {
    const [t, mid, leaf] = c.id.split('-');
    if (!tops.has(t)) tops.set(t, { code: t, label: c.labels[0], mids: new Map() });
    const top = tops.get(t);

    if (mid === undefined) {
      top.direct = c; // 하위가 없는 대메뉴 (7. 말로하는 AI서비스)
      continue;
    }
    if (!top.mids.has(mid)) top.mids.set(mid, { code: mid, label: c.labels[1], leaves: [] });
    const m = top.mids.get(mid);
    if (leaf === undefined) m.self = c;
    else m.leaves.push({ ...c, code: leaf, label: c.labels[2] });
  }
  return [...tops.values()].sort(byMenuCode);
}

// ------------------------------------------------------------- 다이얼 문자열

const pauses = (ms, unit) => ','.repeat(Math.max(1, Math.ceil(ms / unit)));

/**
 * 빌드 시점의 다이얼 문자열.
 *
 * 계좌번호·종목코드는 설정에 값이 들어 있을 때만 붙는다. 없으면 메뉴 진입까지만
 * 자동으로 하고 나머지는 안내를 듣고 직접 누르게 둔다.
 * (스크립트가 도는 환경에서는 화면 설정값으로 다시 계산된다.)
 */
function dialFor(c, unit = cfg.pauseUnitMs.ios) {
  const gap = pauses(cfg.interDigitWaitMs, unit);
  const authGap = pauses(cfg.authWaitMs, unit);
  const passwordGap = pauses(cfg.passwordWaitMs, unit);
  const stockGap = pauses(cfg.stockWaitMs, unit);
  // `#` 은 URL 에서 프래그먼트 구분자라 그대로 두면 뒤가 잘린다.
  const accTerm = ACC.terminator === '#' ? '%23' : '';
  const stockTerm = STOCK.terminator === '#' ? '%23' : '';

  const useAuth = c.requiresAuth && AUTH_BAKED;
  const useStock = c.requiresStockCode && STOCK_BAKED;

  // 계좌번호를 어느 단계 뒤에 넣을지. ARS 마다 묻는 시점이 달라 실측으로 맞춘다.
  const digits = c.dtmf.split('');
  const at = !useAuth
    ? -1
    : /^17./.test(c.dtmf)
      ? 1
      : /^[23459]/.test(c.dtmf) || cfg.authPosition === 'top'
      ? 0
      : cfg.authPosition === 'mid'
        ? Math.min(1, digits.length - 1)
        : digits.length - 1;

  let out = `tel:${NUMBER}${pauses(cfg.initialWaitMs, unit)}`;
  digits.forEach((d, i) => {
    out += (i === 0 ? '' : gap) + d;
    if (i === at) out += `${authGap}${BAKED_ACCOUNT}${accTerm}${passwordGap}${BAKED_PW}`;
  });
  if (useStock) out += `${stockGap}${BAKED_STOCK}${stockTerm}`;
  return out;
}

// ------------------------------------------------------------------ 리프 UI

const badges = (c) =>
  [
    c.requiresAuth ? `<span class="b${AUTH_BAKED ? '' : ' warn'}">계좌</span>` : '',
    c.requiresStockCode ? `<span class="b${STOCK_BAKED ? '' : ' warn'}">종목</span>` : '',
    c.isAgentTransfer ? '<span class="b warn">상담원</span>' : '',
    c.isFinancialRisk ? (cfg.env === 'test' && /^[34]/.test(c.dtmf) ? '<span class="b">테스트</span>' : '<span class="b warn">실거래</span>') : '',
  ].join('');

/** 자동/수동 라디오 한 벌. 값이 구워져 있으면 자동이 기본이다. */
function modeRow(id, kind, label, baked, hidden) {
  return (
    `<div class="mode${hidden ? ' optional' : ''}" data-mode="${kind}">` +
    `<span class="mlabel">${label}</span>` +
    `<label><input type="radio" name="${kind}-${esc(id)}" value="auto"${baked ? ' checked' : ''}> 자동</label>` +
    `<label><input type="radio" name="${kind}-${esc(id)}" value="manual"${baked ? '' : ' checked'}> 직접입력</label>` +
    `</div>`
  );
}

/** 전화 한 건. 위험한 메뉴는 한 겹 접어서 실수로 눌리지 않게 한다. */
function leafRow(c, label, code) {
  const dial = dialFor(c);
  const negative = c.id.startsWith('neg-');
  const expected = negative ? '확인 필요 · ' + c.expectation : '선택한 메뉴 안내 또는 해당 서비스로 연결';
  const testMenu = cfg.env === 'test' && /^[34]/.test(c.dtmf);
  const risky = !testMenu && (c.isAgentTransfer || c.isFinancialRisk);

  const controls =
    (c.requiresAuth ? modeRow(c.id, 'acc', '계좌번호', AUTH_BAKED, false) : '') +
    // 종목코드는 첨부 엑셀 기준이며, 대상이 아닌 메뉴에도 숨긴 채로 넣어 둔다.
    // 설정에서 "모든 메뉴에 표시"를 켜면 드러난다.
    (c.isAgentTransfer || c.entryOnly || c.supportsStockCode === false ? '' : modeRow(c.id, 'stk', '종목코드', STOCK_BAKED && c.requiresStockCode, !c.requiresStockCode));

  const link =
    (c.requiresAuth ? `<div class="menu-credentials">
      <label>이 메뉴 계좌번호<input id="account-${esc(c.id)}" data-credential="accountNo" type="tel" inputmode="numeric" autocomplete="off" placeholder="${ACC.digits}자리 계좌번호"></label>
      <label>이 메뉴 계좌비밀번호<input id="password-${esc(c.id)}" data-credential="accountPw" type="text" inputmode="numeric" autocomplete="off" placeholder="계좌비밀번호"></label>
      ${/^4./.test(c.dtmf) ? `<label>이체대상 계좌번호<input id="transfer-${esc(c.id)}" data-credential="transferAccount" type="tel" inputmode="numeric" autocomplete="off" placeholder="비워두면 전송하지 않음"></label>
      <label>이체대상 계좌 입력 전 대기 (ms)<input id="transfer-wait-${esc(c.id)}" data-credential="transferWaitMs" type="number" min="1" placeholder="단계간 대기시간 사용"></label>
      <p class="note">입력 시 본인 계좌인증·하위 메뉴 선택 뒤에 이체대상 계좌번호를 전송합니다. 끝에 #은 붙이지 않습니다. 이체대상 입력이 없는 메뉴는 비워 두세요.</p>` : ''}
      <button type="button" data-apply-menu disabled>이 메뉴 설정 적용</button>
      <span data-menu-status role="status"></span>
      <div class="marks"><button type="button" data-account-result="normal" disabled>정상 · 계좌 기록</button><button type="button" data-account-result="failure" disabled>실패 · 계좌 기록</button></div>
      <p class="note" data-history-status role="status">테스트 후 선택하면 현재 계좌·시각이 이력에 추가됩니다.</p>
    </div>` : '') + controls +
    `<a class="tel" href="${esc(dial)}" data-dtmf="${esc(c.dtmf)}"` +
    ` data-auth="${c.requiresAuth ? '1' : ''}" data-stock="${c.isAgentTransfer || c.entryOnly || c.supportsStockCode === false ? '' : '1'}">전화</a>` +
    `<code class="ds" data-ds>${esc(dial.replace('tel:', ''))}</code><p class="note" data-sequence></p>
      <div data-android-panel hidden>
        <p class="note" data-run-note></p><ol class="dial-steps" data-steps></ol>
        <details class="dial-debug"><summary>발신 전 디버그 정보</summary>
          <p class="note">테스트 데이터 · 원문 표시 및 복사</p>
          <pre data-debug></pre><button type="button" data-copy>디버그 복사</button>
          <textarea data-copy-text readonly hidden aria-label="복사할 디버그 정보"></textarea>
          <span data-copy-status role="status"></span>
        </details>
      </div>`;

  const body = risky
    ? `<details class="guard"><summary>${
        c.isAgentTransfer ? '상담원에게 연결됩니다' : '실제 거래가 될 수 있습니다'
      } — 열어서 전화</summary><div class="grow-row">${link}</div></details>`
    : `<div class="grow-row">${link}</div>`;

  return `<li class="leaf" data-id="${esc(c.id)}" data-kind="${negative ? 'negative' : 'normal'}">
      <div class="head"><span class="code">${esc(code)}</span><span class="name">${esc(label)}</span>${badges(c)}</div>
      <p class="note"><b>${negative ? '오류·예외 · 후보' : '정상'}</b> · 입력 ${esc(c.dtmf.split('').join(' → '))}</p>
      <p class="note" data-expected>기대 동작: ${esc(expected)}</p>
      ${body}
      <div class="marks" data-marks hidden>
        <button type="button" data-v="PASS">PASS</button>
        <button type="button" data-v="FAIL">FAIL</button>
        <button type="button" data-v="BLOCKED">실행불가</button>
        <button type="button" data-v="">미실행</button>
        <span class="verdict" data-verdict></span>
      </div>
    </li>`;
}

function render() {
  let leafCount = 0;

  const sections = buildTree()
    .map((top) => {
      const inner = [];
      // 소메뉴가 없는 항목들은 한 목록으로 모아 둔다. 중간에 끊기면 경계선이 어지러워진다.
      let buffer = [];
      const flush = () => {
        if (buffer.length) inner.push(`<ul class="list">${buffer.join('')}</ul>`);
        buffer = [];
      };

      if (top.code === '3' || top.code === '4') {
        leafCount++;
        buffer.push(leafRow({ id: 'entry-' + top.code, dtmf: top.code, entryOnly: true, requiresAuth: false,
          requiresStockCode: false, isAgentTransfer: false, isFinancialRisk: false },
          '대메뉴 ' + top.code + '번 진입 (이후 직접입력)', top.code));
      }
      if (top.direct) {
        leafCount++;
        buffer.push(leafRow(top.direct, top.label, top.code));
      }

      for (const m of [...top.mids.values()].sort(byMenuCode)) {
        if (m.leaves.length === 0 && m.self) {
          leafCount++;
          buffer.push(leafRow(m.self, m.label, `${top.code}-${m.code}`));
          continue;
        }
        flush();
        const rows = m.leaves
          .sort(byMenuCode)
          .map((l) => {
            leafCount++;
            return leafRow(l, l.label, `${top.code}-${m.code}-${l.code}`);
          })
          .join('');
        inner.push(
          `<details class="mid"><summary><span class="code">${esc(top.code)}-${esc(m.code)}</span>` +
            `<span class="name">${esc(m.label)}</span><span class="cnt">${m.leaves.length}</span></summary>` +
            `<ul class="list">${rows}</ul></details>`,
        );
      }
      flush();
      const negativeRows = menu.negativeCases.filter(c => c.topCode === top.code);
      leafCount += negativeRows.length;
      inner.push('<details class="mid"><summary>오류·예외 후보 · ' + negativeRows.length + '건</summary><p class="note">결번에서 생성한 후보입니다. 음성 입력 등 서비스 특성에 맞는지와 기대 동작을 명세로 확인 후 실행하세요.</p><ul class="list">' + negativeRows.map(c => leafRow(c, c.labels.join(' · '), c.id)).join('') + '</ul></details>');

      return `<details class="top"><summary><span class="name">${esc(top.label)}</span></summary>${inner.join('')}</details>`;
    })
    .join('\n');

  return { sections, leafCount };
}

const { sections, leafCount } = render();

// ------------------------------------------------------------------- 스타일

const CSS = `
:root{--bg:#0f1115;--panel:#171a21;--panel2:#1f232c;--line:#2a2f3a;--text:#e6e8ee;
 --muted:#9aa3b2;--accent:#4f8cff;--pass:#3ecf8e;--fail:#ff5c5c;--warn:#ff8a3d}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
 font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;
 font-size:15px;line-height:1.5;padding:0 16px env(safe-area-inset-bottom) 16px}
.wrap{max-width:640px;margin:0 auto}
header{position:sticky;top:0;background:var(--bg);padding:14px 0 10px;
 border-bottom:1px solid var(--line);z-index:5}
h1{font-size:17px;margin:0 0 4px}
.meta{font-size:12px;color:var(--muted)}
.num{color:var(--accent);font-weight:600}

details{margin:0}
summary{cursor:pointer;list-style:none;-webkit-tap-highlight-color:transparent}
summary::-webkit-details-marker{display:none}

details.top{border:1px solid var(--line);border-radius:10px;margin-top:10px;overflow:hidden}
details.top>summary{padding:14px;background:var(--panel);font-weight:600;
 display:flex;align-items:center;gap:8px}
details.top>summary::before{content:'\\25B8';color:var(--muted);font-size:12px}
details.top[open]>summary::before{content:'\\25BE'}
details.top[open]>summary{border-bottom:1px solid var(--line)}

details.mid{border-top:1px solid var(--line)}
details.mid>summary{padding:11px 14px 11px 22px;display:flex;align-items:center;gap:8px;
 background:var(--panel2);font-size:14px}
details.mid>summary::before{content:'\\25B8';color:var(--muted);font-size:11px}
details.mid[open]>summary::before{content:'\\25BE'}
.cnt{margin-left:auto;font-size:11px;color:var(--muted)}

ul.list{list-style:none;margin:0;padding:0}
li.leaf{padding:12px 14px 12px 30px;border-top:1px solid var(--line)}
li.leaf .head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.code{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--accent);
 background:rgba(79,140,255,.12);padding:2px 6px;border-radius:4px;white-space:nowrap}
.name{flex:1;min-width:0}
.b{font-size:10px;padding:2px 6px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.b.warn{color:var(--warn);border-color:#5c3c22}

.grow-row{display:flex;align-items:center;gap:10px;margin-top:9px;flex-wrap:wrap}
.mode{width:100%;display:flex;gap:12px;align-items:center;font-size:12px;color:var(--muted)}
.mode .mlabel{min-width:56px}
.mode label{display:flex;align-items:center;gap:5px;margin:0;font-size:12px;
 color:var(--muted);cursor:pointer}
.mode input{width:auto;margin:0;accent-color:var(--accent)}
/* 종목코드 지정 대상이 아닌 메뉴 — 설정에서 켤 때만 보인다 */
.mode.optional{display:none}
body.show-stock .mode.optional{display:flex}

a.tel{display:inline-block;padding:9px 20px;border-radius:8px;background:var(--accent);
 color:#fff;text-decoration:none;font-weight:600;font-size:14px}
a.tel:active{opacity:.7}
code.ds{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--muted);
 word-break:break-all;flex:1;min-width:120px}

details.guard{margin-top:9px}
details.guard>summary{font-size:12px;color:var(--warn);padding:8px 10px;
 border:1px dashed #5c3c22;border-radius:8px}

.marks{display:flex;gap:6px;margin-top:9px;align-items:center}
.marks button{padding:5px 12px;font-size:11px;border-radius:6px;border:1px solid var(--line);
 background:var(--panel2);color:var(--text);font-family:inherit}
.verdict{font-size:11px;font-weight:600}
.verdict.PASS{color:var(--pass)} .verdict.FAIL{color:var(--fail)}
li.leaf.done{border-left:3px solid var(--pass);padding-left:27px}
li.leaf.bad{border-left:3px solid var(--fail);padding-left:27px}

.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;
 padding:14px;margin-top:10px}
.panel>summary{font-size:13px;color:var(--muted)}
.sec{margin-top:16px;border-top:1px solid var(--line);padding-top:12px}
.sec b{color:var(--text);font-size:13px}
label{display:block;font-size:12px;color:var(--muted);margin:10px 0 4px}
input,select{width:100%;padding:9px 10px;border-radius:8px;border:1px solid var(--line);
 background:var(--panel2);color:var(--text);font-size:15px;font-family:inherit}
select{appearance:none}
.row{display:flex;gap:8px}.row>div{flex:1}
.note{font-size:12px;color:var(--muted);margin:10px 0 0}
.note.warn{color:var(--warn)}
textarea{width:100%;min-height:120px;margin-top:10px;padding:9px;border-radius:8px;
 border:1px solid var(--line);background:var(--panel2);color:var(--text);
 font-family:ui-monospace,Menlo,monospace;font-size:11px}
button.wide{width:100%;padding:11px;border-radius:8px;border:1px solid var(--line);
 background:var(--panel2);color:var(--text);font-size:13px;margin-top:10px;font-family:inherit}
.check{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;color:var(--text)}
.check input{width:auto;margin:0;accent-color:var(--accent)}
footer{color:var(--muted);font-size:11px;text-align:center;padding:24px 0 32px}
`;

// ------------------------------------------------------------------ 스크립트

/** 스크립트가 도는 환경에서만 얹히는 기능. 없어도 메뉴와 전화는 동작한다. */
const JS = `
(function () {
  var CFG = __CFG__;
  var AUTH_COUNT = __AUTH_COUNT__;
  var NUM = CFG.number.replace(/[^0-9]/g, '');
  var KEY = 'ars-test';

  var store = {
    read: function () { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } },
    write: function (v) { try { localStorage.setItem(KEY, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  var state = store.read();
  var settings = state.settings || {};
  if (isAndroid() && settings.androidFullDefaultVersion !== 1) {
    if (!settings.androidRunMode || settings.androidRunMode === 'adaptive') settings.androidRunMode = 'full';
    settings.androidFullDefaultVersion = 1;
  }
  // 기존 브라우저의 # 붙임 설정도 새 기본값으로 한 번 전환한다.
  if (settings.terminatorDefaultsVersion !== 1) {
    settings.terminator = 'none';
    settings.stockTerminator = 'none';
    settings.terminatorDefaultsVersion = 1;
  }
  var results = state.results || {};
  var notes = state.notes || {};
  var caseAccounts = state.caseAccounts || {};
  var credentials = state.menuCredentials || {};
  var accountHistory = Array.isArray(state.accountHistory) ? state.accountHistory : [];
  delete settings.accountNo;
  delete settings.accountPw;
  // 메뉴별 입력 방식. 'auto' 면 공통 설정 값을 링크에 이어 붙인다.
  var modes = state.modes || { acc: {}, stk: {} };
  if (!modes.acc) modes.acc = {};
  if (!modes.stk) modes.stk = {};

  function save() {
    var ok = store.write({ settings: settings, results: results, modes: modes, notes: notes, caseAccounts: caseAccounts, menuCredentials: credentials, accountHistory: accountHistory });
    if (!ok) document.getElementById('nosave').hidden = false;
    return ok;
  }

  function digitsOf(v) { return (v || '').replace(/[^0-9]/g, ''); }
  function isIos() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  }
  function isAndroid() { return /Android/i.test(navigator.userAgent); }
  function isAndroidWebView() {
    var ua = navigator.userAgent;
    return isAndroid() && (/[; ]wv[;) ]/i.test(ua) ||
      (/Version\\/4\\.0/i.test(ua) && /Chrome\\//i.test(ua)) ||
      /WebView|HTML[ _-]?Viewer|Preview|; ?FBAV|FB_IAB|Instagram|KAKAOTALK|NAVER\\(/i.test(ua));
  }
  function detectedEnvironment() {
    if (isIos()) return 'iOS';
    if (isAndroidWebView()) return 'Android WebView / HTML Viewer / 앱 Preview (추정)';
    if (isAndroid()) return /Chrome\\//i.test(navigator.userAgent) ? 'Android Chrome' : 'Android 브라우저';
    return '기타 브라우저';
  }
  function phoneHref(tel) {
    var mode = settings.dialMode || 'auto';
    var intent = !isIos() && (mode === 'android' || (mode === 'auto' && isAndroidWebView()));
    return intent ? 'intent:' + tel.slice(4) + '#Intent;scheme=tel;action=android.intent.action.DIAL;end' : tel;
  }
  function unit() {
    if (isAndroid()) {
      var configured = Number(settings.androidPauseUnitMs);
      return configured > 0 && isFinite(configured) ? configured : CFG.pauseUnitMs.android;
    }
    return Number(settings.pauseUnitMs) || (isIos() ? CFG.pauseUnitMs.ios : CFG.pauseUnitMs.android);
  }
  var currentPlan;
  function route(tel, sensitive) {
    var candidate = phoneHref(tel), mode = settings.androidRunMode || 'full';
    var limit = Number(settings.androidMaxUriLength);
    var tooLong = limit > 0 && isFinite(limit) && candidate.length > limit;
    var semi = isAndroid() && (mode === 'semi' || (mode === 'adaptive' && (sensitive || tooLong)));
    return { uri: semi ? phoneHref(tel.split(',')[0]) : candidate, candidate: candidate, semi: semi,
      reason: mode === 'semi' ? '반자동 선택' : sensitive ? '계좌·비밀번호·종목 입력 포함' : tooLong ? '사용자 설정 길이 초과' : '자동 입력' };
  }
  function pauses(ms) { return new Array(Math.max(1, Math.ceil(ms / unit())) + 1).join(','); }

  function account(id) { var el = document.getElementById('account-' + id); return el ? digitsOf(el.value) : ''; }
  function stock() { return digitsOf(settings.stockCode || CFG.credentials.stockCode.value); }
  function password(id) { var el = document.getElementById('password-' + id); return el ? digitsOf(el.value) : ''; }

  /**
   * 값이 있어야 '자동'이 의미가 있다. 없으면 무조건 직접입력으로 떨어진다.
   * 종목코드는 추정 대상(기본 표시)만 자동이 기본이고, 숨겨 둔 나머지는 사람이 켜야 붙는다.
   */
  function modeOf(kind, id) {
    var has = kind === 'acc' ? account(id) && password(id) : stock();
    if (!has) return 'manual';
    var m = modes[kind][id];
    if (m) return m;
    return kind === 'stk' && !STOCK_TARGET[id] ? 'manual' : 'auto';
  }

  // 어느 메뉴가 종목코드 지정 대상인지 화면에서 읽어 둔다(숨김 표시 여부로 구분된다).
  var STOCK_TARGET = {};
  (function () {
    var g = document.querySelectorAll('[data-mode="stk"]');
    for (var i = 0; i < g.length; i++) {
      var li = leafOf(g[i]);
      if (li) STOCK_TARGET[li.getAttribute('data-id')] = String(g[i].className).indexOf('optional') < 0;
    }
  })();

  /** 한 케이스의 다이얼 문자열을 조립한다. 빌드 시점 로직과 같은 규칙을 쓴다. */
  function compose(dtmf, useAuth, useStock, id) {
    var num = digitsOf(settings.number || CFG.number) || NUM;
    var first = Number(settings.initialWaitMs) || CFG.initialWaitMs;
    var between = Number(settings.interDigitWaitMs) || CFG.interDigitWaitMs;
    var authWait = Number(settings.authWaitMs) || CFG.authWaitMs;
    var passwordWait = Number(settings.passwordWaitMs) || CFG.passwordWaitMs;
    var stockWait = Number(settings.stockWaitMs) || CFG.stockWaitMs;
    var accTerm = (settings.terminator ? settings.terminator === 'hash' : CFG.credentials.accountNo.terminator === '#') ? '%23' : '';
    var stkTerm = (settings.stockTerminator ? settings.stockTerminator === 'hash' : CFG.credentials.stockCode.terminator === '#') ? '%23' : '';
    // 2·3·4·5·9번은 대메뉴 진입 직후 인증하며 저장된 공통 설정보다 우선한다.
    var pos = /^17./.test(dtmf) ? 'mid' : /^[23459]/.test(dtmf) ? 'top' : settings.authPosition || CFG.authPosition;

    var digits = dtmf.split('');
    // 계좌번호를 어느 단계 뒤에 넣을지. ARS 마다 묻는 시점이 달라 실측으로 맞춘다.
    var at = !useAuth ? -1
      : pos === 'top' ? 0
      : pos === 'mid' ? Math.min(1, digits.length - 1)
      : digits.length - 1;

    var s = 'tel:' + num, masked = s, steps = [];
    function append(value, wait, label, secret) {
      var commas = pauses(wait);
      s += commas + value;
      masked += commas + (secret ? value.replace(/[0-9]/g, 'x') : value);
      steps.push({ label: label, value: value.replace(/%23/g, '#'), secret: secret,
        requested: wait, commas: commas.length, actual: commas.length * unit() });
    }
    for (var j = 0; j < digits.length; j++) {
      append(digits[j], j ? between : first, '메뉴 ' + digits[j], false);
      if (j === at) {
        append(account(id) + accTerm, authWait, '계좌번호' + (accTerm ? '#' : ''), true);
        append(password(id), passwordWait, '비밀번호', true);
      }
    }
    var targetInput = document.getElementById('transfer-' + id);
    var target = /^4./.test(dtmf) && targetInput ? digitsOf(targetInput.value) : '';
    if (target) {
      var waitInput = document.getElementById('transfer-wait-' + id);
      var targetWait = waitInput ? Number(waitInput.value) : 0;
      append(target, targetWait > 0 && isFinite(targetWait) ? targetWait : between, '이체대상 계좌번호', true);
    }
    if (useStock) append(stock() + stkTerm, stockWait, '종목코드' + (stkTerm ? '#' : ''), true);
    currentPlan = { masked: masked, steps: steps, sensitive: useAuth || useStock || !!target };

    return s;
  }

  function leafOf(el) {
    var n = el;
    while (n && !(n.className && String(n.className).indexOf('leaf') >= 0)) n = n.parentNode;
    return n;
  }

  function renderAndroid(a, plan, execution) {
    var panel = a.parentNode.querySelector('[data-android-panel]');
    panel.hidden = false;
    var reveal = true;
    a.parentNode.querySelector('[data-sequence]').hidden = true;
    panel.querySelector('[data-run-note]').textContent = execution.semi
      ? '반자동 · 대표번호로만 연결합니다. 통화 중 전화 앱의 키패드에서 아래 순서대로 직접 입력하세요. 웹 화면은 통화 중 DTMF를 전송하지 않습니다.'
      : '자동 · 아래 대기와 입력값을 전화 앱에 함께 전달합니다.';
    var list = panel.querySelector('[data-steps]');
    while (list.firstChild) list.removeChild(list.firstChild);
    var first = document.createElement('li'); first.textContent = '전화 연결'; list.appendChild(first);
    var sequence = [], commas = 0;
    for (var i = 0; i < plan.steps.length; i++) {
      var step = plan.steps[i]; commas += step.commas;
      var timing = execution.semi ? step.requested : step.actual;
      var label = step.secret ? step.label + (reveal ? ' ' + step.value : ' [가림]') : step.label;
      var text = timing / 1000 + '초 대기 → ' + label + ' (설정 ' + step.requested / 1000 + '초 / 쉼표 ' + step.commas + '개 ≈ ' + step.actual / 1000 + '초)';
      var li = document.createElement('li'); li.textContent = text; list.appendChild(li); sequence.push(text);
    }
    var safeCandidate = phoneHref(plan.masked);
    var uri = reveal || execution.semi ? execution.uri : safeCandidate;
    var text = '환경: ' + detectedEnvironment() + '\\n실행 방식: ' + (execution.uri.indexOf('intent:') === 0 ? 'intent' : 'tel') +
      '\\n모드: ' + (execution.semi ? '반자동' : '자동') + ' · ' + execution.reason +
      '\\n최종 URI' + (!reveal && !execution.semi && plan.sensitive ? ' (민감정보 가림)' : '') + ': ' + uri +
      '\\n최종 URI 길이: ' + execution.uri.length +
      '\\n자동 전달 후보 URI: ' + (reveal ? execution.candidate : safeCandidate) +
      '\\n후보 URI 길이: ' + execution.candidate.length + '\\n길이 기준: ' + (settings.androidMaxUriLength || '미설정') +
      '\\n쉼표 단위: ' + unit() + 'ms / 총 ' + commas + '개 (최종 전달 ' + (execution.semi ? 0 : commas) + '개)' +
      '\\nDTMF 순서:\\n' + sequence.join('\\n');
    panel.querySelector('[data-debug]').textContent = text;
    panel.querySelector('[data-copy-text]').value = text;
  }
  function refresh() {
    var links = document.querySelectorAll('a.tel[data-dtmf]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      // 직접 다이얼 링크처럼 케이스가 아닌 것은 data-dtmf 가 없어 애초에 걸리지 않는다.
      if (!a.getAttribute('data-dtmf')) continue;
      var li = leafOf(a);
      var id = li ? li.getAttribute('data-id') : '';
      var useAuth = !!a.getAttribute('data-auth') && modeOf('acc', id) === 'auto';
      var useStock = !!a.getAttribute('data-stock') && modeOf('stk', id) === 'auto';
      var s = compose(a.getAttribute('data-dtmf'), useAuth, useStock, id);
      var plan = currentPlan, execution = route(s, plan.sensitive);
      a.href = execution.uri;
      var ds = a.parentNode.querySelector('[data-ds]');
      if (ds) ds.textContent = (isAndroid() ? (execution.semi ? s.split(',')[0] : s) : s).slice(4).replace(/%23/g, '#');
      var sequence = a.parentNode.querySelector('[data-sequence]');
      if (sequence) {
        var parts = s.slice(4).split(/(,+)/), steps = ['발신 ' + parts[0]];
        for (var p = 1; p < parts.length; p++) {
          if (!parts[p]) continue;
          if (parts[p].charAt(0) === ',') steps.push('약 ' + parts[p].length * unit() / 1000 + '초 대기');
          else steps.push(parts[p].length === 1 ? '메뉴 ' + parts[p] : '입력값 ' + parts[p].replace(/%23/g, '#'));
        }
        sequence.textContent = steps.join(' → ') + ' · 계좌 ' + (useAuth ? '자동' : '직접입력/해당 없음') + ' · 종목 ' + (useStock ? '자동' : '직접입력/해당 없음');
      }
      if (isAndroid()) renderAndroid(a, plan, execution);
    }
    status();
    probe();
  }

  function countAuto(kind) {
    var n = 0;
    var groups = document.querySelectorAll('[data-mode="' + kind + '"]');
    for (var i = 0; i < groups.length; i++) {
      var li = leafOf(groups[i]);
      if (li && modeOf(kind, li.getAttribute('data-id')) === 'auto') n++;
    }
    return n;
  }

  function mask(v) { return v.replace(/\\d(?=\\d{4})/g, '\\u2022'); }

  function status() {
    var stk = stock();
    document.getElementById('authline').textContent = '메뉴별 계좌 자동 ' + countAuto('acc') + '/' + AUTH_COUNT + '건 | ' +
      (stk ? '종목 ' + stk + ' · 자동 ' + countAuto('stk') + '건' : '종목코드 미입력');
  }

  // 메뉴별 자동/수동 선택
  var groups = document.querySelectorAll('[data-mode]');
  for (var g = 0; g < groups.length; g++) {
    (function (box) {
      var kind = box.getAttribute('data-mode');
      var li = leafOf(box);
      var id = li.getAttribute('data-id');
      box.addEventListener('change', function (e) {
        if (e.target.type !== 'radio') return;
        modes[kind][id] = e.target.value;
        save();
        refresh();
      });
    })(groups[g]);
  }

  function applyModeUI() {
    var all = document.querySelectorAll('[data-mode]');
    for (var i = 0; i < all.length; i++) {
      var kind = all[i].getAttribute('data-mode');
      var want = modeOf(kind, leafOf(all[i]).getAttribute('data-id'));
      var radios = all[i].querySelectorAll('input[type=radio]');
      for (var j = 0; j < radios.length; j++) radios[j].checked = radios[j].value === want;
    }
  }

  function setAll(kind, v) {
    var all = document.querySelectorAll('[data-mode="' + kind + '"]');
    for (var i = 0; i < all.length; i++) modes[kind][leafOf(all[i]).getAttribute('data-id')] = v;
    save();
    applyModeUI();
    refresh();
  }
  document.getElementById('acc-auto').onclick = function () { setAll('acc', 'auto'); };
  document.getElementById('acc-manual').onclick = function () { setAll('acc', 'manual'); };
  document.getElementById('stk-auto').onclick = function () { setAll('stk', 'auto'); };
  document.getElementById('stk-manual').onclick = function () { setAll('stk', 'manual'); };

  // 종목코드 지정이 빗나갔을 때를 위해, 모든 메뉴에서 선택할 수 있게 한다.
  var showAll = document.getElementById('f-showStock');
  showAll.checked = settings.showStock === '1';
  document.body.className = showAll.checked ? 'show-stock' : '';
  showAll.onchange = function () {
    var credentialInputs = document.querySelectorAll('[data-credential]');
    for (var ci = 0; ci < credentialInputs.length; ci++) {
      var input = credentialInputs[ci], id = leafOf(input).getAttribute('data-id');
      if (!credentials[id]) credentials[id] = {};
      credentials[id][input.getAttribute('data-credential')] = input.value;
    }
    settings.showStock = showAll.checked ? '1' : '';
    document.body.className = showAll.checked ? 'show-stock' : '';
    save();
  };

  // 결과 기록
  function paint(li, v) {
    li.className = 'leaf' + (v === 'PASS' ? ' done' : v === 'FAIL' ? ' bad' : '');
    var out = li.querySelector('[data-verdict]');
    out.textContent = v === 'BLOCKED' ? '실행불가' : v || '미실행';
    out.className = 'verdict ' + (v || '');
  }
  var leaves = document.querySelectorAll('li.leaf');
  for (var k = 0; k < leaves.length; k++) {
    (function (li) {
      var marks = li.querySelector('[data-marks]');
      marks.hidden = false;
      var credentialInputs = li.querySelectorAll('[data-credential]');
      function saveMenu() {
        var id = li.getAttribute('data-id');
        credentials[id] = {};
        for (var ci = 0; ci < credentialInputs.length; ci++) credentials[id][credentialInputs[ci].getAttribute('data-credential')] = credentialInputs[ci].value;
        var saved = save(); applyModeUI(); refresh();
        li.querySelector('[data-menu-status]').textContent = account(id) && password(id)
          ? (modeOf('acc', id) === 'auto' ? '이 메뉴 자동 입력 적용' : '직접입력 선택 중') + (saved ? '' : ' · 저장 불가')
          : '계좌번호와 비밀번호를 모두 입력하세요.';
      }
      for (var ci = 0; ci < credentialInputs.length; ci++) {
        var input = credentialInputs[ci];
        input.value = (credentials[li.getAttribute('data-id')] || {})[input.getAttribute('data-credential')] || '';
        input.addEventListener('input', saveMenu); input.addEventListener('change', saveMenu);
      }
      var historyButtons = li.querySelectorAll('[data-account-result]');
      for (var hb = 0; hb < historyButtons.length; hb++) {
        historyButtons[hb].disabled = false;
        historyButtons[hb].onclick = function () {
          var id = li.getAttribute('data-id'), status = li.querySelector('[data-history-status]');
          if (!account(id)) { status.textContent = '테스트한 계좌번호를 먼저 입력하세요.'; return; }
          var result = this.getAttribute('data-account-result');
          accountHistory.push({ caseId: id, title: li.querySelector('.name').textContent,
            account: account(id), result: result, note: '',
            at: new Date().toISOString() });
          var saved = save(); renderHistory();
          status.textContent = (result === 'normal' ? '정상' : '실패') + ' 이력 추가 완료' + (saved ? '' : ' · 저장 불가: CSV로 보관하세요.');
        };
      }
      var menuApply = li.querySelector('[data-apply-menu]');
      if (menuApply) { menuApply.disabled = false; menuApply.onclick = saveMenu; }
      marks.addEventListener('click', function (e) {
        if (e.target.tagName !== 'BUTTON') return;
        var v = e.target.getAttribute('data-v');
        var id = li.getAttribute('data-id');
        if (v) results[id] = v; else delete results[id];
        save();
        paint(li, v);
        count();
        filterCases();
      });
      paint(li, results[li.getAttribute('data-id')] || '');
    })(leaves[k]);
  }
  function count() {
    var totals = { PASS: 0, FAIL: 0, BLOCKED: 0, pending: 0 };
    for (var i = 0; i < leaves.length; i++) {
      var v = results[leaves[i].getAttribute('data-id')] || 'pending';
      totals[v] = (totals[v] || 0) + 1;
    }
    document.getElementById('tally').textContent = ' · PASS ' + totals.PASS + ' / FAIL ' + totals.FAIL;
    document.getElementById('case-summary').textContent = '전체 ' + leaves.length + ' · 미실행 ' + totals.pending + ' · PASS ' + totals.PASS + ' · FAIL ' + totals.FAIL + ' · 실행불가 ' + totals.BLOCKED;
  }
  function filterCases() {
    var kind = document.getElementById('case-kind').value;
    var verdict = document.getElementById('case-result').value;
    var visible = 0;
    for (var i = 0; i < leaves.length; i++) {
      var li = leaves[i], value = results[li.getAttribute('data-id')] || 'pending';
      li.hidden = (kind !== 'all' && li.getAttribute('data-kind') !== kind) || (verdict !== 'all' && value !== verdict);
      if (!li.hidden) visible++;
    }
    var groups = document.querySelectorAll('details.mid, details.top');
    for (var j = 0; j < groups.length; j++) {
      groups[j].hidden = !groups[j].querySelector('li.leaf:not([hidden])');
      if (kind !== 'all' || verdict !== 'all') groups[j].open = true;
    }
    document.getElementById('case-empty').hidden = visible !== 0;
  }
  document.getElementById('case-kind').onchange = filterCases;
  document.getElementById('case-result').onchange = filterCases;

  function selectedHistory() {
    var filter = document.getElementById('history-filter').value;
    return accountHistory.filter(function (row) { return filter === 'all' || row.result === filter; });
  }
  function renderHistory() {
    var rows = selectedHistory(), list = document.getElementById('history-list');
    while (list.firstChild) list.removeChild(list.firstChild);
    var normal = accountHistory.filter(function (row) { return row.result === 'normal'; }).length;
    document.getElementById('history-count').textContent = '전체 ' + accountHistory.length + '건 · 정상 ' + normal + '건 · 실패 ' + (accountHistory.length - normal) + '건';
    document.getElementById('history-empty').hidden = rows.length > 0;
    for (var i = rows.length - 1; i >= 0; i--) {
      var row = rows[i], item = document.createElement('li');
      item.style.whiteSpace = 'pre-wrap';
      item.textContent = (row.result === 'normal' ? '정상' : '실패') + ' · ' + row.caseId + ' ' + row.title +
        '\\n계좌: ' + row.account + (row.note ? '\\n메모: ' + row.note : '') + '\\n시각: ' + new Date(row.at).toLocaleString();
      list.appendChild(item);
    }
  }
  document.getElementById('history-filter').onchange = renderHistory;
  document.getElementById('history-export').onclick = function () {
    function cell(value) {
      var value = String(value || '');
      if (/^[=+@-]/.test(value)) value = "'" + value;
      return '"' + value.replace(/"/g, '""') + '"';
    }
    var rows = selectedHistory(), lines = ['caseId,title,account,result,note,time'];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      lines.push([row.caseId, row.title, row.account, row.result === 'normal' ? '정상' : '실패', row.note, row.at].map(cell).join(','));
    }
    var box = document.getElementById('history-csv'); box.hidden = false; box.value = lines.join('\\n');
    box.focus(); box.select();
    if (typeof URL.createObjectURL !== 'function') return;
    var url = URL.createObjectURL(new Blob(['\\uFEFF' + box.value], { type: 'text/csv;charset=utf-8' }));
    var link = document.createElement('a'); link.href = url; link.download = 'ars-account-history-' + document.getElementById('history-filter').value + '.csv'; link.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };
  renderHistory();

  // 직접 다이얼: 원하는 문자열을 만들어 바로 걸어 본다.
  function probe() {
    var box = document.getElementById('f-probe');
    var link = document.getElementById('probe-tel');
    var raw = (box.value || '').trim();
    if (!raw) { link.removeAttribute('href'); link.textContent = '문자열 입력'; return; }
    raw = raw.replace(/^tel:/i, '').replace(/[^0-9+*#,;]/g, '');
    if (!raw) { link.removeAttribute('href'); link.textContent = '문자열 입력'; return; }
    link.href = route('tel:' + raw.replace(/#/g, '%23'), false).uri;
    link.textContent = '전화';
  }

  var fields = ['androidRunMode', 'androidMaxUriLength', 'androidPauseUnitMs', 'dialMode', 'number', 'stockCode', 'initialWaitMs',
    'interDigitWaitMs', 'pauseUnitMs', 'authWaitMs', 'passwordWaitMs', 'authPosition', 'terminator',
    'stockWaitMs', 'stockTerminator', 'probe'];
  for (var q = 0; q < fields.length; q++) {
    (function (name) {
      var el = document.getElementById('f-' + name);
      if (!el) return;
      if (settings[name] != null && settings[name] !== '') el.value = settings[name];
      function updateField() {
        settings[name] = el.value;
        save();
        applyModeUI();
        refresh();
        document.getElementById('apply-status').textContent = '';
      }
      el.addEventListener('input', updateField);
      el.addEventListener('change', updateField);
    })(fields[q]);
  }

  var androidOptions = document.getElementById('android-options');
  androidOptions.hidden = !isAndroid();
  var panels = document.querySelectorAll('[data-android-panel]');
  for (var pi = 0; pi < panels.length; pi++) {
    (function (panel) {
      panel.querySelector('[data-copy]').onclick = function () {
        applySettings();
        var value = panel.querySelector('[data-debug]').textContent;
        var status = panel.querySelector('[data-copy-status]');
        function fallback() {
          var box = panel.querySelector('[data-copy-text]'); box.hidden = false; box.value = value; box.focus(); box.select();
          var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
          status.textContent = ok ? '복사 완료' : '아래 텍스트를 길게 눌러 복사하세요.';
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(function () { status.textContent = '복사 완료'; }, fallback);
        } else fallback();
      };
    })(panels[pi]);
  }

  var applyButton = document.getElementById('apply-settings');
  applyButton.disabled = false;
  function applySettings() {
    // 모바일 자동완성처럼 input 이벤트가 누락되어도 화면의 현재 값을 직접 읽는다.
    for (var i = 0; i < fields.length; i++) {
      var field = document.getElementById('f-' + fields[i]);
      if (field) settings[fields[i]] = field.value;
    }
    var credentialInputs = document.querySelectorAll('[data-credential]');
    for (var ci = 0; ci < credentialInputs.length; ci++) {
      var input = credentialInputs[ci], id = leafOf(input).getAttribute('data-id');
      if (!credentials[id]) credentials[id] = {};
      credentials[id][input.getAttribute('data-credential')] = input.value;
    }
    settings.showStock = showAll.checked ? '1' : '';
    document.body.className = showAll.checked ? 'show-stock' : '';
    var saved = save();
    applyModeUI();
    refresh();
    document.getElementById('apply-status').textContent = saved
      ? '적용 완료 · 전화 링크를 갱신하고 설정을 저장했습니다. 직접입력으로 선택한 메뉴는 자동 입력되지 않습니다.'
      : '적용 완료 · 전화 링크를 갱신했습니다. 이 환경에서는 저장되지 않아 화면을 닫으면 사라집니다.';
  };

  applyButton.onclick = applySettings;
  // 사용자 클릭의 기본 링크 이동 직전에 갱신하여 자동완성 이벤트 누락도 반영한다.
  var dialLinks = document.querySelectorAll('a.tel');
  for (var dl = 0; dl < dialLinks.length; dl++) dialLinks[dl].addEventListener('click', applySettings);

  document.getElementById('export').onclick = function () {
    function cell(value) {
      var text = String(value || '');
      if (/^[=+@-]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    }
    var lines = ['caseId,type,title,input,expected,verdict,note'];
    for (var i = 0; i < leaves.length; i++) {
      var li = leaves[i], id = li.getAttribute('data-id');
      lines.push([id, li.getAttribute('data-kind') === 'normal' ? '정상' : '오류·예외', li.querySelector('.name').textContent,
        li.querySelector('[data-dtmf]').getAttribute('data-dtmf'), li.querySelector('[data-expected]').textContent,
        results[id] || '미실행', notes[id] || ''].map(cell).join(','));
    }
    var box = document.getElementById('csv');
    box.hidden = false;
    box.value = lines.join('\\n');
    box.focus();
    box.select();
    var blob = new Blob(['\uFEFF' + box.value], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var download = document.createElement('a');
    download.href = url; download.download = 'ars-results.csv'; download.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };

  save();
  document.getElementById('js-on').hidden = false;
  applyModeUI();
  refresh();
  count();
})();
`;

// --------------------------------------------------------------------- 문서

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="format-detection" content="telephone=no">
<title>ARS 메뉴 테스트</title>
<style>${CSS}
[hidden]{display:none!important} [data-note]{width:100%;box-sizing:border-box;min-height:64px} .marks{flex-wrap:wrap} #case-summary{font-weight:700;color:#80c7ff}
[data-apply-menu]{display:block;width:100%;min-height:46px;margin:12px 0 8px;padding:12px 18px;border:1px solid #62a8f5;border-radius:12px;background:#245aa2;color:#fff;font-weight:700;font-size:15px;box-shadow:0 3px 8px #0003}
[data-apply-menu]:active{background:#183f75;transform:translateY(1px)}
[data-apply-menu]:disabled{opacity:.5}
[data-menu-status]{display:block;font-size:12px;margin-bottom:8px}
[data-android-panel],.dial-debug,.dial-steps,[data-debug],.ds{max-width:100%;min-width:0;overflow-wrap:anywhere;word-break:break-word}
[data-debug]{white-space:pre-wrap;font-size:12px;padding:10px;background:#0002;border-radius:8px}
.dial-steps{padding-left:24px}.dial-steps li{padding:8px 4px;border-bottom:1px solid #ffffff18}
.grow-row{min-width:0}.grow-row>*{min-width:0}[data-android-panel]{flex-basis:100%;width:100%}
.row>*{min-width:0}input,select,textarea{max-width:100%;box-sizing:border-box}
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>ARS 메뉴 테스트</h1>
  <div class="meta">
    <span class="num">${esc(cfg.number)}</span> · 시나리오 ${leafCount}건<span id="tally"></span>
    <br><span id="authline">${
      AUTH_BAKED ? `계좌 자동 ${authCount}건` : `계좌번호 미입력 · 인증 ${authCount}건 직접입력`
    }   |   ${STOCK_BAKED ? `종목 ${esc(BAKED_STOCK)} 자동` : '종목코드 미입력'}</span>
  </div>
</header>

<noscript>
  <p class="note warn" style="border:1px dashed #5c3c22;border-radius:8px;padding:10px;margin-top:10px">
    이 환경에서는 스크립트가 실행되지 않습니다. 메뉴와 전화 링크는 그대로 동작하지만,
    아래 설정과 자동/직접입력 선택은 반영되지 않습니다. 계좌번호·종목코드는 안내를 듣고
    직접 누르셔야 합니다.
  </p>
</noscript>

<p class="note">Android에서는 HTML을 Chrome 등 외부 브라우저로 여세요. 파일 미리보기·메신저 안에서는 전화 앱 열기가 제한될 수 있습니다.
전화 앱에서 번호를 확인한 뒤 통화 버튼을 누르세요. ARS 자동 입력 지원은 전화 앱마다 다를 수 있습니다.</p>

<details class="panel">
  <summary>공통 설정</summary>
  <label for="f-dialMode">전화 앱 열기 방식</label>
  <select id="f-dialMode">
    <option value="auto">자동 감지(권장)</option>
    <option value="android">Android WebView(intent)</option>
    <option value="chrome">Android Chrome(tel)</option>
    <option value="tel">iOS·호환모드(tel)</option>
  </select>
  <p class="note">전화 앱이 열리지 않으면 방식을 바꿔 다시 눌러 주세요. 자동 감지는 UA 기반 추정입니다. 감지가 다르면 수동 모드를 선택하세요. tel과 intent 모두 오류가 나면 해당 Viewer가 외부 앱 실행을 지원하지 않는 것이므로 Chrome 등 외부 브라우저로 열어야 합니다.</p>

  <div id="android-options" hidden>
    <h3>Android DTMF 설정</h3>
    <label>입력 방식<select id="f-androidRunMode"><option value="full">항상 자동 전달 (기본)</option><option value="adaptive">자동 판단 (인증·종목 포함 시 반자동)</option><option value="semi">항상 반자동</option></select></label>
    <label>반자동 전환 URI 길이 기준<input id="f-androidMaxUriLength" type="number" min="1" step="1" placeholder="미설정 · 단말에서 확인한 기준 입력"></label>
    <p class="note">단말별 공통 최대 길이는 정하지 않았습니다. 자동 판단 모드에서 최종 자동 전달 후보 URI가 입력한 글자 수를 초과하면 반자동으로 전환합니다. 비워두면 길이로 전환하지 않습니다. 인증·종목 포함 여부는 별도로 판단합니다.</p>
    <label>Android 쉼표 1개에 해당하는 시간 (ms)<input id="f-androidPauseUnitMs" type="number" min="1" value="${cfg.pauseUnitMs.android}"></label>
    <p class="note">쉼표 개수를 계산하는 기준입니다. 실제 전화 앱의 대기시간을 변경하지는 않습니다. 반자동은 안내를 듣고 직접 입력하며, 표시한 시간은 설정값입니다.</p>
  </div>
  <p class="note" id="js-on" hidden>입력값은 전화 링크에 자동 반영됩니다. 휴대폰에서 반영되지 않으면 아래 설정 적용 버튼을 눌러 주세요.</p>
  <p class="note warn" id="nosave" hidden>이 환경에서는 설정·결과가 저장되지 않습니다. 화면을 닫으면 사라집니다.</p>

  <div class="sec" style="border:0;margin-top:4px;padding-top:0">
    <b>계좌 인증 · ${authCount}건</b>
  </div>
  <p class="note">계좌번호와 비밀번호는 인증이 필요한 각 메뉴에서 입력하세요. 두 값이 모두 있어야 자동 입력됩니다. 이전 공통 계좌값은 사용하지 않습니다.</p>
  <label for="f-authWaitMs">계좌번호 앞 대기 (ms)</label>
  <input id="f-authWaitMs" type="tel" inputmode="numeric" placeholder="${cfg.authWaitMs}">
  <p class="note">2·3·4·5·9번 인증 메뉴는 대메뉴 → 계좌번호 → 비밀번호 → 중·소메뉴 순서로 자동 입력합니다. 1-7은 1 → 7 → 계좌번호 → 비밀번호 → 하위 메뉴 순서입니다. 아래 인증 시점 설정과 무관하게 적용됩니다.</p>
  <label for="f-passwordWaitMs">계좌번호 전송 후 비밀번호 앞 대기 (ms)</label>
  <input id="f-passwordWaitMs" type="tel" inputmode="numeric" value="${cfg.passwordWaitMs}">
  <p class="note">기본 12초입니다. 비밀번호 안내가 끝나기 전에 입력되면 이 시간을 늘려 주세요. 실제 안내 시점에 맞춘 확인이 필요합니다.</p>
  <div class="row">
    <div>
      <label for="f-authPosition">계좌번호를 묻는 시점 (2·3·4·5·9번 및 1-7 제외)</label>
      <select id="f-authPosition">
        <option value="end">메뉴를 다 누른 뒤</option>
        <option value="top">대메뉴 누른 직후</option>
        <option value="mid">중메뉴 누른 직후</option>
      </select>
    </div>
    <div>
      <label for="f-terminator">계좌번호 뒤 #</label>
      <select id="f-terminator"><option value="none">안 붙임</option><option value="hash">붙임</option></select>
    </div>
  </div>
  <div class="row">
    <div><button class="wide" type="button" id="acc-auto" style="margin:0">모두 자동</button></div>
    <div><button class="wide" type="button" id="acc-manual" style="margin:0">모두 직접입력</button></div>
  </div>

  <div class="sec">
    <b>종목코드 · 추정 ${stockCount}건</b>
    <p class="note">
      종목코드 사용 여부는 첨부 엑셀의 표시를 반영했습니다. 추가 대상이 있다면 아래를 켜서
      어느 메뉴에서든 종목코드를 붙일 수 있습니다.
    </p>
  </div>
  <label for="f-stockCode">종목코드 · ${STOCK.digits}자리</label>
  <input id="f-stockCode" type="tel" inputmode="numeric" value="${esc(BAKED_STOCK)}" placeholder="예: 005930">
  <div class="row">
    <div>
      <label for="f-stockWaitMs">입력 앞 대기 (ms)</label>
      <input id="f-stockWaitMs" type="tel" inputmode="numeric" placeholder="${cfg.stockWaitMs}">
    </div>
    <div>
      <label for="f-stockTerminator">종목코드 뒤 #</label>
      <select id="f-stockTerminator"><option value="none">안 붙임</option><option value="hash">붙임</option></select>
    </div>
  </div>
  <label class="check"><input type="checkbox" id="f-showStock"> 모든 메뉴에 종목코드 선택 표시</label>
  <button class="wide" type="button" id="apply-settings" disabled>설정 적용 · 전화 링크 갱신</button>
  <p class="note" id="apply-status" role="status" aria-live="polite"></p>
  <noscript><p class="note warn">설정 적용에는 JavaScript가 필요합니다. 버튼이 비활성화되어 있으면 파일 미리보기 대신 Chrome 또는 Safari에서 열어 주세요.</p></noscript>
  <div class="row">
    <div><button class="wide" type="button" id="stk-auto" style="margin:0">모두 자동</button></div>
    <div><button class="wide" type="button" id="stk-manual" style="margin:0">모두 직접입력</button></div>
  </div>

  <div class="sec"><b>발신 · 대기시간</b></div>
  <label for="f-number">발신 번호</label>
  <input id="f-number" type="tel" value="${esc(cfg.number)}">
  <div class="row">
    <div>
      <label for="f-initialWaitMs">초기 대기 (ms)</label>
      <input id="f-initialWaitMs" type="tel" inputmode="numeric" value="${cfg.initialWaitMs}">
    </div>
    <div>
      <label for="f-interDigitWaitMs">단계간 대기 (ms)</label>
      <input id="f-interDigitWaitMs" type="tel" inputmode="numeric" value="${cfg.interDigitWaitMs}">
    </div>
    <div>
      <label for="f-pauseUnitMs">쉼표 1개 (ms)</label>
      <input id="f-pauseUnitMs" type="tel" inputmode="numeric" placeholder="${cfg.pauseUnitMs.ios}">
    </div>
  </div>

  <div class="sec"><b>직접 다이얼</b></div>
  <label for="f-probe">문자열을 직접 만들어 걸어보기 (쉼표 1개 ≈ 2초)</label>
  <input id="f-probe" type="text" placeholder="예: ${NUMBER},,,,2,,1,,,,,,11111111111#,,,,0000">
  <div class="grow-row"><a class="tel probe" id="probe-tel">문자열 입력</a></div>

  <button class="wide" type="button" id="export">결과 CSV 꺼내기</button>
  <textarea id="csv" readonly hidden></textarea>
</details>

<section class="panel" style="padding:16px;margin:16px 0">
  <h2>테스트 케이스 관리</h2>
  <p class="note">ars 테스트 정리.xlsx 반영 · 정상 메뉴 101건 · 계좌인증 ${authCount}건 · 종목코드 ${stockCount}건. 계좌번호·비밀번호는 각 인증 메뉴에서 입력하세요.</p>
  <p class="note">오류·예외도 기대한 대로 처리되면 PASS입니다. 명세가 없는 기대 동작은 확인 후 판정하세요.</p>
  <p id="case-summary" aria-live="polite">정상 ${menu.cases.length}건 · 오류·예외 후보 ${menu.negativeCases.length}건</p>
  <div class="row">
    <label>케이스 분류<select id="case-kind"><option value="all">전체</option><option value="normal">정상 케이스</option><option value="negative">오류·예외 케이스</option></select></label>
    <label>실행 결과<select id="case-result"><option value="all">전체 결과</option><option value="pending">미실행</option><option value="PASS">PASS</option><option value="FAIL">FAIL</option><option value="BLOCKED">실행불가</option></select></label>
  </div>
  <p class="note">기록은 현재 브라우저에 저장됩니다. 공통 설정의 CSV 내보내기로 백업하세요.</p>
  <p id="case-empty" hidden role="status">조건에 맞는 케이스가 없습니다.</p>
</section>
<details class="panel" style="padding:12px;margin:16px 0">
  <summary>계좌 테스트 이력 · 정상 / 실패 모아보기</summary>
  <p id="history-count" aria-live="polite"></p>
  <p class="note">메뉴별 정상·실패 버튼을 누를 때마다 한 건씩 누적됩니다. 기존 PASS/FAIL 결과는 별도로 유지됩니다. 이력에는 비밀번호를 저장하지 않습니다.</p>
  <label>이력 분류<select id="history-filter"><option value="all">전체</option><option value="normal">정상 모아보기</option><option value="failure">실패 모아보기</option></select></label>
  <button type="button" id="history-export">현재 분류 CSV 내보내기</button>
  <textarea id="history-csv" readonly hidden aria-label="계좌 이력 CSV"></textarea>
  <p id="history-empty">기록된 이력이 없습니다.</p>
  <ul id="history-list" class="dial-steps" style="overflow-wrap:anywhere"></ul>
</details>
${sections}

<footer>
  ${esc(menu.source.file)} · ${esc(menu.source.sheet)}<br>
  sha256 ${esc(menu.source.sha256.slice(0, 16))}…
</footer>

</div>
<script>${JS.replace('__CFG__', JSON.stringify(cfg)).replace('__AUTH_COUNT__', String(authCount))}</script>
</body>
</html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);

console.log(`단일 HTML 생성: dist-single/ars-test.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
console.log(`  대메뉴 10 · 시나리오 ${leafCount}건 · 발신 ${cfg.number}`);
console.log(`  계좌 인증 ${authCount}건: ${AUTH_BAKED ? '계좌번호 구워짐 — 자동 입력' : '계좌번호 미설정 — 통화 중 직접 입력'}`);
console.log(`  종목코드 지정 ${stockCount}건: ${STOCK_BAKED ? `${BAKED_STOCK} 구워짐` : '미설정'}`);

const problems = [];
if (/<script[^>]+src=/.test(html)) problems.push('외부 스크립트 참조가 있습니다');
const ext = html.match(/(src|href)="(?!tel:|data:|#)[^"]+"/);
if (ext) problems.push('외부 파일 참조: ' + ext[0]);
const telCount = (html.match(/href="tel:/g) || []).length;
if (telCount !== leafCount) problems.push(`전화 링크 수 불일치: ${telCount} ≠ ${leafCount}`);
try {
  new Function(JS.replace('__CFG__', JSON.stringify(cfg)).replace('__AUTH_COUNT__', String(authCount)));
} catch (e) {
  problems.push('스크립트 문법 오류: ' + e.message);
}
for (const id of ['acc-auto', 'acc-manual', 'stk-auto', 'stk-manual', 'f-showStock', 'f-stockCode', 'probe-tel']) {
  if (!html.includes(`id="${id}"`)) problems.push(`스크립트가 찾는 요소가 없습니다: ${id}`);
}
// 케이스 링크에는 반드시 data-dtmf 가 있어야 한다. 없으면 갱신 루프가 그 자리에서 멈춘다.
const telTags = html.match(/<a class="tel"[^>]*>/g) || [];
const withoutData = telTags.filter((t) => !t.includes('data-dtmf')).length;
if (withoutData !== 0) {
  problems.push(`data-dtmf 없는 a.tel 이 ${withoutData}개 있습니다 (probe 링크는 id 로 분리되어야 합니다)`);
}
if (problems.length) {
  problems.forEach((p) => console.error('  ✗ ' + p));
  process.exit(1);
}
console.log(`  ✓ 전화 링크 ${telCount}개가 HTML 에 미리 박혀 있습니다 — 스크립트 없이도 동작합니다`);
