// 把題目 JSON（或 SVG 片段）裡的圖截成 PNG，肉眼確認再上傳：
//   node mock-exam/tools/render_check.js <考卷.json> <輸出資料夾>
// 每一題含 <svg 的題目各產生一張 PNG。
const fs = require('fs'), path = require('path');
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const [,, file, outDir] = process.argv;
if (!file) { console.error('用法：node render_check.js <考卷.json> [輸出資料夾]'); process.exit(2); }
const exam = JSON.parse(fs.readFileSync(file, 'utf8')); const out = outDir || '.'; fs.mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  let n = 0;
  for (const [si, s] of exam.sections.entries()) for (const [qi, q] of s.questions.entries()) {
    if (!/<svg|<table/.test(q.q)) continue;
    const p = await b.newPage({ viewport: { width: 420, height: 400 } });
    await p.setContent('<body style="font:15px sans-serif;padding:8px;width:400px">' + q.q + '</body>');
    const f = path.join(out, `q${si + 1}-${qi + 1}.png`); await p.screenshot({ path: f, fullPage: true }); n++; await p.close();
  }
  await b.close(); console.log('產生 ' + n + ' 張圖 →', out);
})();
