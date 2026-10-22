// 오늘의 운세 뽑기 — Express 백엔드
// 역할: 미리 넣어 둔 그림(public/img) 중 하나를 고르고, 그 장면에 맞는 운세를 Gemini 로 쓴다.
// API 키는 서버에만 있다. 키가 없거나 무료 한도를 넘기면 그림 주제에 맞춘 내장 문구로 응답한다.
// 그림이 하나도 없으면 image 를 null 로 보내고, 화면은 그림 칸을 숨긴다.

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
  keepResults: Number(env('KEEP_RESULTS', 1000)),
  trustProxy: env('TRUST_PROXY', 'loopback'),
};

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ───────────────────────────── 프롬프트 룰 ─────────────────────────────

// 카드에 막대로 나가는 분야별 운. 순서가 곧 화면 순서다.
const CATEGORIES = [
  { key: 'money', label: '금전운' },
  { key: 'love', label: '연애운' },
  { key: 'health', label: '건강운' },
  { key: 'people', label: '대인운' },
];

const MOODS = ['tired', 'happy', 'panic', 'smug', 'sleepy'];

function buildFortunePrompt({ weekday, scene }) {
  return [
    '너는 가볍고 재치 있는 "오늘의 운세" 작가다.',
    '',
    '[톤앤매너]',
    '- 일상 운세를 피식 웃게 쓴다. 돈, 연애, 건강, 사람 관계, 사소한 행운, 휴식, 먹을 것 같은 평범한 하루가 소재다.',
    '- 일이나 공부 이야기는 가끔만, 여러 소재 중 하나로 쓴다. 직장인 전용 유머로 몰아가지 마라.',
    '- 너무 진지하거나 무섭게 쓰지 말고, 나쁜 운도 귀엽게 비틀어 말한다.',
    '- 운세는 한국어 2문장 이내, 짧고 명확하게. 이모지는 최대 1개.',
    '- 누군가를 비하하거나 불쾌하게 만드는 내용, 실존 인물·회사 언급 금지.',
    '',
    '[항목]',
    '- title: 운세를 요약하는 6~12자 제목.',
    '- scores: 금전운(money)·연애운(love)·건강운(health)·대인운(people)을 0~100으로. 운세 내용과 일관되게(돈 이야기가 좋으면 금전운이 높게). 넷이 모두 비슷하지 않게 높낮이를 준다.',
    '- luckyItem: 오늘의 행운 아이템, 2~8자. 일상에서 볼 수 있는 물건.',
    '- luckyColor: 행운의 색, 2~6자 (예: 민트색, 살구색).',
    '- luckyNumber: 행운의 숫자, 1~99.',
    '- advice: 오늘의 한 줄 조언, 20자 안팎. 운세와 겹치지 않게, 바로 해 볼 수 있는 행동으로.',
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
    scores: {
      type: 'OBJECT',
      properties: Object.fromEntries(CATEGORIES.map((c) => [c.key, { type: 'INTEGER', description: `${c.label} 0~100` }])),
      required: CATEGORIES.map((c) => c.key),
    },
    luckyItem: { type: 'STRING', description: '행운의 아이템, 한국어 2~8자' },
    luckyColor: { type: 'STRING', description: '행운의 색, 한국어 2~6자' },
    luckyNumber: { type: 'INTEGER', description: '행운의 숫자 1~99' },
    advice: { type: 'STRING', description: '오늘의 한 줄 조언, 한국어 20자 안팎' },
    mood: { type: 'STRING', enum: MOODS },
  },
  required: ['fortune', 'title', 'scores', 'luckyItem', 'luckyColor', 'luckyNumber', 'advice', 'mood'],
};

// ───────────────────────────── 내장 대체 콘텐츠 ─────────────────────────────

// 그림 주제(scenes.json 의 topic)별 내장 문구. 키가 없거나 Gemini 가 실패해도 그림과 어긋나지 않게 한다.
// scores 순서: 금전·연애·건강·대인
const FALLBACK_FORTUNES = {
  money: [
    { title: '주머니가 따뜻', fortune: '잊고 있던 주머니에서 지폐 한 장이 나올 운입니다. 오늘은 빨래 전에 꼭 확인하세요.', mood: 'happy', scores: [88, 55, 62, 70], luckyItem: '겨울 외투', luckyColor: '금색', advice: '안 입던 옷 주머니 뒤지기' },
    { title: '지갑 단속의 날', fortune: '"이건 싸니까"가 다섯 번 쌓이면 큰돈이 됩니다. 장바구니는 하룻밤 재워 두세요.', mood: 'panic', scores: [34, 61, 70, 66], luckyItem: '가계부', luckyColor: '회색', advice: '장바구니 하나 비우기' },
  ],
  love: [
    { title: '설렘 주의보', fortune: '무심코 보낸 메시지에 생각보다 좋은 답장이 옵니다. 답장을 기다리며 휴대폰을 세 번쯤 확인하게 됩니다.', mood: 'happy', scores: [58, 91, 64, 77], luckyItem: '향수', luckyColor: '분홍색', advice: '먼저 안부 문자 보내기' },
    { title: '혼자도 괜찮아', fortune: '오늘은 연애운보다 나랑 친해지는 운이 셉니다. 좋아하는 노래를 크게 틀어도 되는 날입니다.', mood: 'smug', scores: [62, 43, 75, 68], luckyItem: '이어폰', luckyColor: '보라색', advice: '나에게 작은 선물 하기' },
  ],
  health: [
    { title: '몸이 가벼운 날', fortune: '계단을 오르는데 이상하게 숨이 안 찹니다. 이 기세로 한 정거장 걸어 보세요.', mood: 'happy', scores: [57, 63, 93, 66], luckyItem: '운동화', luckyColor: '연두색', advice: '물 한 잔 더 마시기' },
    { title: '꿀잠이 보약', fortune: '오늘 피로의 원인은 어젯밤의 "한 편만 더"입니다. 오늘은 휴대폰을 침대 밖에 두세요.', mood: 'sleepy', scores: [60, 52, 41, 63], luckyItem: '안대', luckyColor: '남색', advice: '30분 일찍 눕기' },
  ],
  people: [
    { title: '귀인 등장', fortune: '오늘 만나는 사람 중에 의외의 도움을 주는 사람이 있습니다. 평소보다 한 번 더 웃어 주세요.', mood: 'happy', scores: [66, 70, 64, 92], luckyItem: '사탕', luckyColor: '하늘색', advice: '고맙다고 먼저 말하기' },
    { title: '말은 짧게', fortune: '오늘은 듣는 쪽이 이기는 날입니다. 맞장구 세 번이면 분위기가 당신 편이 됩니다.', mood: 'smug', scores: [55, 61, 68, 47], luckyItem: '손수건', luckyColor: '베이지색', advice: '말하기 전에 한 박자 쉬기' },
  ],
  luck: [
    { title: '사소한 행운', fortune: '신호등이 내 앞에서 딱딱 바뀌는 날입니다. 큰 행운은 아니지만 하루 종일 기분이 좋습니다.', mood: 'happy', scores: [72, 66, 70, 74], luckyItem: '동전', luckyColor: '노란색', advice: '오늘은 새 길로 가 보기' },
    { title: '타이밍의 신', fortune: '도착하자마자 버스가 오고, 줄을 서자마자 내 차례가 됩니다. 운을 아껴 쓰지 마세요.', mood: 'smug', scores: [69, 73, 62, 71], luckyItem: '교통카드', luckyColor: '주황색', advice: '평소 미루던 일 하나 처리하기' },
  ],
  rest: [
    { title: '쉬어 가는 날', fortune: '오늘은 아무것도 안 해도 운이 깎이지 않는 날입니다. 소파가 당신을 부르고 있습니다.', mood: 'sleepy', scores: [60, 58, 81, 55], luckyItem: '담요', luckyColor: '크림색', advice: '10분 멍때리기' },
    { title: '충전 필요', fortune: '배터리가 빨간불입니다. 휴대폰 말고 당신 말입니다.', mood: 'tired', scores: [54, 50, 46, 60], luckyItem: '따뜻한 차', luckyColor: '연갈색', advice: '알림 끄고 쉬기' },
  ],
  food: [
    { title: '맛집 운 상승', fortune: '아무 데나 들어간 식당이 숨은 맛집일 운입니다. 오늘은 메뉴 고민을 짧게 하세요.', mood: 'happy', scores: [64, 66, 72, 70], luckyItem: '젓가락', luckyColor: '빨간색', advice: '처음 보는 메뉴 시켜 보기' },
    { title: '야식의 유혹', fortune: '밤 10시에 떠오르는 라면은 운명이 아니라 유혹입니다. 그래도 먹는다면 계란은 넣으세요.', mood: 'smug', scores: [58, 60, 49, 65], luckyItem: '계란', luckyColor: '노란색', advice: '저녁을 든든히 먹기' },
  ],
  work: [
    { title: '집중력 반짝', fortune: '미뤄 둔 일이 생각보다 금방 끝납니다. 끝내고 나면 괜히 미뤘다 싶을 겁니다.', mood: 'happy', scores: [70, 57, 66, 68], luckyItem: '포스트잇', luckyColor: '민트색', advice: '제일 귀찮은 일부터 하기' },
    { title: '마감은 가까이', fortune: '"아직 시간 있어"라는 생각이 오늘의 함정입니다. 시계는 생각보다 빨리 갑니다.', mood: 'panic', scores: [61, 55, 58, 63], luckyItem: '타이머', luckyColor: '하얀색', advice: '할 일 목록 세 줄 쓰기' },
  ],
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function fallbackFortune(topic) {
  const f = pick(FALLBACK_FORTUNES[topic] || Object.values(FALLBACK_FORTUNES).flat());
  return {
    title: f.title,
    fortune: f.fortune,
    mood: f.mood,
    indices: CATEGORIES.map((c, i) => ({ label: c.label, value: jitter(f.scores[i]) })),
    luckyItem: f.luckyItem,
    luckyColor: f.luckyColor,
    luckyNumber: 1 + Math.floor(Math.random() * 99),
    advice: f.advice,
  };
}

function jitter(v) {
  return clampPct(v + Math.round((Math.random() - 0.5) * 10));
}

function clampPct(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 50;
}

// ───────────────────────────── 그림 목록 ─────────────────────────────

// scenes/scenes.json 의 장면 중 public/img/<id>.(png|jpg|jpeg|webp) 파일이 있는 것만 쓴다.
// 그림을 넣으면 재시작 없이 1분 안에 반영된다.
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

  const scores = parsed.scores || {};
  if (!parsed.fortune || CATEGORIES.some((c) => scores[c.key] === undefined)) throw new Error('응답 형식이 올바르지 않음');
  const num = Math.round(Number(parsed.luckyNumber));

  return {
    title: String(parsed.title || '오늘의 운세').slice(0, 20),
    fortune: String(parsed.fortune).slice(0, 200),
    indices: CATEGORIES.map((c) => ({ label: c.label, value: clampPct(scores[c.key]) })),
    luckyItem: String(parsed.luckyItem || '네잎클로버').slice(0, 16),
    luckyColor: String(parsed.luckyColor || '하늘색').slice(0, 10),
    luckyNumber: num >= 1 && num <= 99 ? num : 7,
    advice: String(parsed.advice || '오늘은 물 한 잔 더').slice(0, 40),
    mood: MOODS.includes(parsed.mood) ? parsed.mood : 'happy',
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

// 공유 링크용으로 최근 결과를 data/results.json 에 보관한다. 재시작(배포)해도 링크가 살아 있다.
const RESULTS_FILE = path.join(__dirname, 'data', 'results.json');
const results = new Map();
try {
  for (const r of JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'))) results.set(r.id, r);
} catch (_) { /* 처음 실행이거나 파일이 깨짐 → 빈 목록으로 시작 */ }

// 임시 파일에 쓰고 바꿔치기해서, 쓰다가 끊겨도 파일이 깨지지 않게 한다
function writeResults() {
  try {
    fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
    fs.writeFileSync(`${RESULTS_FILE}.tmp`, JSON.stringify([...results.values()]));
    fs.renameSync(`${RESULTS_FILE}.tmp`, RESULTS_FILE);
  } catch (e) {
    console.warn('[results] 저장 실패:', e.message);
  }
}

// 연달아 뽑아도 파일은 1초에 한 번만 쓴다
let writeTimer = null;
function persistResults() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => { writeTimer = null; writeResults(); }, 1000);
}

// 배포로 재시작될 때 아직 안 쓴 결과를 마저 쓴다
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    if (writeTimer) { clearTimeout(writeTimer); writeResults(); }
    process.exit(0);
  });
}

function saveResult(r) {
  results.set(r.id, r);
  while (results.size > CONFIG.keepResults) results.delete(results.keys().next().value);
  persistResults();
}

// ───────────────────────────── 라우트 ─────────────────────────────

const app = express();
app.set('trust proxy', CONFIG.trustProxy);
app.disable('x-powered-by');
app.use(express.json({ limit: '4kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  // 화면(html)은 배포하면 바로 바뀌어야 하므로 매번 새로 확인하게 한다. 그림은 1시간 캐시한다.
  setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); },
}));

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

  const mood = scene ? scene.mood : fortune.mood;
  const image = scene ? `img/${encodeURIComponent(scene.file)}` : null;

  const result = {
    id: crypto.randomBytes(6).toString('base64url'),
    createdAt: new Date().toISOString(),
    title: fortune.title,
    fortune: fortune.fortune,
    indices: fortune.indices,
    luckyItem: fortune.luckyItem,
    luckyColor: fortune.luckyColor,
    luckyNumber: fortune.luckyNumber,
    advice: fortune.advice,
    mood,
    image,
    sceneId: scene ? scene.id : null,
    textSource,
    imageSource: scene ? 'scene' : 'none',
    notes,
  };
  saveResult(result);
  res.json(result);
});

app.get('/api/fortune/:id', (req, res) => {
  const r = results.get(req.params.id);
  if (!r) return res.status(404).json({ error: '공유된 운세를 찾지 못했어요. 오래된 링크일 수 있어요. 새로 뽑아 보세요!' });
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
