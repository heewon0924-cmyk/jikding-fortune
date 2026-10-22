// scenes.json → PROMPTS.md (Gemini 앱에 복사해 붙일 프롬프트 모음)
//   node scenes/make-prompts.js
const fs = require('fs');
const path = require('path');

const { style, scenes } = require('./scenes.json');
const TOPICS = {
  coffee: '☕ 커피', build: '🛠 빌드', meeting: '🗣 회의', overtime: '🌙 야근',
  lunch: '🍚 점심', slack: '🔔 알림', payday: '💸 월급날', leave: '🏃 칼퇴',
};
const imgDir = path.join(__dirname, '..', 'public', 'img');
const have = new Set(fs.existsSync(imgDir) ? fs.readdirSync(imgDir).map((f) => f.replace(/\.[^.]+$/, '')) : []);

const out = [
  '# 캐릭터 그림 프롬프트',
  '',
  '이 파일은 `scenes/make-prompts.js` 가 `scenes.json` 으로 만든다. 직접 고치지 말고 `scenes.json` 을 고친 뒤 다시 실행한다.',
  '',
  '## 만드는 법',
  '',
  '1. 아래 프롬프트를 하나씩 Gemini 앱(또는 AI Studio)에 붙여 넣는다.',
  '2. 마음에 드는 그림이 나오면 **적힌 파일 이름 그대로** 저장한다. 확장자는 png·jpg·webp 무엇이든 된다.',
  '3. 이상하면(손가락·글자 깨짐·다른 그림체) 다시 생성한다. 마음에 안 들면 그 장면은 건너뛰어도 된다.',
  '4. 저장한 그림을 저장소의 `public/img/` 에 올린다. 일부만 올려도 앱은 올라온 그림만으로 동작한다.',
  '',
  `진행: **${scenes.filter((s) => have.has(s.id)).length} / ${scenes.length}** 장`,
  '',
];

for (const [topic, label] of Object.entries(TOPICS)) {
  out.push(`## ${label}`, '');
  for (const s of scenes.filter((x) => x.topic === topic)) {
    out.push(`### ${have.has(s.id) ? '✅' : '⬜'} \`${s.id}\` — ${s.ko}`, '');
    out.push('```', `Generate an image. ${style} Scene: ${s.en}`, '```', '');
  }
}

fs.writeFileSync(path.join(__dirname, 'PROMPTS.md'), out.join('\n'));
console.log(`PROMPTS.md: ${scenes.length}개 장면, 그림 있음 ${[...have].filter((h) => scenes.some((s) => s.id === h)).length}개`);
