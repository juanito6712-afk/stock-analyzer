#!/usr/bin/env python3
"""把 Claude 出好的題目回傳到 Telegram。

題目和解答會分成兩則訊息送出，讓孩子先自己寫完再看答案。
Claude 被要求用一行 `---解答---` 隔開兩段，找不到分隔線就整份送出。

用法:
    python scripts/send_telegram.py --chat-id 123456 --file reply.txt
    python scripts/send_telegram.py --chat-id 123456 --text "臨時訊息"

需要環境變數 TELEGRAM_BOT_TOKEN。
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

API_BASE = "https://api.telegram.org/bot"

# Telegram 單則上限是 4096 字元，留一點餘裕給標題
CHUNK_LIMIT = 3500

ANSWER_SEPARATOR = re.compile(r"^\s*-{2,}\s*解答\s*-{2,}\s*$", re.MULTILINE)


def split_questions_and_answers(text):
    """回傳 (題目, 解答)；沒有分隔線時解答為 None。"""
    parts = ANSWER_SEPARATOR.split(text, maxsplit=1)
    if len(parts) == 2:
        questions, answers = parts[0].strip(), parts[1].strip()
        if questions and answers:
            return questions, answers
    return text.strip(), None


def chunk(text, limit=CHUNK_LIMIT):
    """盡量在換行處切開，切不動再硬切。"""
    chunks = []
    remaining = text
    while len(remaining) > limit:
        window = remaining[:limit]
        cut = window.rfind("\n\n")
        if cut < limit // 2:
            cut = window.rfind("\n")
        if cut < limit // 2:
            cut = limit
        chunks.append(remaining[:cut].rstrip())
        remaining = remaining[cut:].lstrip("\n")
    if remaining.strip():
        chunks.append(remaining.strip())
    return chunks


def send_message(token, chat_id, text, attempts=3):
    payload = json.dumps({
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": True,
    }).encode("utf-8")

    last_error = None
    for attempt in range(attempts):
        request = urllib.request.Request(
            API_BASE + token + "/sendMessage",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                response.read()
                return True
        except urllib.error.HTTPError as err:
            body = err.read().decode("utf-8", "replace")
            last_error = "HTTP {}: {}".format(err.code, body)
            # 429 要等 Telegram 指定的秒數再試
            if err.code == 429:
                try:
                    retry_after = json.loads(body)["parameters"]["retry_after"]
                except (ValueError, KeyError, TypeError):
                    retry_after = 2 ** attempt
                time.sleep(retry_after)
                continue
            if err.code < 500:
                break
        except (urllib.error.URLError, OSError) as err:
            last_error = str(err)
        time.sleep(2 ** attempt)

    print("送出 Telegram 訊息失敗: {}".format(last_error), file=sys.stderr)
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chat-id", required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--file", help="包含 Claude 回覆的檔案")
    group.add_argument("--text", help="直接指定要送出的文字")
    parser.add_argument("--raw", action="store_true",
                        help="不要拆題目/解答，整份原樣送出")
    args = parser.parse_args()

    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        print("缺少環境變數 TELEGRAM_BOT_TOKEN", file=sys.stderr)
        return 1

    if args.text is not None:
        body = args.text
    else:
        try:
            with open(args.file, "r", encoding="utf-8") as handle:
                body = handle.read()
        except OSError as err:
            print("讀不到檔案 {}: {}".format(args.file, err), file=sys.stderr)
            return 1

    if not body.strip():
        send_message(token, args.chat_id, "出題系統這次沒有產生內容，請再試一次 😥")
        return 1

    if args.raw:
        messages = chunk(body.strip())
    else:
        questions, answers = split_questions_and_answers(body)
        messages = chunk(questions)
        if answers:
            answer_chunks = chunk(answers)
            answer_chunks[0] = "📝 解答（寫完再看喔）\n\n" + answer_chunks[0]
            messages.extend(answer_chunks)

    ok = True
    for message in messages:
        if not send_message(token, args.chat_id, message):
            ok = False
        time.sleep(0.5)  # 避免觸發 Telegram 的速率限制
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
