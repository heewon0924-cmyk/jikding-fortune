// 오늘의 직딩 운세 뽑기 — Express 백엔드
// 역할: 미리 그려 둔 캐릭터 그림(public/img) 중 하나를 고르고, 그 장면에 맞는 운세를 Gemini 로 쓴다.
// API 키는 서버에만 있다. 키가 없거나 무료 한도를 넘기면 그림 주제에 맞춘 내장 문구로 응답하고,
// 그림이 하나도 없으면 기분별 SVG 캐릭터를 보여 준다.

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);

const CONFIG = {
  port: Number(env('PORT', 3000)),
  host: env('HOST', '127.0.0.1'),
  apiKey: env('GEMINI_API_KEY', ''),
  textModel: env('TEXT_MODEL', 'gemini-2.5-flash'),
  ratePerMin: Number(env('RATE_LIMIT_PER_MIN', 6)),
  dailyTextLimit: Number(env('DAILY_TEXT_LIMIT', 200)),
  keepResults: Number(env('KEEP_RESULTS', 100)),
  trustProxy: env('TRUST_PROXY', 'loopback'),
};

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ───────────────────────────── 프롬프트 룰 ─────────────────────────────

const INDEX_POOL = [
  '야근 지수', '월루 지수', '칼퇴 확률', '커피 수혈 필요도', '빌드 성공률',
  '회의 생존력', '점심 메뉴 결정력', '슬랙 알림 공포도', '퇴사 충동', '월급 체감 속도',
];

const MOODS = ['tired', 'happy', 'panic', 'smug', 'sleepy'];

function buildFortunePrompt({ weekday, scene }) {
  return [
    '너는 직장인과 개발자를 위한 "오늘의 운세" 작가다.',
    '',
    '[톤앤매너]',
    '- 시니컬하면서도 귀여운 직장인 유머. 읽는 사람이 피식 웃고 공감할 것.',
    '- 월요병, 커피, 빌드 오류, 칼퇴 실패, 회의, 점심 메뉴, 슬랙 알림, 배포, 월급날 같은 공감 키워드를 활용.',
    '- 운세 문장은 한국어 2문장 이내, 짧고 명확하게. 이모지는 최대 1개.',
    '- 누군가를 비하하거나 불쾌하게 만드는 내용, 실제 회사·인물 언급 금지.',
    '',
    '[지수]',
    `- 다음 후보 중 운세 내용과 어울리는 2개를 골라 0~100 사이 값을 매긴다: ${INDEX_POOL.join(', ')}`,
    '- 값은 운세 내용과 일관되게(야근 운세면 야근 지수가 높게).',
    '',
    ...(scene ? [
      '[그림]',
      `- 운세 카드에 이 그림이 함께 나간다: "${scene.ko}"`,
      '- 운세는 반드시 이 그림의 상황과 어울려야 한다. 그림 속 상황을 읽는 사람의 오늘 하루로 바꿔 써라.',
      '- 그림 속 동물이나 캐릭터를 직접 부르지는 마라 (예: "오리처럼" 금지).',
      '',
    ] : []),
    `오늘은 ${weekday}요일이다.`,
    '매번 다른 내용이 나오도록 신선한 표현을 골라라.',
  ].join('\n');
}

const FORTUNE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    fortune: { type: 'STRING', description: '한국어 운세 1~2문장' },
    title: { type: 'STRING', description: '운세를 요약하는 6~12자 한국어 제목' },
    indices: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          value: { type: 'INTEGER' },
        },
        required: ['label', 'value'],
      },
    },
    luckyItem: { type: 'STRING', description: '오늘의 행운 아이템, 한국어 2~8자' },
    mood: { type: 'STRING', enum: MOODS },
  },
  required: ['fortune', 'title', 'indices', 'luckyItem', 'mood'],
};

// ───────────────────────────── 내장 대체 콘텐츠 ─────────────────────────────

// 그림 주제(scenes.json 의 topic)별 내장 문구. 키가 없거나 Gemini 가 실패해도 그림과 어긋나지 않게 한다.
const FALLBACK_FORTUNES = {
  coffee: [
    { title: '커피가 곧 혈액', fortune: '세 번째 아메리카노부터 비로소 사람이 됩니다. 네 번째부터는 신이 됩니다.', mood: 'happy', indices: [['커피 수혈 필요도', 97], ['회의 생존력', 70]], luckyItem: '텀블러' },
    { title: '카페인 경보', fortune: '오늘 커피 없이 버티겠다는 다짐은 오전 10시에 무너집니다. 미리 두 잔 시켜 두세요.', mood: 'tired', indices: [['커피 수혈 필요도', 91], ['월루 지수', 58]], luckyItem: '샷 추가' },
  ],
  build: [
    { title: '빌드는 초록불', fortune: '오늘은 빌드가 한 번에 통과합니다. 단, 그 이유는 아무도 모릅니다.', mood: 'smug', indices: [['빌드 성공률', 92], ['월루 지수', 64]], luckyItem: '고무 오리' },
    { title: '금요일 배포 금지', fortune: '배포 버튼 위에 손가락이 머무는 순간 우주가 말립니다. 우주의 말을 들으세요.', mood: 'panic', indices: [['빌드 성공률', 41], ['야근 지수', 79]], luckyItem: '롤백 스크립트' },
  ],
  meeting: [
    { title: '회의의 늪', fortune: '"짧게 하나만"으로 시작한 회의가 점심을 삼킵니다. 메모장은 끝까지 비어 있습니다.', mood: 'sleepy', indices: [['회의 생존력', 35], ['월루 지수', 81]], luckyItem: '포스트잇' },
    { title: '카메라 끄기의 기술', fortune: '오늘의 회의는 듣는 척이 핵심입니다. 고개 끄덕임 세 번이면 충분합니다.', mood: 'smug', indices: [['회의 생존력', 77], ['월루 지수', 88]], luckyItem: '이어폰' },
  ],
  overtime: [
    { title: '야근의 기운', fortune: '퇴근 직전에 "이것만 보고 가요"가 찾아옵니다. 그것만 보는 데 두 시간이 걸립니다.', mood: 'tired', indices: [['야근 지수', 92], ['칼퇴 확률', 9]], luckyItem: '컵라면' },
    { title: '달빛 코딩', fortune: '오늘 밤 사무실의 불은 당신이 끕니다. 대신 야식 메뉴 결정권도 당신에게 있습니다.', mood: 'sleepy', indices: [['야근 지수', 85], ['점심 메뉴 결정력', 60]], luckyItem: '야식 쿠폰' },
  ],
  lunch: [
    { title: '점심 결정 장애', fortune: '"아무거나"라고 말한 대가로 아무거나 먹게 됩니다. 의외로 맛있습니다.', mood: 'happy', indices: [['점심 메뉴 결정력', 18], ['월루 지수', 59]], luckyItem: '제비뽑기' },
    { title: '식곤증 주의보', fortune: '점심을 든든히 먹은 대가로 오후 2시에 눈꺼풀이 천근이 됩니다. 일어서서 일하세요.', mood: 'sleepy', indices: [['점심 메뉴 결정력', 72], ['회의 생존력', 31]], luckyItem: '박하사탕' },
  ],
  slack: [
    { title: '알림 폭격 주의', fortune: '슬랙 알림이 울릴 때마다 심장이 한 박자 쉽니다. 방해 금지 모드가 오늘의 수호신입니다.', mood: 'panic', indices: [['슬랙 알림 공포도', 93], ['퇴사 충동', 47]], luckyItem: '방해 금지 모드' },
    { title: '읽씹의 미학', fortune: '"확인했습니다" 한 마디가 오늘의 평화를 지킵니다. 이모지 하나면 더 좋습니다.', mood: 'smug', indices: [['슬랙 알림 공포도', 64], ['월루 지수', 76]], luckyItem: '👍 이모지' },
  ],
  payday: [
    { title: '월급 스쳐 감', fortune: '월급이 통장에 들어와 인사만 하고 떠납니다. 카드값이 먼저 알고 기다리고 있었습니다.', mood: 'tired', indices: [['월급 체감 속도', 97], ['퇴사 충동', 52]], luckyItem: '가계부' },
    { title: '오늘은 부자', fortune: '잠깐이지만 오늘은 부자입니다. 장바구니는 내일 다시 보세요.', mood: 'happy', indices: [['월급 체감 속도', 88], ['월루 지수', 63]], luckyItem: '돼지 저금통' },
  ],
  leave: [
    { title: '칼퇴의 신기루', fortune: '6시 정각에 노트북을 덮는 순간 "잠깐 5분만"이 찾아옵니다. 그 5분은 90분입니다.', mood: 'tired', indices: [['야근 지수', 88], ['칼퇴 확률', 12]], luckyItem: '이어폰' },
    { title: '칼퇴 성공 예감', fortune: '오늘은 6시 정각에 문을 나설 운입니다. 단, 엘리베이터에서 팀장님을 만나지 않는다면요.', mood: 'happy', indices: [['칼퇴 확률', 86], ['월루 지수', 71]], luckyItem: '운동화' },
  ],
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function fallbackFortune(topic) {
  const f = pick(FALLBACK_FORTUNES[topic] || Object.values(FALLBACK_FORTUNES).flat());
  return {
    title: f.title,
    fortune: f.fortune,
    mood: f.mood,
    luckyItem: f.luckyItem,
    indices: f.indices.map(([label, value]) => ({ label, value: jitter(value) })),
  };
}

function jitter(v) {
  return clampPct(v + Math.round((Math.random() - 0.5) * 10));
}

function clampPct(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 50;
}

// 그림이 하나도 없을 때 쓰는 기분별 SVG 캐릭터 (작은 감자 직장인)
function fallbackSvg(mood) {
  const palettes = {
    tired: ['#cfd8ff', '#8b9cf0'], happy: ['#ffe3a3', '#ffb84d'], panic: ['#ffd0d0', '#ff7a7a'],
    smug: ['#d4f5dc', '#5fcf86'], sleepy: ['#e8dcff', '#a98bf0'],
  };
  const faces = {
    tired: '<path d="M88 112 q10 6 20 0 M132 112 q10 6 20 0" stroke="#3b3355" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M105 150 q15 -8 30 0" stroke="#3b3355" stroke-width="5" fill="none" stroke-linecap="round"/>',
    happy: '<path d="M86 116 q12 -14 24 0 M130 116 q12 -14 24 0" stroke="#3b3355" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M100 140 q20 24 40 0 z" fill="#3b3355"/>',
    panic: '<circle cx="98" cy="112" r="11" fill="#fff" stroke="#3b3355" stroke-width="4"/><circle cx="142" cy="112" r="11" fill="#fff" stroke="#3b3355" stroke-width="4"/><circle cx="98" cy="112" r="4" fill="#3b3355"/><circle cx="142" cy="112" r="4" fill="#3b3355"/><ellipse cx="120" cy="152" rx="10" ry="13" fill="#3b3355"/><path d="M172 84 q6 12 0 20 q-6 -8 0 -20z" fill="#7cc8ff"/>',
    smug: '<path d="M86 114 h22 M132 114 h22" stroke="#3b3355" stroke-width="5" stroke-linecap="round"/><path d="M104 146 q20 10 36 -6" stroke="#3b3355" stroke-width="5" fill="none" stroke-linecap="round"/>',
    sleepy: '<path d="M86 114 q11 8 22 0 M132 114 q11 8 22 0" stroke="#3b3355" stroke-width="5" fill="none" stroke-linecap="round"/><ellipse cx="120" cy="150" rx="8" ry="6" fill="#3b3355"/><text x="168" y="80" font-family="sans-serif" font-size="22" font-weight="700" fill="#8b7fc0">z</text><text x="184" y="62" font-family="sans-serif" font-size="16" font-weight="700" fill="#8b7fc0">z</text>',
  };
  const [bg, body] = palettes[mood] || palettes.tired;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
<rect width="240" height="240" fill="${bg}"/>
<ellipse cx="120" cy="212" rx="70" ry="10" fill="#000" opacity=".08"/>
<path d="M60 130 C56 70 92 48 122 50 C160 52 186 80 182 132 C178 182 150 206 118 204 C84 202 63 178 60 130Z" fill="#fff" stroke="#3b3355" stroke-width="6"/>
<path d="M66 132 C64 86 94 62 122 62 C156 64 176 90 174 132 C172 176 148 196 118 194 C88 192 68 172 66 132Z" fill="${body}" opacity=".35"/>
<circle cx="84" cy="138" r="9" fill="#ff8fa3" opacity=".55"/><circle cx="158" cy="138" r="9" fill="#ff8fa3" opacity=".55"/>
${faces[mood] || faces.tired}
<rect x="150" y="168" width="40" height="30" rx="6" fill="#fff" stroke="#3b3355" stroke-width="5"/>
<path d="M190 176 q12 0 12 9 q0 9 -12 9" stroke="#3b3355" stroke-width="5" fill="none"/>
<path d="M162 160 q4 -8 0 -14 M176 160 q4 -8 0 -14" stroke="#b9a7a0" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

// ───────────────────────────── 그림 목록 ─────────────────────────────

// scenes/scenes.json 의 장면 중 public/img/<id>.(png|jpg|jpeg|webp) 파일이 있는 것만 쓴다.
// 그림을 올리면 재시작 없이 1분 안에 반영된다.
const SCENES = require('./scenes/scenes.json').scenes;
const IMG_DIR = path.join(__dirname, 'public', 'img');
const IMG_EXT = /\.(png|jpe?g|webp)$/i;
let sceneCache = { at: 0, list: [] };

function availableScenes() {
  if (Date.now() - sceneCache.at < 60_000) return sceneCache.list;
  let files = [];
  try { files = fs.readdirSync(IMG_DIR).filter((f) => IMG_EXT.test(f)); } catch (_) {}
  const byId = new Map(files.map((f) => [f.replace(IMG_EXT, ''), f]));
  const list = SCENES.filter((s) => byId.has(s.id)).map((s) => ({ ...s, file: byId.get(s.id) }));
  sceneCache = { at: Date.now(), list };
  return list;
}

// 같은 그림이 연달아 나오지 않게 최근 것을 피한다
const recentScenes = [];
function pickScene() {
  const list = availableScenes();
  if (list.length === 0) return null;
  const avoid = Math.min(recentScenes.length, Math.floor(list.length / 2));
  const fresh = list.filter((s) => !recentScenes.slice(-avoid).includes(s.id));
  const scene = pick(fresh.length ? fresh : list);
  recentScenes.push(scene.id);
  if (recentScenes.length > 20) recentScenes.shift();
  return scene;
}

// ───────────────────────────── Google AI 호출 ─────────────────────────────

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function callGoogle(model, method, body, timeoutMs) {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': CONFIG.apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data?.error?.message || `HTTP ${res.status}`, res.status);
  }
  return data;
}

async function generateFortuneText({ weekday, scene }) {
  const data = await callGoogle(CONFIG.textModel, 'generateContent', {
    contents: [{ role: 'user', parts: [{ text: buildFortunePrompt({ weekday, scene }) }] }],
    generationConfig: {
      temperature: 1.1,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: FORTUNE_SCHEMA,
      // 2.5 계열은 기본으로 "생각"에 토큰을 쓴다. 짧은 운세엔 필요 없으니 끈다.
      ...(CONFIG.textModel.includes('2.5-flash') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  }, 20000);

  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  const parsed = JSON.parse(text);

  const indices = (Array.isArray(parsed.indices) ? parsed.indices : [])
    .filter((i) => i && i.label)
    .slice(0, 2)
    .map((i) => ({ label: String(i.label).slice(0, 12), value: clampPct(i.value) }));
  if (!parsed.fortune || indices.length === 0) throw new Error('응답 형식이 올바르지 않음');

  return {
    title: String(parsed.title || '오늘의 운세').slice(0, 20),
    fortune: String(parsed.fortune).slice(0, 200),
    indices,
    luckyItem: String(parsed.luckyItem || '아메리카노').slice(0, 16),
    mood: MOODS.includes(parsed.mood) ? parsed.mood : 'tired',
  };
}

// ───────────────────────────── 한도 / 저장 ─────────────────────────────

// 무료 티어 보호: IP 당 분당 요청 수 + 서버 전체 일일 Gemini 호출 수
const perIp = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const hits = (perIp.get(ip) || []).filter((t) => now - t < 60_000);
  hits.push(now);
  perIp.set(ip, hits);
  return hits.length > CONFIG.ratePerMin;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of perIp) if (hits.every((t) => now - t >= 60_000)) perIp.delete(ip);
}, 60_000).unref();

const daily = { day: '', text: 0 };
function useDaily(kind, limit) {
  const today = new Date().toISOString().slice(0, 10);
  if (daily.day !== today) Object.assign(daily, { day: today, text: 0 });
  if (daily[kind] >= limit) return false;
  daily[kind] += 1;
  return true;
}

// 공유 링크용으로 최근 결과를 메모리에 보관 (재시작하면 사라짐)
const results = new Map();
function saveResult(r) {
  results.set(r.id, r);
  while (results.size > CONFIG.keepResults) results.delete(results.keys().next().value);
}

// ───────────────────────────── 라우트 ─────────────────────────────

const app = express();
app.set('trust proxy', CONFIG.trustProxy);
app.disable('x-powered-by');
app.use(express.json({ limit: '4kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

app.post('/api/fortune', async (req, res) => {
  if (rateLimited(req.ip)) {
    return res.status(429).json({ error: '운세는 천천히… 1분 뒤에 다시 뽑아주세요.' });
  }

  const weekday = WEEKDAYS[new Date().getDay()];
  const scene = pickScene();
  const notes = [];

  let fortune;
  let textSource = 'ai';
  if (CONFIG.apiKey && useDaily('text', CONFIG.dailyTextLimit)) {
    try {
      fortune = await generateFortuneText({ weekday, scene });
    } catch (e) {
      console.warn('[text] 실패:', e.message);
      notes.push('text-fallback');
    }
  }
  if (!fortune) {
    fortune = fallbackFortune(scene?.topic);
    textSource = 'fallback';
  }

  // 그림이 있으면 그림의 기분을 따른다 (내장 SVG 로 대체될 때만 fortune.mood 가 쓰인다)
  const mood = scene ? scene.mood : fortune.mood;
  const image = scene ? `img/${encodeURIComponent(scene.file)}` : fallbackSvg(mood);

  const result = {
    id: crypto.randomBytes(6).toString('base64url'),
    createdAt: new Date().toISOString(),
    title: fortune.title,
    fortune: fortune.fortune,
    indices: fortune.indices,
    luckyItem: fortune.luckyItem,
    mood,
    image,
    sceneId: scene ? scene.id : null,
    textSource,
    imageSource: scene ? 'scene' : 'fallback',
    notes,
  };
  saveResult(result);
  res.json(result);
});

app.get('/api/fortune/:id', (req, res) => {
  const r = results.get(req.params.id);
  if (!r) return res.status(404).json({ error: '운세가 이미 퇴근했습니다. (만료된 링크)' });
  res.json(r);
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasKey: Boolean(CONFIG.apiKey),
    textModel: CONFIG.textModel,
    scenes: `${availableScenes().length}/${SCENES.length}`,
    today: daily,
  });
});

app.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`🔮 운세 서버: http://${CONFIG.host}:${CONFIG.port}`);
  if (!CONFIG.apiKey) console.log('   GEMINI_API_KEY 가 없어 내장 문구/그림으로 동작합니다 (데모 모드).');
});
