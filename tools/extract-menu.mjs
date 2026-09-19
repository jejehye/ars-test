/**
 * ARS 메뉴 추출기
 *
 * `27년최종ARS메뉴` 시트를 읽어 테스트 케이스 JSON을 생성한다.
 *
 * 원본 xlsx는 절대 수정하지 않는다:
 *  - 읽기 전용(`readFileSync`)으로만 접근한다.
 *  - 실행 전후 SHA-256을 비교하고, 달라지면 즉시 실패한다.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const XLSX = resolve(ROOT, 'ARS변경내역_최종_0904.xlsx');
const OUT = resolve(ROOT, 'src/assets/ars-menu.json');
const CONFIG_SAMPLE = resolve(ROOT, 'config/ars.config.sample.json');
const CONFIG_LOCAL = resolve(ROOT, 'config/ars.config.json');
const CONFIG_OUT = resolve(ROOT, 'src/assets/ars-config.json');
const SHEET_NAME = '27년최종ARS메뉴';

/** 원본 무결성 검증에 쓰는 기준 해시. 시트를 개정하면 이 값을 갱신한다. */
const EXPECTED_SHA256 =
  '0caf0e230a4c2e1793bc8afe4f86697af34198abe8f5591c88777c0f38e6978f';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------- xlsx 파싱

/** xlsx는 zip이다. XML 파서 없이 필요한 태그만 정규식으로 긁는다. */
function readSheet(zip, sheetName) {
  const workbook = strFromU8(zip['xl/workbook.xml']);
  const rels = strFromU8(zip['xl/_rels/workbook.xml.rels']);

  const sheetTag = [...workbook.matchAll(/<sheet\b[^>]*\/>/g)]
    .map((m) => m[0])
    .find((tag) => tag.includes(`name="${sheetName}"`));
  if (!sheetTag) throw new Error(`시트를 찾을 수 없습니다: ${sheetName}`);

  const rId = /r:id="([^"]+)"/.exec(sheetTag)[1];
  const target = new RegExp(`Id="${rId}"[^>]*Target="([^"]+)"`).exec(rels)[1];

  return strFromU8(zip[`xl/${target.replace(/^\/?xl\//, '')}`]);
}

function readSharedStrings(zip) {
  const xml = strFromU8(zip['xl/sharedStrings.xml']);
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((t) => decodeXml(t[1]))
      .join(''),
  );
}

const decodeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, '&');

/** 셀 주소("C12")의 열 문자를 0-based 인덱스로 바꾼다. */
function columnIndex(ref) {
  const letters = /^([A-Z]+)/.exec(ref)[1];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 시트 XML을 `{ 행번호: { 열인덱스: 값 } }` 형태로 편다. */
function toGrid(sheetXml, shared) {
  const grid = new Map();
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = new Map();
    // 값이 없는 셀은 `<c .../>` 로 닫히므로 두 형태를 함께 받는다.
    const CELL = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    for (const cell of rowMatch[2].matchAll(CELL)) {
      const attrs = cell[1];
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      const isShared = /t="s"/.test(attrs);
      const raw = /<v>([\s\S]*?)<\/v>/.exec(cell[2] ?? '')?.[1];
      if (raw == null) continue;
      const value = isShared ? shared[Number(raw)] : decodeXml(raw);
      const normalized = value.replace(/\s+/g, ' ').trim();
      if (normalized) cells.set(columnIndex(ref), normalized);
    }
    grid.set(Number(rowMatch[1]), cells);
  }
  return grid;
}

// ------------------------------------------------------------- 케이스 생성

const COL = { TOP: 0, SEQ: 1, MID_CODE: 2, MID: 3, LEAF_CODE: 4, LEAF: 5, NOTE: 6 };

/** 대메뉴 3(주문)·4(이체)는 실제 체결/송금이 일어날 수 있다. */
const FINANCIAL_RISK_TOPS = new Set(['3', '4']);

/** 인증(계좌번호+비밀번호)을 요구할 것으로 보이는 대메뉴. Phase 0 실측으로 확정한다. */
const AUTH_TOPS = new Set(['2', '3', '4', '5']);

function buildCases(grid) {
  const cases = [];
  let top = null;
  let mid = null;

  for (let row = 5; row <= 105; row++) {
    const cells = grid.get(row);
    if (!cells || cells.size === 0) continue;

    if (cells.has(COL.TOP)) {
      const label = cells.get(COL.TOP);
      top = { code: label.split('.')[0].trim(), label };
      mid = null;
    }
    if (!top) continue;

    if (cells.has(COL.MID_CODE)) {
      mid = { code: cells.get(COL.MID_CODE), label: cells.get(COL.MID) ?? '' };
    }

    const seq = cells.has(COL.SEQ) ? Number(cells.get(COL.SEQ)) : null;
    if (seq == null) continue;

    const note = cells.get(COL.NOTE);

    if (cells.has(COL.LEAF)) {
      // 소메뉴 행: 대-중-소 3단계
      cases.push(
        makeCase({
          top,
          path: [
            { code: mid.code, label: mid.label },
            { code: cells.get(COL.LEAF_CODE), label: cells.get(COL.LEAF) },
          ],
          seq,
          note,
        }),
      );
    } else if (cells.has(COL.MID_CODE)) {
      // 소메뉴가 없는 중메뉴: 대-중 2단계
      cases.push(makeCase({ top, path: [{ code: mid.code, label: mid.label }], seq, note }));
    } else {
      // 하위 메뉴가 없는 대메뉴(7. 말로하는 AI서비스): 1단계
      cases.push(makeCase({ top, path: [], seq, note }));
    }
  }

  // 소메뉴를 가진 중메뉴는 그 자체로 도달 지점이 아니므로 케이스에서 제외한다.
  const parentsWithChildren = new Set(
    cases.filter((c) => c.depth === 3).map((c) => `${c.id.split('-').slice(0, 2).join('-')}`),
  );
  return cases.filter((c) => !(c.depth === 2 && parentsWithChildren.has(c.id)));
}

function makeCase({ top, path, seq, note }) {
  const codes = [top.code, ...path.map((p) => p.code)];
  const labels = [top.label, ...path.map((p) => p.label)];
  const leafLabel = labels[labels.length - 1];
  const requiresAuth = AUTH_TOPS.has(top.code) && !/상담원/.test(leafLabel);

  return {
    id: codes.join('-'),
    seq,
    topCode: top.code,
    dtmf: codes.join(''),
    depth: codes.length,
    labels,
    isAgentTransfer: /상담원/.test(leafLabel),
    isFinancialRisk: FINANCIAL_RISK_TOPS.has(top.code),
    requiresAuth,
    steps: buildSteps(codes, requiresAuth),
    expectedKeywords: keywordsFrom(leafLabel),
    ...(note ? { note } : {}),
  };
}

/**
 * 실행 스텝. 인증이 필요한 메뉴는 마지막 코드 입력 뒤에 계좌번호·비밀번호가 온다고 본다.
 * 실제 프롬프트 순서는 Phase 0 실측 후 케이스별로 보정한다.
 */
function buildSteps(codes, requiresAuth) {
  const steps = codes.map((digits) => ({ kind: 'menu', digits }));
  if (requiresAuth) {
    steps.push({ kind: 'input', ref: 'accountNo', terminator: '#' });
    steps.push({ kind: 'secret', ref: 'accountPw' });
  }
  return steps;
}

/** STT 자동 판정용 기대 키워드. 1회차 실행 후 실제 멘트로 보정한다. */
function keywordsFrom(label) {
  return label
    .replace(/[(),/·]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
}

/** 시트에 없는 중메뉴 코드(결번)로 "없는 번호 입력" 동작을 검증한다. */
function buildNegativeCases(cases) {
  const byTop = new Map();
  for (const c of cases) {
    if (!byTop.has(c.topCode)) byTop.set(c.topCode, new Set());
    const mid = c.dtmf[1];
    if (mid) byTop.get(c.topCode).add(mid);
  }
  const negatives = [];
  for (const [topCode, used] of [...byTop].sort()) {
    for (const digit of '123456789') {
      if (used.has(digit)) continue;
      negatives.push({
        id: `neg-${topCode}-${digit}`,
        topCode,
        dtmf: `${topCode}${digit}`,
        labels: [`${topCode}번 대메뉴`, `결번 ${digit}`],
        expectation: '없는 번호 안내 후 재안내',
        steps: [
          { kind: 'menu', digits: topCode },
          { kind: 'menu', digits: digit },
        ],
      });
    }
  }
  return negatives;
}

// ------------------------------------------------------------------- 실행

const before = readFileSync(XLSX);
const beforeHash = sha256(before);

if (beforeHash !== EXPECTED_SHA256) {
  console.error('원본 xlsx 해시가 기준값과 다릅니다. 시트가 개정되었는지 확인하세요.');
  console.error(`  기준: ${EXPECTED_SHA256}`);
  console.error(`  현재: ${beforeHash}`);
  process.exit(1);
}

const zip = unzipSync(before);
const grid = toGrid(readSheet(zip, SHEET_NAME), readSharedStrings(zip));
const cases = buildCases(grid);
const negativeCases = buildNegativeCases(cases);

const payload = {
  source: {
    file: 'ARS변경내역_최종_0904.xlsx',
    sheet: SHEET_NAME,
    sha256: beforeHash,
    extractedAt: new Date().toISOString(),
  },
  cases,
  negativeCases,
};

writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');

// 원본이 그대로인지 다시 확인한다.
const afterHash = sha256(readFileSync(XLSX));
if (afterHash !== beforeHash) {
  console.error('원본 xlsx가 변경되었습니다. 즉시 확인이 필요합니다.');
  process.exit(1);
}

// 배포용 기본 설정을 굽는다.
// 실제 발신 번호는 저장소에 없는 config/ars.config.json 에서만 온다.
// 이 파일이 있으면 테스터가 앱에서 번호를 입력하지 않아도 바로 쓸 수 있다.
const sample = JSON.parse(readFileSync(CONFIG_SAMPLE, 'utf-8'));
let local = {};
if (existsSync(CONFIG_LOCAL)) local = JSON.parse(readFileSync(CONFIG_LOCAL, 'utf-8'));
const merged = { ...sample, ...local };
writeFileSync(CONFIG_OUT, JSON.stringify(merged, null, 2) + '\n');

const byTop = cases.reduce((acc, c) => ((acc[c.topCode] = (acc[c.topCode] ?? 0) + 1), acc), {});
console.log(`추출 완료: 케이스 ${cases.length}건, 결번 케이스 ${negativeCases.length}건`);
console.log(`  대메뉴별: ${Object.entries(byTop).sort().map(([k, v]) => `${k}:${v}`).join(' ')}`);
console.log(`  인증 필요: ${cases.filter((c) => c.requiresAuth).length}건`);
console.log(`  상담원 연결: ${cases.filter((c) => c.isAgentTransfer).length}건`);
console.log(`  원본 무결성 확인 (sha256 ${beforeHash.slice(0, 12)}…)`);
console.log(
  merged.number === sample.number
    ? '  발신 번호: 미설정 — 앱 설정 탭에서 입력해야 합니다 (config/ars.config.json 을 두면 구워집니다)'
    : `  발신 번호: ${merged.number} (config/ars.config.json 에서 주입)`,
);
