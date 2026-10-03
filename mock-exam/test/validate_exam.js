// 考卷 JSON 上傳前檢查。出完題、傳 Drive 之前先跑：
//   node mock-exam/test/validate_exam.js <考卷.json> [更多.json ...]
// 會擋下：JSON 語法錯誤、缺欄位、選擇題答案索引超出範圍、填充題沒有答案、SVG 標籤沒成對。
// 會警告：滿分不是 100、難度比例偏離 35/45/20、沒標作答時間、沒有 assign。
const fs = require('fs');

const LEVELS = ['中等', '中上', '素養'];
const TARGET = { 中等: 0.35, 中上: 0.45, 素養: 0.2 };
let exitCode = 0;

function check(file) {
  const errors = [];
  const warns = [];
  let exam;
  try {
    exam = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('✗ ' + file + '\n    JSON 語法錯誤：' + e.message);
    exitCode = 1;
    return;
  }

  ['id', 'title', 'subject', 'chapter', 'sections'].forEach(k => { if (!exam[k]) errors.push('缺少欄位 ' + k); });
  if (!Array.isArray(exam.assign) || !exam.assign.length) warns.push('沒有 assign（家教學生也會看到這份卷子）');
  if (!/分鐘/.test(exam.note || '')) warns.push('note 沒標作答時間');

  let total = 0, count = 0;
  const levels = { 中等: 0, 中上: 0, 素養: 0 };
  (exam.sections || []).forEach((sec, si) => {
    const where = '第' + (si + 1) + '大題「' + (sec.name || '?') + '」';
    if (!['mc', 'fill', 'open'].includes(sec.type)) errors.push(where + ' type 必須是 mc/fill/open');
    if (!(sec.points > 0)) errors.push(where + ' points 必須大於 0（是「每題」分數）');
    (sec.questions || []).forEach((q, qi) => {
      const qw = where + ' 第' + (qi + 1) + '題';
      count++;
      total += sec.points || 0;
      if (!q.q) errors.push(qw + ' 沒有題目文字');
      if (!q.explain) warns.push(qw + ' 沒有 explain');
      if (q.level && levels[q.level] !== undefined) levels[q.level]++;
      else warns.push(qw + ' level 缺少或不是 ' + LEVELS.join('/'));
      const html = q.q || '';
      if ((html.match(/<svg/g) || []).length !== (html.match(/<\/svg>/g) || []).length) errors.push(qw + ' <svg> 標籤沒成對');
      if (sec.type === 'mc') {
        if (!Array.isArray(q.options) || q.options.length < 2) errors.push(qw + ' 選項少於 2 個');
        else {
          if (q.options.length !== 4) warns.push(qw + ' 選項不是 4 個');
          if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) errors.push(qw + ' answer 索引超出範圍：' + q.answer);
          if (new Set(q.options).size !== q.options.length) errors.push(qw + ' 有重複的選項');
        }
      } else if (sec.type === 'fill') {
        if (!Array.isArray(q.answer) || !q.answer.length || q.answer.some(a => !String(a).trim())) errors.push(qw + ' 填充題 answer 必須是非空陣列');
      } else if (sec.type === 'open') {
        if (!q.answer || typeof q.answer !== 'string') errors.push(qw + ' 非選題需要參考答案（字串）');
      }
    });
  });

  if (total !== 100) warns.push('滿分是 ' + total + ' 分，不是 100');
  if (count) {
    LEVELS.forEach(l => {
      const ratio = levels[l] / count;
      if (Math.abs(ratio - TARGET[l]) > 0.12) warns.push('難度「' + l + '」占 ' + Math.round(ratio * 100) + '%，目標約 ' + TARGET[l] * 100 + '%');
    });
  }

  const tag = errors.length ? '✗' : (warns.length ? '△' : '✓');
  console.log(tag + ' ' + file);
  console.log('    ' + count + ' 題｜滿分 ' + total + '｜中等 ' + levels.中等 + '／中上 ' + levels.中上 + '／素養 ' + levels.素養);
  errors.forEach(e => console.log('    錯誤：' + e));
  warns.forEach(w => console.log('    警告：' + w));
  if (errors.length) exitCode = 1;
}

const files = process.argv.slice(2);
if (!files.length) { console.error('用法：node validate_exam.js <考卷.json> ...'); process.exit(2); }
files.forEach(check);
process.exit(exitCode);
