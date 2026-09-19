/**
 * 배포용 단일 HTML 생성기.
 *
 * 메뉴 트리와 전화 링크를 **빌드 시점에 전부 HTML 로 찍어 둔다.**
 * iOS 파일 앱 미리보기처럼 스크립트가 실행되지 않는 환경에서도
 * 메뉴를 펼치고(`<details>`) 전화를 거는(`<a href="tel:">`) 동작이 그대로 된다.
 *
 * 스크립트가 도는 환경에서는 설정(대기시간·계좌번호)에 따라 링크를 다시 계산하고
 * 결과 기록을 붙인다. 없어도 기본 동작은 유지된다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const menu = JSON.parse(readFileSync(resolve(ROOT, 'src/assets/ars-menu.json'), 'utf-8'));
const cfg = JSON.parse(readFileSync(resolve(ROOT, 'src/assets/ars-config.json'), 'utf-8'));
const OUT = resolve(ROOT, 'dist-single/ars-test.html');

const NUMBER = cfg.number.replace(/[^0-9]/g, '');
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ------------------------------------------------------------------ 트리 구성

/** 시트의 평평한 케이스 목록을 대 → 중 → 소 3단으로 접는다. */
function buildTree() {
  const tops = new Map();
  for (const c of menu.cases) {
    const [t, mid, leaf] = c.id.split('-');
    if (!tops.has(t)) tops.set(t, { code: t, label: c.labels[0], mids: new Map() });
    const top = tops.get(t);

    if (mid === undefined) {
      // 하위가 없는 대메뉴 (7. 말로하는 AI서비스)
      top.direct = c;
      continue;
    }
    if (!top.mids.has(mid)) {
      top.mids.set(mid, { code: mid, label: c.labels[1], leaves: [] });
    }
    const m = top.mids.get(mid);
    if (leaf === undefined) m.self = c;
    else m.leaves.push({ ...c, code: leaf, label: c.labels[2] });
  }
  return [...tops.values()].sort(byMenuCode);
}

/** ARS 에서 0 은 언제나 마지막(상담원 연결)이다. 숫자 정렬만 하면 맨 앞으로 와 버린다. */
const order = (code) => (code === '0' ? 99 : Number(code));
const byMenuCode = (a, b) => order(a.code) - order(b.code);

// ------------------------------------------------------------- 다이얼 문자열

const pauses = (ms, unit) => ','.repeat(Math.max(1, Math.ceil(ms / unit)));

/** 설정에 계좌번호를 넣어 두면 인증 메뉴까지 스크립트 없이 한 번에 눌린다. */
const BAKED_ACCOUNT = (cfg.credentials.accountNo.value || '').replace(/[^0-9]/g, '');
const BAKED_PW = cfg.credentials.accountPw.defaultValue || '';
const AUTH_BAKED = BAKED_ACCOUNT.length === cfg.credentials.accountNo.digits;

/**
 * 빌드 시점의 다이얼 문자열.
 *
 * 인증이 필요한 메뉴는 계좌번호가 설정돼 있으면 비밀번호까지 이어 붙이고,
 * 없으면 메뉴 진입까지만 자동으로 한 뒤 안내를 듣고 직접 누르게 둔다.
 * (스크립트가 도는 환경에서는 설정 화면 입력값으로 다시 계산된다.)
 */
function dialFor(c, unit = cfg.pauseUnitMs.ios) {
  const gap = pauses(cfg.interDigitWaitMs, unit);
  const authGap = pauses(cfg.authWaitMs, unit);
  const term = cfg.credentials.accountNo.terminator === '#' ? '%23' : '';

  // 계좌번호를 어느 단계 뒤에 넣을지. ARS 마다 묻는 시점이 달라 실측으로 맞춘다.
  const afterIndex =
    !c.requiresAuth || !AUTH_BAKED
      ? -1
      : cfg.authPosition === 'top'
        ? 0
        : cfg.authPosition === 'mid'
          ? 1
          : c.dtmf.length - 1;

  let out = `tel:${NUMBER}${pauses(cfg.initialWaitMs, unit)}`;
  const digits = c.dtmf.split('');
  digits.forEach((d, i) => {
    out += (i === 0 ? '' : gap) + d;
    if (i === afterIndex) {
      // `#` 은 URL 에서 프래그먼트 구분자라 그대로 두면 뒤가 잘린다.
      out += `${authGap}${BAKED_ACCOUNT}${term}${authGap}${BAKED_PW}`;
    }
  });
  return out;
}

const badges = (c) =>
  [
    c.requiresAuth
      ? AUTH_BAKED
        ? '<span class="b">계좌 자동</span>'
        : '<span class="b warn">계좌 직접입력</span>'
      : '',
    c.isAgentTransfer ? '<span class="b warn">상담원</span>' : '',
    c.isFinancialRisk ? '<span class="b warn">실거래</span>' : '',
  ].join('');

/** 전화 한 건. 위험한 메뉴는 한 겹 접어서 실수로 눌리지 않게 한다. */
function leafRow(c, label, code) {
  const dial = dialFor(c);
  const shown = dial.replace('tel:', '');
  const risky = c.isAgentTransfer || c.isFinancialRisk;

  // 인증 메뉴는 계좌번호를 자동으로 넣을지 통화 중 직접 누를지 고르게 한다.
  // 자동을 고르면 공통 설정의 계좌번호·비밀번호를 링크에 이어 붙인다.
  const mode = c.requiresAuth
    ? `<div class="mode" data-mode>
        <label><input type="radio" name="am-${esc(c.id)}" value="auto"${AUTH_BAKED ? ' checked' : ''}> 계좌 자동입력</label>
        <label><input type="radio" name="am-${esc(c.id)}" value="manual"${AUTH_BAKED ? '' : ' checked'}> 통화 중 직접입력</label>
       </div>`
    : '';

  const link =
    mode +
    `<a class="tel" href="${esc(dial)}" data-dtmf="${esc(c.dtmf)}"` +
    ` data-auth="${c.requiresAuth ? '1' : ''}">전화</a>` +
    `<code class="ds" data-ds>${esc(shown)}</code>`;

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
  const tree = buildTree();
  let leafCount = 0;

  const sections = tree
    .map((top) => {
      const inner = [];

      // 소메뉴가 없는 항목들은 한 목록으로 모아 둔다. 중간에 끊기면 경계선이 어지러워진다.
      let buffer = [];
      const flush = () => {
        if (!buffer.length) return;
        inner.push(`<ul class="list">${buffer.join('')}</ul>`);
        buffer = [];
      };

      if (top.direct) {
        leafCount++;
        buffer.push(leafRow(top.direct, top.label, top.code));
      }

      for (const m of [...top.mids.values()].sort(byMenuCode)) {
        if (m.leaves.length === 0 && m.self) {
          // 소메뉴가 없는 중메뉴 — 여기서 바로 전화를 건다.
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
const authCount = menu.cases.filter((c) => c.requiresAuth).length;

// ------------------------------------------------------------------- 문서

const CSS = `
:root{--bg:#0f1115;--panel:#171a21;--panel2:#1f232c;--line:#2a2f3a;--text:#e6e8ee;
 --muted:#9aa3b2;--accent:#4f8cff;--pass:#3ecf8e;--fail:#ff5c5c;--warn:#ff8a3d}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
 font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;
 font-size:15px;line-height:1.5;
 padding:0 16px env(safe-area-inset-bottom) 16px}
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
details.top>summary{padding:14px;background:var(--panel);font-weight:600;font-size:15px;
 display:flex;align-items:center;gap:8px}
details.top>summary::before{content:'▸';color:var(--muted);font-size:12px}
details.top[open]>summary::before{content:'▾'}
details.top[open]>summary{border-bottom:1px solid var(--line)}

details.mid{border-top:1px solid var(--line)}
details.mid>summary{padding:11px 14px 11px 22px;display:flex;align-items:center;gap:8px;
 background:var(--panel2);font-size:14px}
details.mid>summary::before{content:'▸';color:var(--muted);font-size:11px}
details.mid[open]>summary::before{content:'▾'}
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
.mode{width:100%;display:flex;gap:14px;font-size:12px;color:var(--muted);margin-bottom:2px}
.mode label{display:flex;align-items:center;gap:5px;margin:0;font-size:12px;cursor:pointer}
.mode input{width:auto;margin:0;accent-color:var(--accent)}
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
footer{color:var(--muted);font-size:11px;text-align:center;padding:24px 0 32px}
`;

/** 스크립트가 도는 환경에서만 얹히는 기능. 없어도 메뉴와 전화는 동작한다. */
const JS = `
(function () {
  var CFG = __CFG__;
  var NUM = CFG.number.replace(/[^0-9]/g, '');
  var KEY = 'ars-test';
  var AUTH_COUNT = __AUTH_COUNT__;

  var store = {
    read: function () { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } },
    write: function (v) { try { localStorage.setItem(KEY, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  var state = store.read();
  var settings = state.settings || {};
  var results = state.results || {};
  // 인증 메뉴별 계좌 입력 방식. 'auto' 면 공통 설정의 계좌번호·비밀번호를 링크에 넣는다.
  var modes = state.modes || {};
  var save = function () {
    return store.write({ settings: settings, results: results, modes: modes });
  };

  function isIos() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  }
  function unit() {
    return Number(settings.pauseUnitMs) || (isIos() ? CFG.pauseUnitMs.ios : CFG.pauseUnitMs.android);
  }
  function pauses(ms) { return new Array(Math.max(1, Math.ceil(ms / unit())) + 1).join(','); }

  // 한 케이스의 다이얼 문자열을 조립한다. 빌드 시점 로직과 같은 규칙을 쓴다.
  function compose(dtmf, needsAuth) {
    var num = (settings.number || CFG.number).replace(/[^0-9]/g, '') || NUM;
    var first = Number(settings.initialWaitMs) || CFG.initialWaitMs;
    var between = Number(settings.interDigitWaitMs) || CFG.interDigitWaitMs;
    var authWait = Number(settings.authWaitMs) || CFG.authWaitMs;
    var acc = (settings.accountNo || '').replace(/[^0-9]/g, '');
    var pw = settings.accountPw || CFG.credentials.accountPw.defaultValue;
    var pos = settings.authPosition || CFG.authPosition;
    var term = settings.terminator === 'none' ? '' : '%23';

    var digits = dtmf.split('');
    // 계좌번호를 어느 단계 뒤에 넣을지. ARS 마다 묻는 시점이 달라 실측으로 맞춘다.
    var at = !needsAuth || !acc ? -1
      : pos === 'top' ? 0
      : pos === 'mid' ? Math.min(1, digits.length - 1)
      : digits.length - 1;

    var s = 'tel:' + num + pauses(first);
    for (var j = 0; j < digits.length; j++) {
      s += (j ? pauses(between) : '') + digits[j];
      if (j === at) s += pauses(authWait) + acc + term + pauses(authWait) + pw;
    }
    return s;
  }

  function modeOf(id) {
    return modes[id] || (defaultAuto() ? 'auto' : 'manual');
  }
  function defaultAuto() {
    return !!(settings.accountNo || '').replace(/[^0-9]/g, '');
  }

  function refresh() {
    var links = document.querySelectorAll('a.tel');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var li = a.closest ? a.closest('li.leaf') : null;
      var id = li ? li.getAttribute('data-id') : '';
      var auto = !!a.getAttribute('data-auth') && modeOf(id) === 'auto';
      var s = compose(a.getAttribute('data-dtmf'), auto);
      a.href = s;
      var ds = a.parentNode.querySelector('[data-ds]');
      if (ds) ds.textContent = s.slice(4);
    }
    var acc = (settings.accountNo || '').replace(/[^0-9]/g, '');
    var autos = document.querySelectorAll('a.tel[data-auth]').length
      ? countAuto() : 0;
    document.getElementById('authline').textContent =
      '인증 메뉴 ' + AUTH_COUNT + '건 · ' +
      (acc
        ? '계좌 ' + acc.replace(/\d(?=\d{4})/g, '\u2022') + ' · 자동 ' + autos + ' / 수동 ' + (AUTH_COUNT - autos)
        : '계좌번호 미입력 — 통화 중 직접 입력');
    probe();
  }

  function countAuto() {
    var n = 0;
    var groups = document.querySelectorAll('[data-mode]');
    for (var i = 0; i < groups.length; i++) {
      if (modeOf(groups[i].closest('li.leaf').getAttribute('data-id')) === 'auto') n++;
    }
    return n;
  }

  // 직접 다이얼: 원하는 문자열을 만들어 바로 걸어 본다.
  function probe() {
    var box = document.getElementById('f-probe');
    var link = document.getElementById('probe-tel');
    if (!box || !link) return;
    var raw = (box.value || '').trim();
    if (!raw) { link.removeAttribute('href'); link.textContent = '문자열 입력'; return; }
    link.href = 'tel:' + raw.replace(/#/g, '%23');
    link.textContent = '전화';
  }

  function paint(li, v) {
    li.className = 'leaf' + (v === 'PASS' ? ' done' : v === 'FAIL' ? ' bad' : '');
    var out = li.querySelector('[data-verdict]');
    out.textContent = v || '';
    out.className = 'verdict ' + (v || '');
  }

  // 인증 메뉴의 자동/수동 선택을 배선한다.
  function applyModeUI() {
    var groups = document.querySelectorAll('[data-mode]');
    for (var i = 0; i < groups.length; i++) {
      var li = groups[i].closest('li.leaf');
      var id = li.getAttribute('data-id');
      var want = modeOf(id);
      var radios = groups[i].querySelectorAll('input[type=radio]');
      for (var j = 0; j < radios.length; j++) radios[j].checked = radios[j].value === want;
    }
  }

  var modeGroups = document.querySelectorAll('[data-mode]');
  for (var g = 0; g < modeGroups.length; g++) {
    (function (box) {
      var id = box.closest('li.leaf').getAttribute('data-id');
      box.addEventListener('change', function (e) {
        if (e.target.type !== 'radio') return;
        modes[id] = e.target.value;
        if (!save()) document.getElementById('nosave').hidden = false;
        refresh();
      });
    })(modeGroups[g]);
  }

  function setAll(v) {
    var groups = document.querySelectorAll('[data-mode]');
    for (var i = 0; i < groups.length; i++) {
      modes[groups[i].closest('li.leaf').getAttribute('data-id')] = v;
    }
    save();
    applyModeUI();
    refresh();
  }
  document.getElementById('all-auto').addEventListener('click', function () { setAll('auto'); });
  document.getElementById('all-manual').addEventListener('click', function () { setAll('manual'); });

  // 결과 기록 버튼을 켠다(스크립트가 없으면 숨겨진 채로 남는다).
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
    document.getElementById('tally').textContent =
      p + f ? ' · PASS ' + p + ' / FAIL ' + f : '';
  }

  // 설정 입력
  var fields = ['number', 'accountNo', 'accountPw', 'initialWaitMs', 'interDigitWaitMs',
    'pauseUnitMs', 'authWaitMs', 'authPosition', 'terminator', 'probe'];
  for (var q = 0; q < fields.length; q++) {
    (function (name) {
      var el = document.getElementById('f-' + name);
      if (!el) return;
      if (settings[name] != null && settings[name] !== '') el.value = settings[name];
      var evt = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(evt, function () {
        settings[name] = el.value;
        if (!save()) document.getElementById('nosave').hidden = false;
        refresh();
      });
    })(fields[q]);
  }

  document.getElementById('export').addEventListener('click', function () {
    var lines = ['caseId,verdict'], n;
    for (n in results) lines.push(n + ',' + results[n]);
    var box = document.getElementById('csv');
    box.hidden = false;
    box.value = lines.join('\\n');
    box.focus();
    box.select();
  });

  if (!store.write({ settings: settings, results: results })) {
    document.getElementById('nosave').hidden = false;
  }
  document.getElementById('js-on').hidden = false;
  applyModeUI();
  refresh();
  count();
})();
`;

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
      AUTH_BAKED
        ? `인증 메뉴 ${authCount}건 · 계좌 ${BAKED_ACCOUNT.replace(/\d(?=\d{4})/g, '•')} 자동 입력`
        : `인증 메뉴 ${authCount}건 · 계좌번호는 통화 중 직접 입력`
    }</span>
  </div>
</header>

<noscript>
  <p class="note warn" style="border:1px dashed #5c3c22;border-radius:8px;padding:10px;margin-top:10px">
    이 환경에서는 스크립트가 실행되지 않습니다. 메뉴와 전화 링크는 그대로 동작하지만,
    아래 설정값은 반영되지 않고 계좌번호·비밀번호는 안내를 듣고 직접 누르셔야 합니다.
  </p>
</noscript>

<details class="panel">
  <summary>설정 · 계좌번호 입력</summary>

  <p class="note" id="js-on" hidden>입력한 값이 아래 전화 링크에 바로 반영됩니다.</p>
  <p class="note warn" id="nosave" hidden>이 환경에서는 설정·결과가 저장되지 않습니다. 화면을 닫으면 사라집니다.</p>

  <label for="f-accountNo">계좌번호 · ${cfg.credentials.accountNo.digits}자리 (인증 메뉴 ${authCount}건에 사용)</label>
  <input id="f-accountNo" type="tel" inputmode="numeric" value="${esc(BAKED_ACCOUNT)}" placeholder="비워두면 통화 중 직접 입력">

  <div class="row">
    <div>
      <label for="f-accountPw">계좌비밀번호</label>
      <input id="f-accountPw" type="tel" inputmode="numeric" value="${esc(cfg.credentials.accountPw.defaultValue)}">
    </div>
    <div>
      <label for="f-number">발신 번호</label>
      <input id="f-number" type="tel" value="${esc(cfg.number)}">
    </div>
  </div>

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

  <p class="note" style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
    <b style="color:var(--text)">계좌번호 입력이 안 될 때</b> — 아래 세 값을 바꿔가며 맞춰보세요.
    시트에 인증 단계 정보가 없어 현재 값은 추정입니다.
  </p>

  <div class="row" style="margin-top:10px">
    <div><button class="wide" type="button" id="all-auto" style="margin:0">인증 ${authCount}건 모두 자동</button></div>
    <div><button class="wide" type="button" id="all-manual" style="margin:0">모두 수동</button></div>
  </div>

  <label for="f-authPosition">계좌번호를 묻는 시점</label>
  <select id="f-authPosition">
    <option value="end">메뉴를 다 누른 뒤 (기본)</option>
    <option value="top">대메뉴 누른 직후</option>
    <option value="mid">중메뉴 누른 직후</option>
  </select>

  <div class="row">
    <div>
      <label for="f-authWaitMs">계좌번호 앞 대기 (ms)</label>
      <input id="f-authWaitMs" type="tel" inputmode="numeric" placeholder="${cfg.authWaitMs}">
    </div>
    <div>
      <label for="f-terminator">계좌번호 뒤 #</label>
      <select id="f-terminator">
        <option value="hash">붙임 (기본)</option>
        <option value="none">안 붙임</option>
      </select>
    </div>
  </div>

  <label for="f-probe">직접 다이얼 — 문자열을 직접 만들어 걸어보기</label>
  <input id="f-probe" type="text" placeholder="예: 0263016001,,,,2,,1,,,,12345678901#,,,,0000">
  <div class="grow-row"><a class="tel" id="probe-tel">문자열 입력</a></div>
  <p class="note">
    쉼표 1개 ≈ 2초입니다. 쉼표를 늘려 대기를 길게 잡아보고, 되는 조합을 찾으면
    위 설정에 반영하세요. <code>#</code>은 그대로 입력하시면 됩니다.
  </p>

  <button class="wide" type="button" id="export">결과 CSV 꺼내기</button>
  <textarea id="csv" readonly hidden></textarea>

  <p class="note">
    대기시간은 추정값입니다. 멘트가 끝나기 전에 눌리면 초기·단계간 대기를 늘리세요.
    쉼표 1개가 실제 몇 ms인지는 단말마다 다릅니다.
  </p>
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

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`단일 HTML 생성: dist-single/ars-test.html (${kb} KB)`);
console.log(`  대메뉴 10 · 시나리오 ${leafCount}건 · 발신 ${cfg.number}`);
console.log(
  AUTH_BAKED
    ? `  인증 ${authCount}건: 계좌번호 구워짐 — 스크립트 없이도 자동 입력됩니다`
    : `  인증 ${authCount}건: 계좌번호 미설정 — 통화 중 직접 입력해야 합니다`,
);

const problems = [];
if (/<script[^>]+src=/.test(html)) problems.push('외부 스크립트 참조가 있습니다');
if (/(src|href)="(?!tel:|data:|#)[^"]+"/.test(html)) {
  problems.push('외부 파일 참조: ' + html.match(/(src|href)="(?!tel:|data:|#)[^"]+"/)[0]);
}
const telCount = (html.match(/href="tel:/g) || []).length;
if (telCount !== leafCount) problems.push(`전화 링크 수가 맞지 않습니다: ${telCount} ≠ ${leafCount}`);
try {
  new Function(JS.replace('__CFG__', JSON.stringify(cfg)));
} catch (e) {
  problems.push('스크립트 문법 오류: ' + e.message);
}
if (problems.length) {
  problems.forEach((p) => console.error('  ✗ ' + p));
  process.exit(1);
}
console.log(`  ✓ 전화 링크 ${telCount}개가 HTML 에 미리 박혀 있습니다 — 스크립트 없이도 동작합니다`);
