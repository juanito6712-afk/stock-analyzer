/**
 * 國中模擬試題 — Google Apps Script 網頁版
 *
 * 角色分工：
 *   Claude（雲端 session）→ 產生考卷 JSON，放進 Google Drive 的 模擬試題/考卷/<科目>/
 *   這支 script（跑在你的 Google 帳號下）→ 把考卷變成網頁、改分、把成績寫回 Drive 的試算表
 *   孩子 / 家教學生 → 只要拿到連結 + 代碼就能作答，不需要 Claude 帳號
 *
 * 安全模型：
 *   - 正確答案存在 Drive，只有這支 script 讀得到；送到瀏覽器的題目不含答案，改分在伺服器做。
 *   - 誰能作答由 模擬試題/名單.json 決定（一人一組代碼，可隨時停用）。
 */

var ROOT_FOLDER_NAME = '模擬試題';
var EXAM_DIR_NAME = '考卷';
var ROSTER_FILE_NAME = '名單.json';
var INDEX_FILE_NAME = '考卷索引.json';
var SHEET_FILE_NAME = '作答紀錄';
var SHEET_TAB = '紀錄';
var CACHE_SECONDS = 120;

var SHEET_HEADER = [
  '作答編號', '時間', '考卷ID', '科目', '年級', '章節',
  '學生', '代碼', '輪次', '客觀題得分', '非選自評', '總分', '滿分',
  '錯題', '明細JSON'
];

/* ------------------------------------------------------------------ 設定 */

function props_() {
  return PropertiesService.getScriptProperties();
}

/**
 * 第一次安裝時在編輯器裡手動執行一次：找到 Drive 的資料夾、建好名單與成績表。
 * 執行後看「執行紀錄」會印出結果。
 */
function setup() {
  var root = findRootFolder_();
  props_().setProperty('ROOT_FOLDER_ID', root.getId());

  var roster = fileInFolder_(root, ROSTER_FILE_NAME);
  if (!roster) {
    root.createFile(ROSTER_FILE_NAME, JSON.stringify({
      open: false,
      students: [
        { code: '換成你想要的代碼', name: '宇翔', grade: '8', group: '家裡' },
        { code: '換成你想要的代碼', name: '宇安', grade: '9', group: '家裡' }
      ]
    }, null, 2), MimeType.PLAIN_TEXT);
  }

  var sheetId = props_().getProperty('SHEET_ID');
  var sheetFile = sheetId ? tryGetFile_(sheetId) : null;
  if (!sheetFile) {
    var existing = fileInFolder_(root, SHEET_FILE_NAME);
    var ss;
    if (existing) {
      ss = SpreadsheetApp.openById(existing.getId());
    } else {
      ss = SpreadsheetApp.create(SHEET_FILE_NAME);
      DriveApp.getFileById(ss.getId()).moveTo(root);
    }
    var sheet = ss.getSheetByName(SHEET_TAB) || ss.getSheets()[0].setName(SHEET_TAB);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(SHEET_HEADER);
      sheet.setFrozenRows(1);
    }
    props_().setProperty('SHEET_ID', ss.getId());
  }

  var msg = [
    '資料夾：' + root.getName() + ' (' + root.getId() + ')',
    '成績表：' + props_().getProperty('SHEET_ID'),
    '名單：' + ROOT_FOLDER_NAME + '/' + ROSTER_FILE_NAME + '（請去改成你要的代碼）'
  ].join('\n');
  Logger.log(msg);
  return msg;
}

function findRootFolder_() {
  var id = props_().getProperty('ROOT_FOLDER_ID');
  if (id) {
    var f = tryGetFolder_(id);
    if (f) return f;
  }
  var it = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  if (!it.hasNext()) {
    throw new Error('在你的雲端硬碟找不到「' + ROOT_FOLDER_NAME + '」資料夾');
  }
  return it.next();
}

function tryGetFolder_(id) {
  try { return DriveApp.getFolderById(id); } catch (e) { return null; }
}

function tryGetFile_(id) {
  try { return DriveApp.getFileById(id); } catch (e) { return null; }
}

function fileInFolder_(folder, name) {
  var it = folder.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}

function folderInFolder_(folder, name) {
  var it = folder.getFoldersByName(name);
  return it.hasNext() ? it.next() : null;
}

/* ------------------------------------------------------------- 網頁進入點 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var t = HtmlService.createTemplateFromFile('index');
  t.examId = String(p.id || '');
  t.presetCode = String(p.k || '');
  return t.evaluate()
    .setTitle('模擬試題')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/* ------------------------------------------------------------------ 名單 */

function readRoster_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('roster');
  if (hit) return JSON.parse(hit);

  var root = findRootFolder_();
  var f = fileInFolder_(root, ROSTER_FILE_NAME);
  var roster = f ? JSON.parse(f.getBlob().getDataAsString('UTF-8')) : { open: false, students: [] };
  if (!roster.students) roster.students = [];
  cache.put('roster', JSON.stringify(roster), CACHE_SECONDS);
  return roster;
}

/**
 * 代碼 -> 學生。open:true 時沒有代碼也放行，記成「訪客」。
 */
function authStudent_(code) {
  var roster = readRoster_();
  var want = String(code || '').trim().toLowerCase();
  for (var i = 0; i < roster.students.length; i++) {
    var s = roster.students[i];
    if (s.disabled) continue;
    if (String(s.code || '').trim().toLowerCase() === want && want !== '') {
      return { name: s.name, grade: s.grade || '', group: s.group || '', code: s.code };
    }
  }
  if (roster.open) {
    return { name: want ? want.slice(0, 20) : '訪客', grade: '', group: '', code: '', guest: true };
  }
  throw new Error('代碼不正確，或這組代碼已經停用。');
}

/** 這位學生能不能做這份考卷（考卷 assign 沒寫 = 全部人都可以） */
function mayTake_(student, meta) {
  var assign = meta && meta.assign;
  if (!assign || !assign.length) return true;
  for (var i = 0; i < assign.length; i++) {
    if (assign[i] === student.name || assign[i] === student.group) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ 考卷 */

function readIndex_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('index');
  if (hit) return JSON.parse(hit);

  var root = findRootFolder_();
  var f = fileInFolder_(root, INDEX_FILE_NAME);
  var list = [];
  if (f) {
    try {
      var parsed = JSON.parse(f.getBlob().getDataAsString('UTF-8'));
      list = Array.isArray(parsed) ? parsed : (parsed.exams || []);
    } catch (err) {
      list = [];
    }
  }
  if (!list.length) list = scanExams_(root);
  cache.put('index', JSON.stringify(list), CACHE_SECONDS);
  return list;
}

/** 索引壞掉或還沒建時的後備：直接掃 考卷/<科目>/*.json */
function scanExams_(root) {
  var out = [];
  var examDir = folderInFolder_(root, EXAM_DIR_NAME);
  if (!examDir) return out;
  var subjects = examDir.getFolders();
  while (subjects.hasNext()) {
    var subject = subjects.next();
    var files = subject.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      if (!/\.json$/i.test(file.getName())) continue;
      out.push({
        id: file.getName().replace(/\.json$/i, ''),
        subject: subject.getName(),
        title: file.getName().replace(/\.json$/i, ''),
        fileId: file.getId(),
        date: Utilities.formatDate(file.getDateCreated(), 'Asia/Taipei', 'yyyy-MM-dd')
      });
    }
  }
  return out;
}

function indexEntry_(examId) {
  var list = readIndex_();
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].id) === String(examId)) return list[i];
  }
  return null;
}

/** 依索引裡的 fileId 或 file 路徑找出考卷檔 */
function examFile_(entry) {
  if (entry.fileId) {
    var byId = tryGetFile_(entry.fileId);
    if (byId) return byId;
  }
  var root = findRootFolder_();
  var path = entry.file || entry.json;
  if (path) {
    var parts = String(path).split('/').filter(function (x) { return x !== ''; });
    var node = root;
    for (var i = 0; i < parts.length - 1; i++) {
      node = folderInFolder_(node, parts[i]);
      if (!node) { node = null; break; }
    }
    if (node) {
      var f = fileInFolder_(node, parts[parts.length - 1]);
      if (f) return f;
    }
  }
  // 最後手段：整個 考卷 資料夾裡找同名檔
  var examDir = folderInFolder_(findRootFolder_(), EXAM_DIR_NAME);
  if (examDir) {
    var subjects = examDir.getFolders();
    while (subjects.hasNext()) {
      var hit = fileInFolder_(subjects.next(), entry.id + '.json');
      if (hit) return hit;
    }
  }
  return null;
}

function loadExam_(examId) {
  var entry = indexEntry_(examId);
  if (!entry) throw new Error('找不到這份考卷（' + examId + '）');
  var file = examFile_(entry);
  if (!file) throw new Error('索引裡有這份考卷，但 Drive 上找不到檔案：' + (entry.file || entry.id));
  var exam = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
  exam.id = exam.id || entry.id;
  exam._entry = entry;
  return exam;
}

/** 送到瀏覽器的版本：拿掉 answer / explain */
function stripAnswers_(exam) {
  var out = {
    id: exam.id,
    title: exam.title || '',
    grade: exam.grade || '',
    subject: exam.subject || '',
    chapter: exam.chapter || '',
    note: exam.note || '',
    sources: exam.sources || [],
    full: fullScore_(exam),
    sections: []
  };
  (exam.sections || []).forEach(function (sec, si) {
    out.sections.push({
      type: sec.type,
      name: sec.name || '',
      points: sec.points || 0,
      questions: (sec.questions || []).map(function (q, qi) {
        return {
          key: si + '-' + qi,
          q: q.q,
          options: sec.type === 'mc' ? (q.options || []) : undefined
        };
      })
    });
  });
  return out;
}

function fullScore_(exam) {
  var total = 0;
  (exam.sections || []).forEach(function (sec) {
    total += (sec.points || 0) * ((sec.questions || []).length);
  });
  return total;
}

/* ------------------------------------------------------------------ 改分 */

/** 填充題比對用：全形轉半形、去空白、統一符號、不分大小寫 */
function normalize_(s) {
  var t = String(s == null ? '' : s);
  t = t.replace(/[！-～]/g, function (ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
  });
  t = t.replace(/　/g, ' ');
  t = t.replace(/[\s,，、$\\]/g, '');
  t = t.replace(/[×✕✖]/g, '*').replace(/[÷]/g, '/').replace(/[－—–]/g, '-');
  t = t.replace(/^\+/, '');
  return t.toLowerCase();
}

function fillCorrect_(given, accepted) {
  var g = normalize_(given);
  if (g === '') return false;
  var list = Array.isArray(accepted) ? accepted : [accepted];
  for (var i = 0; i < list.length; i++) {
    if (normalize_(list[i]) === g) return true;
  }
  return false;
}

function gradeExam_(exam, answers) {
  var items = [];
  var objectiveScore = 0;
  var wrong = [];

  (exam.sections || []).forEach(function (sec, si) {
    (sec.questions || []).forEach(function (q, qi) {
      var key = si + '-' + qi;
      var label = (sec.name || '第' + (si + 1) + '大題') + (qi + 1);
      var given = answers ? answers[key] : null;
      var item = {
        key: key,
        label: label,
        type: sec.type,
        points: sec.points || 0,
        given: given == null ? '' : given,
        explain: q.explain || ''
      };

      if (sec.type === 'mc') {
        var chosen = (given === '' || given == null) ? -1 : Number(given);
        item.correct = chosen === Number(q.answer);
        item.answerText = (q.options || [])[q.answer];
        item.answerIndex = Number(q.answer);
        item.givenText = chosen >= 0 ? (q.options || [])[chosen] : '';
      } else if (sec.type === 'fill') {
        item.correct = fillCorrect_(given, q.answer);
        item.answerText = (Array.isArray(q.answer) ? q.answer[0] : q.answer) || '';
      } else {
        item.correct = null; // 非選：交卷後自評
        item.answerText = q.answer || '';
      }

      if (item.correct === true) objectiveScore += item.points;
      if (item.correct === false) wrong.push(label);
      items.push(item);
    });
  });

  return { items: items, objectiveScore: objectiveScore, wrong: wrong, full: fullScore_(exam) };
}

/* ------------------------------------------------------------ 紀錄試算表 */

function sheet_() {
  var id = props_().getProperty('SHEET_ID');
  if (!id) throw new Error('還沒設定成績表，請先在編輯器執行一次 setup()');
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName(SHEET_TAB) || ss.getSheets()[0];
  if (sh.getLastRow() === 0) {
    sh.appendRow(SHEET_HEADER);
    sh.setFrozenRows(1);
  }
  return sh;
}

function recordAttempt_(student, exam, graded, round) {
  var attemptId = Utilities.getUuid();
  var detail = graded.items.map(function (it) {
    return {
      key: it.key, label: it.label, type: it.type,
      correct: it.correct, given: it.given, answer: it.answerText
    };
  });
  sheet_().appendRow([
    attemptId,
    Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'),
    exam.id,
    exam.subject || '',
    exam.grade || '',
    exam.chapter || '',
    student.name,
    student.code || '',
    round || '首次',
    graded.objectiveScore,
    0,
    graded.objectiveScore,
    graded.full,
    graded.wrong.join('、'),
    JSON.stringify(detail)
  ]);
  return attemptId;
}

function findRow_(attemptId) {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return null;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(attemptId)) return { sheet: sh, row: i + 2 };
  }
  return null;
}

/* ---------------------------------------------------------- 前端呼叫的 API */

function apiLogin(code) {
  var student = authStudent_(code);
  var list = readIndex_().filter(function (m) { return mayTake_(student, m); });
  list.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
  return {
    student: { name: student.name, grade: student.grade, group: student.group },
    exams: list.map(function (m) {
      return {
        id: m.id, title: m.title || m.chapter || m.id, subject: m.subject || '',
        grade: m.grade || '', chapter: m.chapter || '', date: m.date || ''
      };
    })
  };
}

function apiGetExam(code, examId) {
  var student = authStudent_(code);
  var entry = indexEntry_(examId);
  if (!entry) throw new Error('找不到這份考卷（' + examId + '）');
  if (!mayTake_(student, entry)) throw new Error('這份考卷沒有指派給你。');
  var exam = loadExam_(examId);
  return { student: { name: student.name }, exam: stripAnswers_(exam) };
}

function apiSubmit(code, examId, answers, round) {
  var student = authStudent_(code);
  var entry = indexEntry_(examId);
  if (!entry || !mayTake_(student, entry)) throw new Error('這份考卷沒有指派給你。');

  var exam = loadExam_(examId);
  var graded = gradeExam_(exam, answers || {});
  var attemptId = recordAttempt_(student, exam, graded, round || '首次');

  return {
    attemptId: attemptId,
    objectiveScore: graded.objectiveScore,
    full: graded.full,
    wrong: graded.wrong,
    items: graded.items.map(function (it) {
      return {
        key: it.key, label: it.label, type: it.type, points: it.points,
        correct: it.correct, given: it.given, givenText: it.givenText || '',
        answerIndex: it.answerIndex, answerText: it.answerText, explain: it.explain
      };
    })
  };
}

/** 非選題自評分數：{key: 得分} */
function apiRecordOpen(code, attemptId, openScores) {
  authStudent_(code);
  var found = findRow_(attemptId);
  if (!found) throw new Error('找不到這筆作答紀錄。');

  var openTotal = 0;
  Object.keys(openScores || {}).forEach(function (k) {
    openTotal += Number(openScores[k]) || 0;
  });

  var objective = Number(found.sheet.getRange(found.row, 10).getValue()) || 0;
  found.sheet.getRange(found.row, 11).setValue(openTotal);
  found.sheet.getRange(found.row, 12).setValue(objective + openTotal);
  return { total: objective + openTotal };
}

/** 讓 Claude 之後整理錯題本用；也可以直接開試算表看 */
function apiHistory(code) {
  var student = authStudent_(code);
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, SHEET_HEADER.length).getValues();
  return rows.filter(function (r) { return r[6] === student.name; }).map(function (r) {
    return {
      time: r[1], examId: r[2], subject: r[3], chapter: r[5],
      round: r[8], total: r[11], full: r[12], wrong: r[13]
    };
  });
}
