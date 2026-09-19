// Code.gs 改分邏輯的離線測試（不碰 Apps Script 服務）。
// 執行：node mock-exam/test/grade_test.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const ctx = new Function(src + '\nreturn {gradeExam_, fullScore_, fillCorrect_, normalize_, stripAnswers_};')();

const exam = {
  id: 'test', title: 't', subject: '數學',
  sections: [
    { type: 'mc', name: '選擇題', points: 5, questions: [
      { q: 'A?', options: ['1', '2', '3', '4'], answer: 2, explain: 'e1' },
      { q: 'B?', options: ['1', '2', '3', '4'], answer: 0, explain: 'e2' }
    ]},
    { type: 'fill', name: '填充題', points: 4, questions: [
      { q: 'C?', answer: ['6x', '+6x'], explain: 'e3' },
      { q: 'D?', answer: ['9991'], explain: 'e4' }
    ]},
    { type: 'open', name: '非選擇題', points: 10, questions: [
      { q: 'E?', answer: 'ref', explain: 'e5' }
    ]}
  ]
};

const eq = (got, want, label) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error('FAIL ' + label + ': got ' + a + ', want ' + b); process.exitCode = 1; }
  else console.log('ok   ' + label);
};

eq(ctx.fullScore_(exam), 5 * 2 + 4 * 2 + 10, '滿分 = 28');

// 全形數字、空白、前導 + 、千分位逗號都要能對
eq(ctx.fillCorrect_(' 6x ', ['6x', '+6x']), true, '填充：前後空白');
eq(ctx.fillCorrect_('＋6x', ['6x']), true, '填充：全形加號');
eq(ctx.fillCorrect_('９９９１', ['9991']), true, '填充：全形數字');
eq(ctx.fillCorrect_('9,991', ['9991']), true, '填充：千分位逗號');
eq(ctx.fillCorrect_('', ['9991']), false, '填充：空白不算對');
eq(ctx.fillCorrect_('9992', ['9991']), false, '填充：答錯');

const g = ctx.gradeExam_(exam, { '0-0': '2', '0-1': '1', '1-0': '6x', '1-1': '', '2-0': '我的算式' });
eq(g.objectiveScore, 5 + 4, '得分 = 選擇1題 + 填充1題');
eq(g.wrong, ['選擇題2', '填充題2'], '錯題清單');
eq(g.items.map(i => i.correct), [true, false, true, false, null], '逐題對錯（非選為 null）');
eq(g.items[1].answerText, '1', '選擇題正解文字');
eq(g.items[4].answerText, 'ref', '非選參考答案');

// 送到瀏覽器的版本不能帶答案
const pub = JSON.stringify(ctx.stripAnswers_(exam));
eq(/"answer"/.test(pub), false, 'stripAnswers_ 不含 answer');
eq(/"explain"/.test(pub), false, 'stripAnswers_ 不含 explain');
eq(/ref/.test(pub), false, 'stripAnswers_ 不含非選參考答案');
