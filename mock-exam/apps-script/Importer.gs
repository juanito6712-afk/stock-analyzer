/**
 * 米蘭老師題庫（melances.com）九年級 社會／自然 → 搬進 Google Drive 的 _sources 資料夾
 *
 * 為什麼要用 Apps Script：Claude 的雲端環境連不到 melances.com，但 Apps Script 跑在 Google 的伺服器上，
 * 可以直接下載再存進你的雲端硬碟。
 *
 * 用法（建議貼進「全新的獨立專案」，不要貼進模擬試題那個專案，才不會動到已上線的網頁）：
 *   1. 開 https://script.google.com → 新專案 → 把這整份貼進 Code.gs → 存檔
 *   2. 先執行 scanMelances()   （第一次會跳出授權，選你的帳號 → 進階 → 允許）
 *      它只會「掃描」網站、把找到的連結寫成 _sources/九年級/_melances-連結清單.txt，不會下載
 *   3. 回 Claude 說「掃描好了」，我會讀那份清單，確認抓得到正確的連結
 *   4. 再執行 downloadMelances()，它會分批下載（約每 5 分鐘一批，會自己排下一批），全部完成會寫在紀錄裡
 *
 * 整理方式：沿用八年級那份的結構，再多分一層科目 ——
 *           _sources/113學年度9年級段考試題/上學期第1次段考/社會/檔名.pdf（以及 自然/）
 *           同樣有 114學年度9年級段考試題，檔名保留原檔名；另外產生 _sources/九年級/_索引.json
 *           （學年、學期、第幾次段考、科目、細項（歷史／地理／公民／理化／地科）、學校、題目／答案、版本、檔案 ID）
 *
 * 狀態（做到哪裡）存在 _sources/九年級/_state.json，不用 Script Properties（它只有約 500KB，米蘭的清單有 4 千多筆放不下）。
 * 第二次以後只要直接執行 downloadMelances()：它會讀 _melances-連結清單.txt，不用重掃。
 *
 * 米蘭老師的連結多半是「Google 雲端硬碟資料夾」，所以這支會連資料夾一起掃（含子資料夾），
 * 並把每個資料夾裡的檔名都列進連結清單，方便先確認再下載。
 */

var CFG = {
  BASE: 'https://melances.com/grade9/',
  TARGET_FOLDER_ID: '1Nev7cB8saVBswwYZ_H37F4V1jAFPaOZi',   // 模擬試題/_sources
  YEARS: ['113', '114'],
  SUBJECT_KEYS: { '社會': ['社會', '歷史', '地理', '公民'], '自然': ['自然', '理化', '物理', '化學', '生物', '地科'] },
  MAX_PAGES: 60,           // 掃描時最多跟進幾個子頁
  TIME_BUDGET_MS: 5 * 60 * 1000
};

/* ------------------------------------------------------------ 第一步：掃描 */

function scanMelances() {
  var root = rootFolder_();
  saveText_(root, '_melances-掃描狀態.txt', '開始掃描 ' + new Date() + '\n（如果只看到這一行，代表掃描中途出錯，請把「執行記錄」貼給 Claude）');
  var seen = {}, queue = [CFG.BASE], pages = 0, files = [], folders = [], notes = [];
  while (queue.length && pages < CFG.MAX_PAGES) {
    var url = queue.shift();
    if (seen[url]) continue;
    seen[url] = true;
    var html = fetchText_(url);
    if (html == null) { notes.push('讀不到：' + url); continue; }
    pages++;
    extractLinks_(html, url).forEach(function (l) {
      if (isFolder_(l.href)) folders.push({ page: url, text: l.text, href: l.href });
      else if (isFile_(l.href)) files.push({ page: url, text: l.text, href: l.href });
      else if (isSubPage_(l.href) && !seen[l.href]) queue.push(l.href);
    });
  }
  var uniq = {};
  folders = folders.filter(function (l) { var id = folderId_(l.href); if (uniq[id]) return false; uniq[id] = 1; return true; });
  files = files.filter(function (l) { if (uniq[l.href]) return false; uniq[l.href] = 1; return true; });

  // 展開 Drive 資料夾（含子資料夾），把每個檔案列出來
  var items = files.map(function (l) { return { kind: 'url', path: l.text, name: l.text, href: l.href }; });
  folders.forEach(function (l) {
    try { walkFolder_(folderId_(l.href), l.text || '資料夾', 0, items); }
    catch (e) { notes.push('打不開資料夾 ' + l.href + ' → ' + e); }
  });

  var lines = ['掃描時間：' + new Date(), '掃描頁數：' + pages, '網頁上的檔案連結：' + files.length,
               '網頁上的 Drive 資料夾連結：' + folders.length, '展開後的檔案總數：' + items.length, ''];
  if (notes.length) lines.push('備註：', notes.join('\n'), '');
  items.forEach(function (it) { lines.push((it.path || '') + '\t' + it.name + '\t' + (it.id || it.href)); });
  saveText_(root, '_melances-連結清單.txt', lines.join('\n'));
  Logger.log('完成：頁數 ' + pages + '、檔案連結 ' + files.length + '、Drive 資料夾 ' + folders.length + '、展開後檔案 ' + items.length +
             '。已寫入 _sources/九年級/_melances-連結清單.txt');
}

function walkFolder_(id, path, depth, out) {
  var f = DriveApp.getFolderById(id);
  var it = f.getFiles();
  while (it.hasNext()) { var x = it.next(); out.push({ kind: 'drive', path: path, name: x.getName(), id: x.getId() }); }
  if (depth >= 4) return;
  var sub = f.getFolders();
  while (sub.hasNext()) { var d = sub.next(); walkFolder_(d.getId(), path + '/' + d.getName(), depth + 1, out); }
}

/* ------------------------------------------------------------ 第二步：下載 */

function downloadMelances() {
  var root = rootFolder_();
  var items = readList_(root);
  if (!items.length) { Logger.log('找不到 _melances-連結清單.txt，請先執行 scanMelances()'); return; }
  var state = readJson_(root, '_state.json', { done: {}, index: [] });
  var start = Date.now(), got = 0, skipped = 0, left = 0;

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (state.done[it.id]) continue;
    var meta = classify_(it);
    if (!meta) { state.done[it.id] = 'skip'; skipped++; continue; }   // 不是 113/114 的 社會／自然
    if (Date.now() - start > CFG.TIME_BUDGET_MS) { left++; continue; }  // 時間到，留給下一批
    try {
      var file = saveToDrive_(it, meta);
      state.done[it.id] = file ? file.getId() : 'exists';
      if (file) {
        got++;
        state.index.push({ year: meta.year, term: meta.term === '1' ? '上學期' : '下學期', exam: meta.exam, subject: meta.subject,
                           detail: meta.detail, school: meta.school, kind: meta.kind, pub: meta.pub,
                           name: file.getName(), fileId: file.getId(), srcId: it.id });
      }
    } catch (e) {
      state.done[it.id] = 'fail';
      Logger.log('失敗：' + it.name + ' → ' + e);
    }
  }
  writeJson_(root, '_state.json', state);
  writeJson_(root, '_索引.json', state.index);

  Logger.log('本批複製 ' + got + ' 個，略過（不在範圍）' + skipped + ' 個，還沒做 ' + left + ' 個');
  clearTriggers_();
  if (left > 0) {
    ScriptApp.newTrigger('downloadMelances').timeBased().after(60 * 1000).create();
    Logger.log('1 分鐘後自動執行下一批');
  } else {
    var fails = Object.keys(state.done).filter(function (k) { return state.done[k] === 'fail'; }).length;
    Logger.log('全部完成。失敗 ' + fails + ' 個（再執行一次會重試）。索引：_sources/九年級/_索引.json');
    if (fails) {
      Object.keys(state.done).forEach(function (k) { if (state.done[k] === 'fail') delete state.done[k]; });
      writeJson_(root, '_state.json', state);
    }
  }
}

/** 想整個重來時執行（已複製的檔案不會刪；下次遇到同名會略過） */
function resetProgress() {
  var root = rootFolder_();
  writeJson_(root, '_state.json', { done: {}, index: [] });
  clearTriggers_();
}

function readList_(folder) {
  var it = folder.getFilesByName('_melances-連結清單.txt');
  if (!it.hasNext()) return [];
  var out = [];
  it.next().getBlob().getDataAsString('UTF-8').split('\n').forEach(function (line) {
    var a = line.split('\t');
    if (a.length >= 3 && /^[-\w]{20,}$/.test(a[2].trim())) out.push({ path: a[0], name: a[1], id: a[2].trim() });
  });
  return out;
}

function readJson_(folder, name, dflt) {
  var it = folder.getFilesByName(name);
  if (!it.hasNext()) return dflt;
  try { return JSON.parse(it.next().getBlob().getDataAsString('UTF-8')); } catch (e) { return dflt; }
}

function writeJson_(folder, name, obj) { saveText_(folder, name, JSON.stringify(obj)); }

/* ------------------------------------------------------------ 分類 */

/** 米蘭 grade9 頁面的檔名有好幾種寫法，例如：
 *   市立大灣國中 九年級 113 上學期 社會領域 地理 第一次段考 期中考 康軒 試卷.pdf
 *   114-2-2屏東明正國中9年級-社會解答.pdf　　113_1_1_3_高雄陽明-理化.pdf　　113-1九年級第一次段考社會科試題卷.pdf
 *  回傳 {year, term(1上/2下), exam, subject(社會/自然/全科), detail, school, kind, pub}；不是 113/114 學年的 社會／自然 就回 null */
function cnNum(c){return '一二三'.indexOf(c)+1;}
function classify_(it){
  var p=it.path||'', n=it.name||'', s=p+' '+n;
  // 1. 年級：只要九年級（三年級／9）
  // 米蘭 grade9 頁面的檔案本來就是九年級；只排除檔名明寫七、八年級的
  if (/七年級|八年級|(^|[^一-龥])8年級|7年級/.test(n)) return null;
  // 2. 學年、學期、次別
  var year=null, term='', exam='', m;
  if ((m=n.match(/(1[01]\d)\s*[-_]\s*([12])\s*[-_]\s*([123])/))) { year=m[1]; term=m[2]; exam=m[3]; }
  else if ((m=n.match(/(1[01]\d)\s*[-_ ]\s*([12])(?!\d)/))) { year=m[1]; term=m[2]; }
  else if ((m=n.match(/(1[01]\d)\s*學?年?度?\s*第?([一二])學期/)) ) { year=m[1]; term=String(cnNum(m[2])); }
  if (!year && (m=n.match(/(1[01]\d)/))) year=m[1];
  if (!year) return null;
  if (CFG.YEARS.indexOf(year) < 0) return null;
  if (!term && (m=n.match(/第([一二])學期/))) term=String(cnNum(m[1]));
  if (!term && (m=n.match(/([上下])學期/))) term = m[1]==='上'?'1':'2';
  if (!exam && (m=n.match(/第([一二三])次/))) exam=String(cnNum(m[1]));
  if (!exam && (m=p.match(/第([一二三])次段考/))) exam=String(cnNum(m[1]));
  // 3. 科目
  var subject=null, detail='';
  var soc=/社會|歷史|地理|公民|9[社歷地公]/, nat=/自然|理化|地球科學|地科|生物|9[自理]/;
  if (nat.test(n)) { subject='自然'; detail=(n.match(/理化|地球科學|地科|生物|自然/)||[/9理/.test(n)?'理化':'自然'])[0]; }
  else if (soc.test(n)) { subject='社會'; detail=(n.match(/歷史|地理|公民/)||['社會'])[0]; }
  else if (/不分科|歷史|地理|公民/.test(p)) { subject='社會'; detail=(p.match(/歷史|地理|公民/)||['社會'])[0]; }
  if (!subject && /段考答案|參考答案/.test(n) && !/國文|英文|英語|數學|作文/.test(n)) { subject='全科'; detail='全科答案'; }
  if (!subject) return null;
  // 4. 學校、題目/答案、版本
  var school=(n.match(/([一-龥]{2,8}?(?:國中|國民中學|高中附設國中部|附中))/)||[])[1]
    ||(n.match(/\d{3}[-_ ]?(?:\d[-_ ]?){0,3}[-_ ]?((?:台北|臺北|新北|高雄|屏東|土城|大灣|仁愛|興雅|陽明|中正|明正)[一-龥]{0,3})/)||[])[1]||'';
  school=school.replace(/^(市立|縣立|私立)/,'');
  var kind=/答案|解答|詳解|解析|參考答案/.test(n)?'答案':(/含解答|含答案/.test(n)?'題目含答案':'題目');
  var pub=(n.match(/南一|康軒|翰林/)||[''])[0];
  school = (typeof SCHOOL_FIX !== 'undefined' && SCHOOL_FIX[school]) || school || '未標示學校';
  return {year:year, term:term, exam:exam, subject:subject, detail:detail, school:school, kind:kind, pub:pub};
}

/* ------------------------------------------------------------ 下載與存檔 */

var SCHOOL_FIX = { '土城': '土城國中', '高雄大灣': '高雄大灣國中', '屏東中正': '屏東中正國中', '高雄陽明': '高雄陽明國中', '台北市仁愛國中': '臺北市仁愛國中' };

function saveToDrive_(it, meta) {
  var exam = meta.exam ? '第' + meta.exam + '次段考' : '其他';
  var term = meta.term === '1' ? '上學期' : (meta.term === '2' ? '下學期' : '未分學期');
  var folder = ensurePath_(DriveApp.getFolderById(CFG.TARGET_FOLDER_ID),
                           [meta.year + '學年度9年級段考試題', term + exam, meta.subject === '全科' ? '全科答案' : meta.subject]);
  if (exists_(folder, it.name)) return null;
  return DriveApp.getFileById(it.id).makeCopy(it.name, folder);
}

/* ------------------------------------------------------------ 小工具 */

function rootFolder_() {
  return ensurePath_(DriveApp.getFolderById(CFG.TARGET_FOLDER_ID), ['九年級']);
}

function ensurePath_(folder, parts) {
  parts.forEach(function (p) {
    var it = folder.getFoldersByName(p);
    folder = it.hasNext() ? it.next() : folder.createFolder(p);
  });
  return folder;
}

function exists_(folder, name) { return folder.getFilesByName(name).hasNext(); }

function saveText_(folder, name, text) {
  var it = folder.getFilesByName(name);
  if (it.hasNext()) it.next().setContent(text); else folder.createFile(name, text, MimeType.PLAIN_TEXT);
}

function fetchText_(url) {
  try {
    var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
    return r.getResponseCode() === 200 ? r.getContentText('UTF-8') : null;
  } catch (e) { Logger.log('讀取失敗 ' + url + ' → ' + e); return null; }
}

function extractLinks_(html, base) {
  var out = [], re = /<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html))) {
    var text = m[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    out.push({ href: abs_(m[1], base), text: text });
  }
  return out;
}

function abs_(href, base) {
  if (/^https?:/i.test(href)) return href;
  var m = base.match(/^(https?:\/\/[^\/]+)(\/.*)?$/);
  if (href.charAt(0) === '/') return m[1] + href;
  var dir = (m[2] || '/').replace(/[^\/]*$/, '');
  return m[1] + dir + href;
}

function isFile_(href) {
  return !isFolder_(href) && (/\.(pdf|zip|rar|docx?|pptx?)(\?|$)/i.test(href) || /drive\.google\.com\/(file\/d\/|open\?id=)/.test(href));
}

function isFolder_(href) { return /drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|drive\/mobile\/folders\/|folderview\?id=|open\?id=[^&]+&?.*folder)/.test(href); }

function folderId_(href) { var m = String(href).match(/(?:folders\/|[?&]id=)([-\w]{20,})/); return m ? m[1] : href; }

function isSubPage_(href) {
  return href.indexOf('melances.com') >= 0 && href.indexOf('/grade9') >= 0 && !isFile_(href);
}

function safeDecode_(x) { try { return decodeURIComponent(x); } catch (e) { return x; } }

function clearTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'downloadMelances') ScriptApp.deleteTrigger(t);
  });
}
