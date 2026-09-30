// 考卷網頁的介面測試：用真的 Chromium 開 index.html，配上假的 google.script.run，
// 驗證「主選單 → 科目 → 考卷 → 結果」的分類導覽，以及每一頁都能回主選單。
// 執行：node mock-exam/test/ui_test.js   （需要全域安裝的 playwright 與 chromium）
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(path.join(globalRoot, 'playwright'));

const html = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'index.html'), 'utf8');

// 假後端：清單刻意打亂順序、混合多科，驗證前端會分科、排序
const EXAMS = [
  { id: 'm1', title: '乘法公式練習卷', subject: '數學', grade: '八上', chapter: '1-1', date: '2026-09-19' },
  { id: 'c1', title: '國文 L2 大卷', subject: '國文', grade: '八上', chapter: 'L2', date: '2026-09-23' },
  { id: 'e1', title: '英文 L2 對話', subject: '英文', grade: '八上', chapter: 'L2', date: '2026-09-24' },
  { id: 'c2', title: '國文 L3 小卷(二)', subject: '國文', grade: '八上', chapter: 'L3', date: '2026-10-01' },
  { id: 'p1', title: '理化 2-1~2-2', subject: '理化', grade: '八上', chapter: '2-1', date: '2026-10-01' },
  { id: 'm2', title: '多項式加減', subject: '數學', grade: '八上', chapter: '1-2', date: '2026-09-21' },
  { id: 'g1', title: '中國的地形', subject: '地理', grade: '八上', chapter: '1', date: '2026-09-19' },
  { id: 'x1', title: '未知科目卷', subject: '美術', grade: '八上', chapter: '-', date: '2026-09-20' },
  { id: 'c3', title: '國文 L3 小卷(一)', subject: '國文', grade: '八上', chapter: 'L3', date: '2026-09-30' }
];

const mockScript = `
(function(){
  var EXAMS = ${JSON.stringify(EXAMS)};
  var calls = window.__calls = [];
  function exam(id){
    var e = EXAMS.filter(function(x){ return x.id === id; })[0];
    return { id: e.id, title: e.title, grade: e.grade, subject: e.subject, chapter: e.chapter, note: '', full: 10,
      sections: [
        { type:'mc', name:'選擇題', points:5, questions:[
          { key:'0-0', q:'第一題？', options:['甲','乙','丙','丁'] },
          { key:'0-1', q:'第二題？', options:['甲','乙','丙','丁'] } ] },
        { type:'fill', name:'填充題', points:0, questions:[ { key:'1-0', q:'填空' } ] } ] };
  }
  function run(){
    var ok, fail, api = {
      withSuccessHandler: function(f){ ok = f; return api; },
      withFailureHandler: function(f){ fail = f; return api; }
    };
    ['apiLogin','apiGetExam','apiSubmit','apiRecordOpen'].forEach(function(name){
      api[name] = function(){
        var args = Array.prototype.slice.call(arguments);
        calls.push(name);
        setTimeout(function(){
          try {
            if (name === 'apiLogin') {
              if (args[0] !== 'ok') throw new Error('代碼不正確');
              ok({ student:{ name:'宇翔' }, exams: EXAMS.slice() });
            } else if (name === 'apiGetExam') {
              ok({ student:{ name:'宇翔' }, exam: exam(args[1]) });
            } else if (name === 'apiSubmit') {
              ok({ attemptId:'a1', objectiveScore:5, full:10, wrong:['選擇題2'], items:[
                { key:'0-0', label:'選擇題1', type:'mc', points:5, correct:true, given:'0', givenText:'甲', answerIndex:0, answerText:'甲', explain:'' },
                { key:'0-1', label:'選擇題2', type:'mc', points:5, correct:false, given:'1', givenText:'乙', answerIndex:2, answerText:'丙', explain:'因為…' },
                { key:'1-0', label:'填充題1', type:'fill', points:0, correct:false, given:'', answerText:'答', explain:'' } ] });
            } else { ok({ total: 5 }); }
          } catch (e) { if (fail) fail(e); }
        }, 5);
      };
    });
    return api;
  }
  window.google = { script: { get run(){ return run(); } } };
})();`;

function page(preset, examId) {
  return html
    .replace('<?= examId ?>', examId || '')
    .replace('<?= presetCode ?>', preset || '')
    .replace('<head>', '<head><script>' + mockScript + '</script>');
}

let failures = 0;
function check(cond, label) {
  if (cond) console.log('ok   ' + label);
  else { console.error('FAIL ' + label); failures++; }
}
const visible = async (p, id) => !(await p.$eval('#' + id, e => e.classList.contains('hide')));

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });

  async function open(preset, examId) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    await ctx.route('**/*mathjax*', r => r.abort());
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push(String(e)));
    await p.route('https://example.test/**', r => r.fulfill({ contentType: 'text/html', body: page(preset, examId) }));
    await p.goto('https://example.test/exec');
    p.__errors = errors;
    return p;
  }

  // ---------- 情境一：從登入一路點到結果 ----------
  let p = await open('', '');
  check(await visible(p, 'gate'), '沒有代碼 → 先看到登入頁');

  await p.fill('#code', 'bad');
  await p.click('#go');
  await p.waitForFunction(() => document.getElementById('gateErr').textContent.length > 0);
  check((await p.textContent('#gateErr')).includes('代碼不正確'), '錯誤代碼 → 顯示錯誤、留在登入頁');

  await p.fill('#code', 'ok');
  await p.click('#go');
  await p.waitForSelector('#menu:not(.hide)');
  check(await visible(p, 'menu'), '正確代碼 → 進入主選單');
  check(!(await visible(p, 'subj')) && !(await visible(p, 'exam')), '主選單不會同時顯示考卷清單');

  const names = await p.$$eval('#subjects .subj-card .nm', els => els.map(e => e.textContent));
  check(JSON.stringify(names) === JSON.stringify(['國文', '英文', '數學', '理化', '地理', '美術']),
    '科目依「國英數理地…」排序，未知科目排最後：' + names.join('、'));
  const counts = await p.$$eval('#subjects .subj-card', els => els.map(e => e.querySelector('.num').textContent));
  check(counts[0] === '3 份考卷' && counts[2] === '2 份考卷', '每個科目顯示份數：' + counts.join('、'));
  check((await p.textContent('#who')).includes('宇翔'), '主選單有問候學生');
  const menuShowsExamTitles = (await p.textContent('#subjects')).includes('乘法公式練習卷');
  check(!menuShowsExamTitles, '主選單只有科目，不列出每一份考卷');

  await p.click('.subj-card[data-subj="國文"]');
  await p.waitForSelector('#subj:not(.hide)');
  check((await p.textContent('#subjTitle')).includes('國文'), '點「國文」→ 進入國文清單');
  const titles = await p.$$eval('#exams button strong', els => els.map(e => e.textContent));
  check(JSON.stringify(titles) === JSON.stringify(['國文 L3 小卷(二)', '國文 L3 小卷(一)', '國文 L2 大卷']),
    '只列國文，新的在上：' + titles.join(' / '));
  check(await p.$eval('#subj .nav [data-act=home]', e => !!e), '科目頁有「🏠 主選單」');

  await p.click('#subj [data-act=home]');
  await p.waitForSelector('#menu:not(.hide)');
  check(await visible(p, 'menu'), '科目頁 → 回主選單');

  await p.click('.subj-card[data-subj="數學"]');
  await p.waitForSelector('#subj:not(.hide)');
  await p.click('#exams button[data-id="m1"]');
  await p.waitForSelector('#exam:not(.hide)');
  check(await visible(p, 'exam'), '點考卷 → 進入作答頁');
  check((await p.textContent('#exSubjBtn')).includes('數學'), '作答頁有「‹ 數學」返回鈕');
  check((await p.$$('#exam [data-act=home]')).length >= 2, '作答頁有兩個回主選單入口（上方導覽＋底部固定列）');

  await p.click('#exam .bar [data-act=home]');
  await p.waitForSelector('#menu:not(.hide)');
  check(await visible(p, 'menu'), '作答頁底部的 🏠 → 回主選單');

  await p.click('.subj-card[data-subj="數學"]');
  await p.waitForSelector('#subj:not(.hide)');
  await p.click('#exams button[data-id="m1"]');
  await p.waitForSelector('#exam:not(.hide)');
  await p.check('input[name="0-0"][value="0"]');
  check((await p.textContent('#progress')).includes('1 / 3'), '作答後進度更新：' + (await p.textContent('#progress')));

  await p.click('#exSubjBtn');
  await p.waitForSelector('#subj:not(.hide)');
  check((await p.textContent('#subjTitle')).includes('數學'), '作答頁「‹ 數學」→ 回數學清單');

  await p.click('#exams button[data-id="m1"]');
  await p.waitForSelector('#exam:not(.hide)');
  check(await p.isChecked('input[name="0-0"][value="0"]'), '離開再回來，作答進度還在');

  p.on('dialog', d => d.accept());
  await p.click('#submit');
  await p.waitForSelector('#result:not(.hide)');
  check(await visible(p, 'result'), '交卷 → 結果頁');
  check((await p.$$('#result [data-act=home]')).length >= 2, '結果頁有回主選單入口');
  check((await p.textContent('#resSubjBtn')).includes('數學'), '結果頁有「‹ 數學」');
  check(!(await p.$eval('#retryWrong', e => e.classList.contains('hide'))), '有錯題 → 顯示「只重做錯的題目」');

  // 重做錯題，離開，再開完整考卷：草稿不可混進來
  await p.click('#retryWrong');
  await p.waitForSelector('#exam:not(.hide)');
  const retryQs = await p.$$eval('#exBody .q', els => els.length);
  check(retryQs === 2, '重做模式只剩錯題（' + retryQs + ' 題）');
  await p.check('input[name="0-1"][value="3"]');
  await p.click('#exam .bar [data-act=home]');
  await p.waitForSelector('#menu:not(.hide)');
  await p.click('.subj-card[data-subj="數學"]');
  await p.waitForSelector('#subj:not(.hide)');
  await p.click('#exams button[data-id="m1"]');
  await p.waitForSelector('#exam:not(.hide)');
  const fullQs = await p.$$eval('#exBody .q', els => els.length);
  check(fullQs === 3, '重新開啟是完整考卷（' + fullQs + ' 題），不是重做模式');
  check(!(await p.isChecked('input[name="0-1"][value="3"]')), '重做的草稿沒有混進完整考卷');

  check(p.__errors.length === 0, '整段操作沒有 JS 錯誤' + (p.__errors.length ? '：' + p.__errors.join(';') : ''));
  await p.context().close();

  // ---------- 情境二：從連結直接進考卷（?id=&k=） ----------
  p = await open('ok', 'c1');
  await p.waitForSelector('#exam:not(.hide)');
  check(await visible(p, 'exam'), '帶 id＋代碼的連結 → 直接進入該份考卷');
  check((await p.textContent('#exSubjBtn')).includes('國文'), '直連的考卷也有「‹ 國文」');
  await p.click('#exam .nav [data-act=home]');
  await p.waitForSelector('#menu:not(.hide)');
  check(await visible(p, 'menu'), '直連進來的考卷 → 也能回主選單');
  const n2 = await p.$$eval('#subjects .subj-card', els => els.length);
  check(n2 === 6, '回到主選單後科目完整（' + n2 + ' 科）');
  await p.click('.subj-card[data-subj="英文"]');
  await p.waitForSelector('#subj:not(.hide)');
  check((await p.$$eval('#exams button', els => els.length)) === 1, '再點科目 → 正常進入清單');
  await p.context().close();

  // ---------- 情境三：直連 → 「‹ 科目」鈕 ----------
  p = await open('ok', 'p1');
  await p.waitForSelector('#exam:not(.hide)');
  await p.click('#exSubjBtn');
  await p.waitForSelector('#subj:not(.hide)');
  check((await p.textContent('#subjTitle')).includes('理化'), '直連理化考卷 →「‹ 理化」→ 理化清單');
  await p.context().close();

  // ---------- 情境四：換人 ----------
  p = await open('ok', '');
  await p.waitForSelector('#menu:not(.hide)');
  await p.click('[data-act=logout]');
  check(await visible(p, 'gate'), '「換人／換代碼」→ 回到登入頁');
  check((await p.inputValue('#code')) === '', '登入欄位已清空');
  await p.context().close();

  await browser.close();
  console.log(failures ? '\n' + failures + ' 項失敗' : '\n全部通過');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
