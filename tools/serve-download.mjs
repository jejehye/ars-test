/**
 * 단일 HTML 파일을 휴대폰으로 내려받기 위한 임시 서버.
 *
 * 사파리는 `.html` 주소를 열면 그대로 렌더링해 버리므로,
 * 파일로 저장시키려면 Content-Disposition 으로 첨부임을 알려야 한다.
 */
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = resolve(ROOT, 'dist-single/ars-test.html');
const PORT = 8088;

const size = (statSync(FILE).size / 1024).toFixed(0);

const landing = `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ARS 테스트 파일 받기</title>
<style>
 body{font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;
      background:#0f1115;color:#e6e8ee;margin:0;padding:24px;line-height:1.6}
 .wrap{max-width:520px;margin:0 auto}
 h1{font-size:19px;margin:0 0 4px} .sub{color:#9aa3b2;font-size:13px;margin:0 0 24px}
 a.btn{display:block;text-align:center;padding:15px;border-radius:10px;
       text-decoration:none;font-weight:600;margin-bottom:10px}
 a.dl{background:#4f8cff;color:#fff}
 a.open{background:#1f232c;color:#e6e8ee;border:1px solid #2a2f3a}
 ol{color:#9aa3b2;font-size:13px;padding-left:20px}
 li{margin-bottom:6px} b{color:#e6e8ee}
</style></head><body><div class="wrap">
<h1>ARS 메뉴 테스트</h1>
<p class="sub">ars-test.html · ${size} KB · 101개 케이스</p>

<a class="dl" href="/download">① 파일 내려받기 (파일 앱에 저장)</a>
<a class="open" href="/open">② 바로 열기 (내려받지 않고 확인)</a>

<ol>
 <li><b>①</b>을 탭하면 사파리가 파일을 <b>파일 앱 › 다운로드</b>에 저장합니다.</li>
 <li>우측 상단 <b>다운로드 아이콘</b> → 파일 탭 → 파일 앱에서 열기</li>
 <li>저장된 <b>ars-test.html</b>을 탭해 실행합니다. ← 이게 확인하려는 방식</li>
 <li>안 열리거나 화면이 깨지면 <b>②</b>로 비교해 보세요. ②가 정상이면 파일 실행만 막힌 것입니다.</li>
</ol>
</div></body></html>`;

createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];

  if (url === '/download') {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="ars-test.html"',
      'Cache-Control': 'no-store',
    });
    res.end(readFileSync(FILE));
    console.log('  → 내려받기 요청 처리');
    return;
  }

  if (url === '/open') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(readFileSync(FILE));
    console.log('  → 바로 열기 요청 처리');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(landing);
}).listen(PORT, '0.0.0.0', () => {
  const ip = Object.values(networkInterfaces())
    .flat()
    .find((n) => n && n.family === 'IPv4' && !n.internal)?.address;
  console.log(`\n  아이폰 사파리에서 열어주세요:  http://${ip}:${PORT}\n`);
});
