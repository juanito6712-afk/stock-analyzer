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
 * 整理方式：_sources/九年級/<社會|自然>/<113學年|114學年>/<學校>/檔名.pdf
 *           並產生 _sources/九年級/_索引.json（學年、科目、學校、第幾次段考、題目/答案、檔案 ID）
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
  var seen = {}, queue = [CFG.BASE], pages = 0, links = [];
  while (queue.length && pages < CFG.MAX_PAGES) {
    var url = queue.shift();
    if (seen[url]) continue;
    seen[url] = true;
    var html = fetchText_(url);
    if (html == null) continue;
    pages++;
    extractLinks_(html, url).forEach(function (l) {
      if (isFile_(l.href)) {
        links.push({ page: url, text: l.text, href: l.href });
      } else if (isSubPage_(l.href) && !seen[l.href]) {
        queue.push(l.href);
      }
    });
  }
  // 去重
  var uniq = {}, out = [];
  links.forEach(function (l) { if (!uniq[l.href]) { uniq[l.href] = 1; out.push(l); } });

  var lines = ['掃描時間：' + new Date(), '掃描頁數：' + pages, '找到檔案連結：' + out.length, ''];
  out.forEach(function (l) { lines.push(l.text.replace(/\s+/g, ' ') + '\t' + l.href + '\t(來自 ' + l.page + ')'); });
  var root = rootFolder_();
  saveText_(root, '_melances-連結清單.txt', lines.join('\n'));
  PropertiesService.getScriptProperties().setProperty('LINKS', JSON.stringify(out));
  Logger.log('完成：共 ' + out.length + ' 個檔案連結，已寫入 _sources/九年級/_melances-連結清單.txt');
}

/* ------------------------------------------------------------ 第二步：下載 */

function downloadMelances() {
  var props = PropertiesService.getScriptProperties();
  var links = JSON.parse(props.getProperty('LINKS') || '[]');
  if (!links.length) { Logger.log('還沒有連結清單，請先執行 scanMelances()'); return; }

  var done = JSON.parse(props.getProperty('DONE') || '{}');
  var index = JSON.parse(props.getProperty('INDEX') || '[]');
  var start = Date.now(), todo = 0, got = 0, skipped = 0;

  for (var i = 0; i < links.length; i++) {
    var l = links[i];
    if (done[l.href]) continue;
    var meta = classify_(l);
    if (!meta) { done[l.href] = 'skip'; skipped++; continue; }   // 不是 社會/自然 或 不是 113/114
    todo++;
    if (Date.now() - start > CFG.TIME_BUDGET_MS) continue;       // 時間到，留給下一批
    try {
      var file = saveToDrive_(l, meta);
      done[l.href] = file ? file.getId() : 'fail';
      if (file) {
        got++;
        index.push({ year: meta.year, subject: meta.subject, school: meta.school, exam: meta.exam, kind: meta.kind,
                     name: file.getName(), fileId: file.getId(), src: l.href, text: l.text });
      }
    } catch (e) {
      done[l.href] = 'fail';
      Logger.log('失敗：' + l.href + ' → ' + e);
    }
  }
  props.setProperty('DONE', JSON.stringify(done));
  props.setProperty('INDEX', JSON.stringify(index));
  saveText_(rootFolder_(), '_索引.json', JSON.stringify(index, null, 1));

  var remaining = links.filter(function (l) { return !done[l.href]; }).length;
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

/** 回傳 {year, subject, school, exam, kind}；不屬於 113/114 的 社會／自然 就回 null */
function classify_(l) {
  var s = decodeURIComponent((l.text || '') + ' ' + l.href.split('/').pop());
  var year = null;
  CFG.YEARS.forEach(function (y) { if (s.indexOf(y) >= 0) year = year || y; });
  if (!year) return null;

  var subject = null;
  Object.keys(CFG.SUBJECT_KEYS).forEach(function (k) {
    CFG.SUBJECT_KEYS[k].forEach(function (w) { if (!subject && s.indexOf(w) >= 0) subject = k; });
  });
  if (!subject) return null;

  var school = (s.match(/([一-龥]{2,6}(?:國中|國民中學|中學|高中附設國中部|附中))/) || [])[1] || '未標示學校';
  var exam = '';
  var em = s.match(/第?\s*([一二三123])\s*次\s*(?:段考|定期|評量|月考)/);
  if (em) exam = '第' + '一二三'.charAt('一二三123'.indexOf(em[1]) % 3) + '次段考';
  else if (/期末/.test(s)) exam = '期末';
  else if (/期中/.test(s)) exam = '期中';
  var kind = /答案|解答|詳解|ans/i.test(s) ? '答案' : (/題目|試題|考卷|題/.test(s) ? '題目' : '檔案');
  return { year: year, subject: subject, school: school, exam: exam, kind: kind };
}

/* ------------------------------------------------------------ 下載與存檔 */

function saveToDrive_(l, meta) {
  var folder = ensurePath_(rootFolder_(), [meta.subject, meta.year + '學年', meta.school]);
  var m = l.href.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([-\w]{20,})/);
  var base = [meta.year, meta.exam, meta.school, meta.subject, meta.kind].filter(String).join('_');
  if (m) {
    var src = DriveApp.getFileById(m[1]);
    var nm = base + '_' + src.getName();
    if (exists_(folder, nm)) return null;
    return src.makeCopy(nm, folder);
  }
  var resp = UrlFetchApp.fetch(l.href, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': CFG.BASE } });
  if (resp.getResponseCode() !== 200) throw new Error('HTTP ' + resp.getResponseCode());
  var blob = resp.getBlob();
  var orig = decodeURIComponent(l.href.split('?')[0].split('/').pop() || 'file');
  var name = base + '_' + orig;
  if (exists_(folder, name)) return null;
  blob.setName(name);
  return folder.createFile(blob);
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
  return /\.(pdf|zip|rar|docx?|pptx?)(\?|$)/i.test(href) || /drive\.google\.com\/(file\/d\/|open\?id=)/.test(href);
}

function isSubPage_(href) {
  return href.indexOf('melances.com') >= 0 && href.indexOf('/grade9') >= 0 && !isFile_(href);
}

function clearTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'downloadMelances') ScriptApp.deleteTrigger(t);
  });
}
