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

const NUMBER = cfg.number.replace(/[^0-9]/g, '');
const ACC = cfg.credentials.accountNo;
const PW = cfg.credentials.accountPw;
const STOCK = cfg.credentials.stockCode;

const BAKED_ACCOUNT = (ACC.value || '').replace(/[^0-9]/g, '');
const BAKED_PW = PW.defaultValue || '';
const BAKED_STOCK = (STOCK.value || '').replace(/[^0-9]/g, '');
const AUTH_BAKED = BAKED_ACCOUNT.length === ACC.digits;
const STOCK_BAKED = BAKED_STOCK.length === STOCK.digits;

const authCount = menu.cases.filter((c) => c.requiresAuth).length;
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
    : cfg.authPosition === 'top'
      ? 0
      : cfg.authPosition === 'mid'
        ? Math.min(1, digits.length - 1)
        : digits.length - 1;

  let out = `tel:${NUMBER}${pauses(cfg.initialWaitMs, unit)}`;
  digits.forEach((d, i) => {
    out += (i === 0 ? '' : gap) + d;
    if (i === at) out += `${authGap}${BAKED_ACCOUNT}${accTerm}${authGap}${BAKED_PW}`;
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
    c.isFinancialRisk ? '<span class="b warn">실거래</span>' : '',
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
  const risky = c.isAgentTransfer || c.isFinancialRisk;

  const controls =
    (c.requiresAuth ? modeRow(c.id, 'acc', '계좌번호', AUTH_BAKED, false) : '') +
    // 종목코드는 추정이라, 대상이 아닌 메뉴에도 숨긴 채로 넣어 둔다.
    // 설정에서 "모든 메뉴에 표시"를 켜면 드러난다.
    (c.isAgentTransfer ? '' : modeRow(c.id, 'stk', '종목코드', STOCK_BAKED && c.requiresStockCode, !c.requiresStockCode));

  const link =
    controls +
    `<a class="tel" href="${esc(dial)}" data-dtmf="${esc(c.dtmf)}"` +
    ` data-auth="${c.requiresAuth ? '1' : ''}" data-stock="${c.isAgentTransfer ? '' : '1'}">전화</a>` +
    `<code class="ds" data-ds>${esc(dial.replace('tel:', ''))}</code>`;

  const body = risky
    ? `<details class="guard"><summary>${
        c.isAgentTransfer ? '상담원에게 연결됩니다' : '실제 거래가 될 수 있습니다'
      } — 열어서 전화</summary><div class="grow-row">${link}</div></details>`
    : `<div class="grow-row">${link}</div>`;

  return `<li class="leaf" data-id="${esc(c.id)}">
      <div class="head"><span class="code">${esc(code)}</span><span class="name">${esc(label)}</span>${badges(c)}</div>
      ${body}
      <div class="marks" data-marks hidden>
        <button type="button" data-v="PASS">PASS</button>
        <button type="button" data-v="FAIL">FAIL</button>
        <button type="button" data-v="">지움</button>
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
/* 종목코드 추정 대상이 아닌 메뉴 — 설정에서 켤 때만 보인다 */
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
  var results = state.results || {};
  // 메뉴별 입력 방식. 'auto' 면 공통 설정 값을 링크에 이어 붙인다.
  var modes = state.modes || { acc: {}, stk: {} };
  if (!modes.acc) modes.acc = {};
  if (!modes.stk) modes.stk = {};

  function save() {
    var ok = store.write({ settings: settings, results: results, modes: modes });
    if (!ok) document.getElementById('nosave').hidden = false;
    return ok;
  }

  function digitsOf(v) { return (v || '').replace(/[^0-9]/g, ''); }
  function isIos() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  }
  // 특정 전화 앱 패키지를 고정하지 않고 기본 다이얼러를 연다.
  function phoneHref(tel) {
    var mode = settings.dialMode || 'auto';
    var android = mode === 'android' || (mode === 'auto' && /Android/i.test(navigator.userAgent));
    return android
      ? 'intent:' + tel.slice(4) + '#Intent;scheme=tel;action=android.intent.action.DIAL;end'
      : tel;
  }
  function unit() {
    return Number(settings.pauseUnitMs) || (isIos() ? CFG.pauseUnitMs.ios : CFG.pauseUnitMs.android);
  }
  function pauses(ms) { return new Array(Math.max(1, Math.ceil(ms / unit())) + 1).join(','); }

  function account() { return digitsOf(settings.accountNo || CFG.credentials.accountNo.value); }
  function stock() { return digitsOf(settings.stockCode || CFG.credentials.stockCode.value); }
  function password() { return settings.accountPw || CFG.credentials.accountPw.defaultValue; }

  /**
   * 값이 있어야 '자동'이 의미가 있다. 없으면 무조건 직접입력으로 떨어진다.
   * 종목코드는 추정 대상(기본 표시)만 자동이 기본이고, 숨겨 둔 나머지는 사람이 켜야 붙는다.
   */
  function modeOf(kind, id) {
    var has = kind === 'acc' ? account() : stock();
    if (!has) return 'manual';
    var m = modes[kind][id];
    if (m) return m;
    return kind === 'stk' && !STOCK_TARGET[id] ? 'manual' : 'auto';
  }

  // 어느 메뉴가 종목코드 추정 대상인지 화면에서 읽어 둔다(숨김 표시 여부로 구분된다).
  var STOCK_TARGET = {};
  (function () {
    var g = document.querySelectorAll('[data-mode="stk"]');
    for (var i = 0; i < g.length; i++) {
      var li = leafOf(g[i]);
      if (li) STOCK_TARGET[li.getAttribute('data-id')] = String(g[i].className).indexOf('optional') < 0;
    }
  })();

  /** 한 케이스의 다이얼 문자열을 조립한다. 빌드 시점 로직과 같은 규칙을 쓴다. */
  function compose(dtmf, useAuth, useStock) {
    var num = digitsOf(settings.number || CFG.number) || NUM;
    var first = Number(settings.initialWaitMs) || CFG.initialWaitMs;
    var between = Number(settings.interDigitWaitMs) || CFG.interDigitWaitMs;
    var authWait = Number(settings.authWaitMs) || CFG.authWaitMs;
    var stockWait = Number(settings.stockWaitMs) || CFG.stockWaitMs;
    var accTerm = settings.terminator === 'none' ? '' : '%23';
    var stkTerm = settings.stockTerminator === 'none' ? '' : '%23';
    var pos = settings.authPosition || CFG.authPosition;

    var digits = dtmf.split('');
    // 계좌번호를 어느 단계 뒤에 넣을지. ARS 마다 묻는 시점이 달라 실측으로 맞춘다.
    var at = !useAuth ? -1
      : pos === 'top' ? 0
      : pos === 'mid' ? Math.min(1, digits.length - 1)
      : digits.length - 1;

    var s = 'tel:' + num + pauses(first);
    for (var j = 0; j < digits.length; j++) {
      s += (j ? pauses(between) : '') + digits[j];
      if (j === at) s += pauses(authWait) + account() + accTerm + pauses(authWait) + password();
    }
    if (useStock) s += pauses(stockWait) + stock() + stkTerm;
    return s;
  }

  function leafOf(el) {
    var n = el;
    while (n && !(n.className && String(n.className).indexOf('leaf') >= 0)) n = n.parentNode;
    return n;
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
      var s = compose(a.getAttribute('data-dtmf'), useAuth, useStock);
      a.href = phoneHref(s);
      var ds = a.parentNode.querySelector('[data-ds]');
      if (ds) ds.textContent = s.slice(4);
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
    var acc = account(), stk = stock();
    document.getElementById('authline').textContent =
      (acc ? '계좌 ' + mask(acc) + ' · 자동 ' + countAuto('acc') + '/' + AUTH_COUNT
           : '계좌번호 미입력 · 인증 ' + AUTH_COUNT + '건 직접입력') +
      '   |   ' +
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

  // 종목코드 추정이 빗나갔을 때를 위해, 모든 메뉴에서 선택할 수 있게 한다.
  var showAll = document.getElementById('f-showStock');
  showAll.checked = settings.showStock === '1';
  document.body.className = showAll.checked ? 'show-stock' : '';
  showAll.onchange = function () {
    settings.showStock = showAll.checked ? '1' : '';
    document.body.className = showAll.checked ? 'show-stock' : '';
    save();
  };

  // 결과 기록
  function paint(li, v) {
    li.className = 'leaf' + (v === 'PASS' ? ' done' : v === 'FAIL' ? ' bad' : '');
    var out = li.querySelector('[data-verdict]');
    out.textContent = v || '';
    out.className = 'verdict ' + (v || '');
  }
  var leaves = document.querySelectorAll('li.leaf');
  for (var k = 0; k < leaves.length; k++) {
    (function (li) {
      var marks = li.querySelector('[data-marks]');
      marks.hidden = false;
      marks.addEventListener('click', function (e) {
        if (e.target.tagName !== 'BUTTON') return;
        var v = e.target.getAttribute('data-v');
        var id = li.getAttribute('data-id');
        if (v) results[id] = v; else delete results[id];
        save();
        paint(li, v);
        count();
      });
      paint(li, results[li.getAttribute('data-id')] || '');
    })(leaves[k]);
  }
  function count() {
    var p = 0, f = 0, n;
    for (n in results) { if (results[n] === 'PASS') p++; else if (results[n] === 'FAIL') f++; }
    document.getElementById('tally').textContent = p + f ? ' · PASS ' + p + ' / FAIL ' + f : '';
  }

  // 직접 다이얼: 원하는 문자열을 만들어 바로 걸어 본다.
  function probe() {
    var box = document.getElementById('f-probe');
    var link = document.getElementById('probe-tel');
    var raw = (box.value || '').trim();
    if (!raw) { link.removeAttribute('href'); link.textContent = '문자열 입력'; return; }
    raw = raw.replace(/^tel:/i, '').replace(/[^0-9+*#,;]/g, '');
    if (!raw) { link.removeAttribute('href'); link.textContent = '문자열 입력'; return; }
    link.href = phoneHref('tel:' + raw.replace(/#/g, '%23'));
    link.textContent = '전화';
  }

  var fields = ['dialMode', 'number', 'accountNo', 'accountPw', 'stockCode', 'initialWaitMs',
    'interDigitWaitMs', 'pauseUnitMs', 'authWaitMs', 'authPosition', 'terminator',
    'stockWaitMs', 'stockTerminator', 'probe'];
  for (var q = 0; q < fields.length; q++) {
    (function (name) {
      var el = document.getElementById('f-' + name);
      if (!el) return;
      if (settings[name] != null && settings[name] !== '') el.value = settings[name];
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
        settings[name] = el.value;
        save();
        applyModeUI();
        refresh();
      });
    })(fields[q]);
  }

  document.getElementById('export').onclick = function () {
    var lines = ['caseId,verdict'], n;
    for (n in results) lines.push(n + ',' + results[n]);
    var box = document.getElementById('csv');
    box.hidden = false;
    box.value = lines.join('\\n');
    box.focus();
    box.select();
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
<style>${CSS}</style>
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
    <option value="auto">자동 감지 (Android / iOS)</option>
    <option value="android">Android 전화 앱</option>
    <option value="tel">기본 전화 링크 (iOS / 호환 모드)</option>
  </select>
  <p class="note">전화 앱이 열리지 않으면 방식을 바꿔 다시 눌러 주세요. 이 설정은 스크립트가 실행되는 브라우저에서 적용됩니다.</p>

  <p class="note" id="js-on" hidden>입력한 값이 아래 전화 링크에 바로 반영됩니다.</p>
  <p class="note warn" id="nosave" hidden>이 환경에서는 설정·결과가 저장되지 않습니다. 화면을 닫으면 사라집니다.</p>

  <div class="sec" style="border:0;margin-top:4px;padding-top:0">
    <b>계좌 인증 · ${authCount}건</b>
  </div>
  <label for="f-accountNo">계좌번호 · ${ACC.digits}자리</label>
  <input id="f-accountNo" type="tel" inputmode="numeric" value="${esc(BAKED_ACCOUNT)}" placeholder="비워두면 통화 중 직접 입력">
  <div class="row">
    <div>
      <label for="f-accountPw">계좌비밀번호</label>
      <input id="f-accountPw" type="tel" inputmode="numeric" value="${esc(BAKED_PW)}">
    </div>
    <div>
      <label for="f-authWaitMs">입력 앞 대기 (ms)</label>
      <input id="f-authWaitMs" type="tel" inputmode="numeric" placeholder="${cfg.authWaitMs}">
    </div>
  </div>
  <div class="row">
    <div>
      <label for="f-authPosition">계좌번호를 묻는 시점</label>
      <select id="f-authPosition">
        <option value="end">메뉴를 다 누른 뒤</option>
        <option value="top">대메뉴 누른 직후</option>
        <option value="mid">중메뉴 누른 직후</option>
      </select>
    </div>
    <div>
      <label for="f-terminator">계좌번호 뒤 #</label>
      <select id="f-terminator"><option value="hash">붙임</option><option value="none">안 붙임</option></select>
    </div>
  </div>
  <div class="row">
    <div><button class="wide" type="button" id="acc-auto" style="margin:0">모두 자동</button></div>
    <div><button class="wide" type="button" id="acc-manual" style="margin:0">모두 직접입력</button></div>
  </div>

  <div class="sec">
    <b>종목코드 · 추정 ${stockCount}건</b>
    <p class="note">
      시트에 입력 단계 정보가 없어 메뉴명으로 추정했습니다. 빗나갔다면 아래를 켜서
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
      <select id="f-stockTerminator"><option value="hash">붙임</option><option value="none">안 붙임</option></select>
    </div>
  </div>
  <label class="check"><input type="checkbox" id="f-showStock"> 모든 메뉴에 종목코드 선택 표시</label>
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
console.log(`  종목코드 추정 ${stockCount}건: ${STOCK_BAKED ? `${BAKED_STOCK} 구워짐` : '미설정'}`);

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
