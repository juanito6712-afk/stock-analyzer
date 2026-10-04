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
 * 整理方式：沿用八年級那份的結構 —— _sources/113學年度9年級段考試題/上學期第1次段考/檔名.pdf
 *           （同樣有 114學年度9年級段考試題），檔名保留原檔名；另外產生 _sources/九年級/_索引.json
 *           （學年、學期、第幾次段考、科目、學校、題目/答案、檔案 ID、來源），日後出題時用索引快速查
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
  PropertiesService.getScriptProperties().setProperty('ITEMS', JSON.stringify(items));
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
  var props = PropertiesService.getScriptProperties();
  var items = JSON.parse(props.getProperty('ITEMS') || '[]');
  if (!items.length) { Logger.log('還沒有清單，請先執行 scanMelances()'); return; }

  var done = JSON.parse(props.getProperty('DONE') || '{}');
  var index = JSON.parse(props.getProperty('INDEX') || '[]');
  var start = Date.now(), got = 0, skipped = 0;

  for (var i = 0; i < items.length; i++) {
    var it = items[i], key = it.id || it.href;
    if (done[key]) continue;
    var meta = classify_(it);
    if (!meta) { done[key] = 'skip'; skipped++; continue; }      // 不是 113/114 的 社會／自然
    if (Date.now() - start > CFG.TIME_BUDGET_MS) continue;       // 時間到，留給下一批
    try {
      var file = saveToDrive_(it, meta);
      done[key] = file ? file.getId() : 'exists';
      if (file) {
        got++;
        index.push({ year: meta.year, term: meta.term, exam: meta.exam, subject: meta.subject, school: meta.school, kind: meta.kind,
                     name: file.getName(), fileId: file.getId(), src: it.href || it.id, path: it.path });
      }
    } catch (e) {
      done[key] = 'fail';
      Logger.log('失敗：' + it.name + ' → ' + e);
    }
  }
  props.setProperty('DONE', JSON.stringify(done));
  props.setProperty('INDEX', JSON.stringify(index));
  saveText_(rootFolder_(), '_索引.json', JSON.stringify(index, null, 1));

  var remaining = items.filter(function (it) { return !done[it.id || it.href]; }).length;
  Logger.log('本批下載 ' + got + ' 個，略過（不在範圍）' + skipped + ' 個，尚餘 ' + remaining + ' 個');
  clearTriggers_();
  if (remaining > 0) {
    ScriptApp.newTrigger('downloadMelances').timeBased().after(60 * 1000).create();
    Logger.log('1 分鐘後自動執行下一批');
  } else {
    Logger.log('全部完成。索引：_sources/九年級/_索引.json');
  }
}

/** 想重來時執行：清掉進度（已下載的檔案不會刪，下次會因同名而略過） */
function resetProgress() {
  PropertiesService.getScriptProperties().deleteProperty('DONE');
  PropertiesService.getScriptProperties().deleteProperty('INDEX');
  clearTriggers_();
}

/* ------------------------------------------------------------ 分類 */

/** 回傳 {year, term, exam, subject, school, kind}；不是 113/114 學年的 社會／自然 就回 null
 *  米蘭的檔名慣例：114-2-2屏東明正國中8年級-社會解答.pdf（學年-學期-第幾次段考＋學校＋年級＋科目＋題目／解答） */
function classify_(it) {
  var s = (it.path || '') + ' ' + (it.name || '') + ' ' + safeDecode_(String(it.href || '').split('/').pop());
  var year = null, term = '', exam = '';
  var m = s.match(/(11[0-9])\s*[-_－]\s*([12])\s*[-_－]\s*([123])/);
  if (m) { year = m[1]; term = m[2] === '1' ? '上學期' : '下學期'; exam = m[3]; }
  if (!year) CFG.YEARS.forEach(function (y) { if (!year && s.indexOf(y) >= 0) year = y; });
  if (!year || CFG.YEARS.indexOf(year) < 0) return null;
  if (!term) { term = /第二學期|下學期/.test(s) ? '下學期' : (/第一學期|上學期/.test(s) ? '上學期' : '未分學期'); }
  if (!exam) { var em = s.match(/第\s*([一二三123])\s*次/); if (em) exam = String('一二三123'.indexOf(em[1]) % 3 + 1); }

  var subject = null;
  Object.keys(CFG.SUBJECT_KEYS).forEach(function (k) {
    CFG.SUBJECT_KEYS[k].forEach(function (w) { if (!subject && s.indexOf(w) >= 0) subject = k; });
  });
  if (!subject) return null;
  if (/[78]年級|二年級|七年級|八年級/.test(s) && !/9年級|九年級|三年級/.test(s)) return null;   // 只要九年級

  var school = (s.match(/([一-龥]{2,8}?(?:國中|國民中學|高中附設國中部|附中|中學))/) || [])[1] || '未標示學校';
  var kind = /答案|解答|詳解|ans/i.test(s) ? '答案' : '題目';
  return { year: year, term: term, exam: exam, subject: subject, school: school, kind: kind };
}

/* ------------------------------------------------------------ 下載與存檔 */

function saveToDrive_(it, meta) {
  var examName = meta.exam ? '第' + meta.exam + '次段考' : '其他';
  var folder = ensurePath_(DriveApp.getFolderById(CFG.TARGET_FOLDER_ID), [meta.year + '學年度9年級段考試題', meta.term + examName]);
  var name = it.name;
  if (exists_(folder, name)) return null;
  if (it.id) return DriveApp.getFileById(it.id).makeCopy(name, folder);

  var m = String(it.href).match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([-\w]{20,})/);
  if (m) return DriveApp.getFileById(m[1]).makeCopy(name, folder);
  var resp = UrlFetchApp.fetch(it.href, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': CFG.BASE } });
  if (resp.getResponseCode() !== 200) throw new Error('HTTP ' + resp.getResponseCode());
  var orig = safeDecode_(String(it.href).split('?')[0].split('/').pop() || 'file');
  if (!/\.\w{2,4}$/.test(name)) name = orig;
  if (exists_(folder, name)) return null;
  return folder.createFile(resp.getBlob().setName(name));
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
