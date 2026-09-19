/**
 * Telegram -> Cloudflare Worker -> GitHub Actions (Claude Code) 家教出題機器人
 *
 * Worker 只做三件事，全部在幾百毫秒內完成：
 *   1. 驗證請求真的來自 Telegram（secret token header）
 *   2. 比對白名單，決定這個人可不可以用
 *   3. 秒回一則「收到」，然後把題目需求丟給 GitHub Actions 去跑 Claude
 *
 * 真正呼叫 Claude 的地方在 .github/workflows/telegram-tutor.yml，
 * 因為訂閱版的 OAuth token 只有官方 Claude Code CLI 能合法使用。
 */

const TELEGRAM_API = 'https://api.telegram.org/bot';

// Telegram 會重送舊訊息，超過這個秒數的一律忽略，避免半夜被灌爆
const MAX_MESSAGE_AGE_SECONDS = 300;

// 單則提問長度上限，避免有人貼一整本課本進來
const MAX_PROMPT_LENGTH = 1000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response('ok', { status: 200 });
    }

    if (request.method !== 'POST') {
      return new Response('method not allowed', { status: 405 });
    }

    // Telegram 設定 webhook 時帶的密碼，沒對上就不是 Telegram 打來的
    const presented = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (!env.TELEGRAM_WEBHOOK_SECRET || presented !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response('forbidden', { status: 403 });
    }

    let update;
    try {
      update = await request.json();
    } catch (err) {
      // 壞掉的 payload 也回 200，否則 Telegram 會一直重送
      return new Response('ok', { status: 200 });
    }

    // 背景處理，先把 200 還給 Telegram
    ctx.waitUntil(handleUpdate(update, env));
    return new Response('ok', { status: 200 });
  },
};

async function handleUpdate(update, env) {
  const message = update.message || update.edited_message;
  if (!message || typeof message.text !== 'string') return;

  const chatId = message.chat && message.chat.id;
  const fromId = message.from && message.from.id;
  const text = message.text.trim();
  if (!chatId || !text) return;

  const ageSeconds = Math.floor(Date.now() / 1000) - (message.date || 0);
  if (ageSeconds > MAX_MESSAGE_AGE_SECONDS) {
    console.log('skipping stale message', { chatId, ageSeconds });
    return;
  }

  // /id 不需要授權，這樣才有辦法把新的人加進白名單
  if (text === '/id' || text.startsWith('/id@')) {
    await sendMessage(env, chatId,
      '你的 Telegram ID 是：' + fromId + '\n這個聊天室的 ID 是：' + chatId +
      '\n\n把這組數字給管理者加進白名單就能開始用了。');
    return;
  }

  if (!isAllowed(env, fromId, chatId)) {
    console.log('rejected unauthorized sender', { fromId, chatId });
    await sendMessage(env, chatId,
      '這個機器人只開放給指定的人使用 🙏\n你的 ID 是 ' + fromId + '，請把它給管理者加入白名單。');
    return;
  }

  if (text === '/start' || text === '/help' || text.startsWith('/help@') || text.startsWith('/start@')) {
    await sendMessage(env, chatId, helpText());
    return;
  }

  // 其他還沒實作的指令，不要當成出題需求送出去
  if (text.startsWith('/')) {
    await sendMessage(env, chatId, '我不認得這個指令 🤔\n\n' + helpText());
    return;
  }

  if (text.length > MAX_PROMPT_LENGTH) {
    await sendMessage(env, chatId,
      '訊息太長了（' + text.length + ' 字，上限 ' + MAX_PROMPT_LENGTH + ' 字）。\n請把需求說得精簡一點，例如「國二理化 浮力 出 5 題」。');
    return;
  }

  const dispatched = await dispatchToGitHub(env, {
    chat_id: String(chatId),
    text,
    message_id: String(message.message_id || ''),
    requested_by: String(fromId || ''),
  });

  if (dispatched) {
    await sendMessage(env, chatId, '收到！正在出題中，大約 1 分鐘後給你 ✏️');
  } else {
    await sendMessage(env, chatId, '糟糕，出題系統沒有回應，請稍後再試一次 😥');
  }
}

function helpText() {
  return [
    '我是出題小幫手 ✏️',
    '',
    '直接跟我說你想練什麼就好，例如：',
    '• 國二數學 一元二次方程式 出 5 題',
    '• 幫我出 10 題英文單字填空，國中程度',
    '• 小六自然 光的折射 出 3 題應用題',
    '',
    '我會先傳題目，等你寫完再傳解答過去。',
    '',
    '指令：/help 說明　/id 查自己的 ID',
  ].join('\n');
}

function isAllowed(env, fromId, chatId) {
  const raw = env.ALLOWED_CHAT_IDS || '';
  const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return false; // 沒設白名單時一律拒絕，比放行安全
  return allowed.includes(String(fromId)) || allowed.includes(String(chatId));
}

async function dispatchToGitHub(env, clientPayload) {
  const endpoint = 'https://api.github.com/repos/' + env.GITHUB_REPO + '/dispatches';
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.GITHUB_TOKEN,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'telegram-tutor-worker',
      },
      body: JSON.stringify({
        event_type: 'telegram-question',
        client_payload: clientPayload,
      }),
    });

    if (res.status !== 204) {
      console.log('github dispatch failed', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.log('github dispatch threw', String(err));
    return false;
  }
}

async function sendMessage(env, chatId, text) {
  try {
    const res = await fetch(TELEGRAM_API + env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) console.log('sendMessage failed', res.status, await res.text());
  } catch (err) {
    console.log('sendMessage threw', String(err));
  }
}
