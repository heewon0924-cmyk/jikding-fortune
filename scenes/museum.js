// 국립중앙박물관 소장품에서 그림을 찾아 받는다 (공공누리 제1유형만).
//
//   node scenes/museum.js search 까치호랑이 모란도      검색해서 후보를 표로 보여 준다
//   node scenes/museum.js info 4203 8449              작품 번호로 정보만 본다
//   node scenes/museum.js preview 8449 7187 ...       그림을 받아 미리보기 페이지를 만든다 (/fortune/img/preview/)
//   node scenes/museum.js fetch                       scenes/museum.json 에 적힌 작품 그림을 public/img 로 받는다
//
// 박물관 서버에 부담을 주지 않도록 요청 사이에 쉬고, 이미 받은 그림은 건너뛴다.
const fs = require('fs');
const path = require('path');

const BASE = 'https://www.museum.go.kr';
const VIEW = (id) => `${BASE}/MUSEUM/contents/M0502000000.do?schM=view&searchId=search&relicId=${id}`;
const LIST = (param, q, page) =>
  `${BASE}/MUSEUM/contents/M0502000000.do?schM=list&searchId=search&${param}=${encodeURIComponent(q)}&pageIndex=${page}`;
// 검색어 항목 이름을 모르므로 후보를 차례로 시도한다
const SEARCH_PARAMS = ['searchText', 'searchKeyword', 'keyword', 'searchWrd', 'query', 'relicName', 'searchRelicName'];
const IMG_DIR = path.join(__dirname, '..', 'public', 'img');
const LIST_FILE = path.join(__dirname, 'museum.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (malgeumi fortune; personal use)' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res;
}

const relicIds = (html) => [...new Set([...html.matchAll(/relicId=(\d+)/g)].map((m) => m[1]))];

async function info(id) {
  const html = await (await get(VIEW(id))).text();
  // 제목: 상세 표의 "명칭" 칸 → og:title → <title> 순서로 찾는다 (<title> 은 메뉴 경로일 때가 있다)
  const nameBlock = ((html.match(/>\s*(명칭\s*<[\s\S]{0,300})/) || [])[1] || '').replace(/<[^>]+>/g, '|');
  const fromTable = decode((nameBlock.split('|').map((x) => x.trim()).filter((x) => x && x !== '명칭')[0]) || '');
  const og = decode((html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || [])[1] || '');
  const rawTitle = decode((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '');
  const clean = (t) => t.replace(/\s*이미지\s*\d+\s*/, ' ').replace(/\s*[-|]\s*국립중앙박물관.*$/, '').trim();
  const title = [fromTable, clean(og), clean(rawTitle)].find((t) => t && !t.includes('>')) || '(제목 못 찾음)';
  // 소장품 번호: "소장품번호" 표시 근처의 첫 글자 덩어리
  const noBlock = (html.match(/소장품\s*번호[\s\S]{0,300}/) || [''])[0].replace(/<[^>]+>/g, ' ');
  const collectionNo = decode((noBlock.replace(/소장품\s*번호/, '').match(/[가-힣A-Za-z]+\s?\d[\d-]*/) || [''])[0]);
  const kogl1 = /공공누리\s*1\s*유형|공공누리\s*제\s*1\s*유형/.test(html);
  const imgs = [...new Set([...html.matchAll(/\/relic_image\/[^"' )]+?\.(?:jpe?g|png)/gi)].map((m) => m[0].replace(/\/\/+/g, '/')))];
  const image = imgs.find((u) => /\/700\//.test(u)) || imgs[0] || null;
  return { relicId: String(id), title, collectionNo, kogl1, image: image ? BASE + image : null, images: imgs.length };
}

function printRows(rows) {
  for (const r of rows) {
    console.log([r.relicId.padStart(7), r.kogl1 ? '공공누리1' : '  확인필요', (r.collectionNo || '-').padEnd(10), r.image ? '그림O' : '그림X', r.title].join('  '));
  }
}

async function search(words) {
  // 검색어 없이 나온 목록과 다른 결과를 주는 항목 이름을 찾는다
  const baseline = relicIds(await (await get(LIST('searchText', '', 1))).text()).join(',');
  for (const q of words) {
    let ids = [];
    let used = null;
    for (const p of SEARCH_PARAMS) {
      await sleep(300);
      const found = relicIds(await (await get(LIST(p, q, 1))).text());
      if (found.length && found.join(',') !== baseline) { ids = found; used = p; break; }
    }
    console.log(`\n■ "${q}" — ${used ? `검색 항목 ${used}, ${ids.length}건` : '검색이 안 됨 (검색어가 무시되는 것 같음)'}`);
    if (!used) continue;
    const rows = [];
    for (const id of ids.slice(0, 15)) {
      await sleep(300);
      try { rows.push(await info(id)); } catch (e) { console.log(`  ${id} 실패: ${e.message}`); }
    }
    printRows(rows);
  }
}

async function download(url, file) {
  const buf = Buffer.from(await (await get(url)).arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf.length;
}

// 휴대폰으로 보고 고를 수 있게 그림을 모아 한 페이지로 만든다
async function preview(ids) {
  const dir = path.join(IMG_DIR, 'preview');
  fs.mkdirSync(dir, { recursive: true });
  const items = fs.existsSync(path.join(dir, 'items.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'items.json'), 'utf8')) : {};
  for (const id of ids) {
    await sleep(400);
    try {
      const r = await info(id);
      if (!r.image) { console.log(`! ${id} 그림 주소를 못 찾음`); continue; }
      const file = path.join(dir, `${id}.jpg`);
      if (!fs.existsSync(file)) await download(r.image, file);
      items[id] = r;
      console.log(`+ ${id} ${r.collectionNo} ${r.title}${r.kogl1 ? '' : '  (공공누리 1유형 아님 — 쓰지 말 것)'}`);
    } catch (e) {
      console.log(`! ${id} 실패: ${e.message}`);
    }
  }
  fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify(items, null, 1));
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cards = Object.values(items).map((r) => `<figure><img src="${r.relicId}.jpg" loading="lazy"><figcaption><b>${esc(r.relicId)}</b> ${esc(r.collectionNo)}<br>${esc(r.title)}${r.kogl1 ? '' : ' ⚠️'}</figcaption></figure>`).join('\n');
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>그림 미리보기</title>
<style>body{margin:0;padding:16px;font-family:sans-serif;background:#f4f1ec}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}figure{margin:0;background:#fff;border-radius:12px;overflow:hidden}img{width:100%;aspect-ratio:1;object-fit:contain;background:#efe7da;display:block}figcaption{font-size:12px;padding:8px;line-height:1.4}</style>
<h3>그림 미리보기 (${Object.keys(items).length}점) · 국립중앙박물관</h3><main>${cards}</main>`);
  console.log(`\n미리보기: https://<주소>/fortune/img/preview/  (${Object.keys(items).length}점)`);
}

async function fetchAll() {
  const list = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8')).scenes;
  fs.mkdirSync(IMG_DIR, { recursive: true });
  for (const s of list) {
    const file = path.join(IMG_DIR, `${s.id}.jpg`);
    if (fs.existsSync(file)) { console.log(`= ${s.id} 이미 있음`); continue; }
    await sleep(500);
    try {
      const r = await info(s.relicId);
      if (!r.kogl1) { console.log(`! ${s.id} (${s.relicId}) 공공누리 1유형 표시가 없어 건너뜀`); continue; }
      if (!r.image) { console.log(`! ${s.id} (${s.relicId}) 그림 주소를 못 찾음`); continue; }
      const size = await download(r.image, file);
      console.log(`+ ${s.id} ← ${r.collectionNo} ${r.title} (${Math.round(size / 1024)}KB)`);
    } catch (e) {
      console.log(`! ${s.id} 실패: ${e.message}`);
    }
  }
}

(async () => {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'search' && args.length) return search(args);
  if (cmd === 'info' && args.length) {
    const rows = [];
    for (const id of args) { rows.push(await info(id)); await sleep(300); }
    return printRows(rows);
  }
  if (cmd === 'preview' && args.length) return preview(args);
  if (cmd === 'fetch') return fetchAll();
  console.log('사용법: node scenes/museum.js search <검색어...> | info <작품번호...> | preview <작품번호...> | fetch');
})().catch((e) => { console.error(e.message); process.exit(1); });
