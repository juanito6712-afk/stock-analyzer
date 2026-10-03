"""模擬試題用的圖表產生器：輸出可直接放進題目 q 欄位的 inline SVG 字串。

用法（出題時）：
    import sys; sys.path.insert(0, 'mock-exam/tools')
    from figures import *
    q = "下圖是…？<br>" + line_graph([[(0,0),(4,8)]], xmax=10, ymax=8, xlabel="時間 t(s)", ylabel="速度 v(m/s)")

規則：全部用 currentColor（深淺色模式都看得到）；文字用 text 標籤、不依賴外部字型；
      每張圖輸出前後都要用 render_check.js 截圖看過。
"""
import math

def _t(x, y, s, size=9, anchor="middle", bold=False):
    return '<text x="%s" y="%s" font-size="%s" text-anchor="%s" fill="currentColor"%s>%s</text>' % (
        round(x, 1), round(y, 1), size, anchor, ' font-weight="700"' if bold else '', s)

def _l(x1, y1, x2, y2, extra=''):
    return '<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="currentColor"%s/>' % (round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1), extra)

def _svg(w, h, body):
    return '<svg viewBox="0 0 %d %d" width="%d" xmlns="http://www.w3.org/2000/svg">%s</svg>' % (w, h, w, body)

def _axes(W, H, ox, oy, pw, ph, xmax, ymax, xticks, yticks, xlabel, ylabel, fmt=str):
    xs, ys = pw / xmax, ph / ymax
    s = _l(ox, oy, ox + pw + 8, oy) + _l(ox, oy, ox, oy - ph - 8)
    for t in xticks:
        s += _l(ox + t * xs, oy, ox + t * xs, oy + 3) + _t(ox + t * xs, oy + 13, fmt(t))
    for v in yticks:
        s += _l(ox - 3, oy - v * ys, ox, oy - v * ys) + _t(ox - 6, oy - v * ys + 3, fmt(v), 9, "end")
    s += _t(ox + pw + 4, oy + 25, xlabel, 9, "end") + _t(ox + 4, oy - ph - 12, ylabel, 9, "start")
    return s, xs, ys

def line_graph(series, xmax, ymax, xlabel="", ylabel="", xticks=None, yticks=None, labels=None,
               dashed=None, W=300, H=170, grid=False, dots=False):
    """series: [[(x,y),...], ...]；labels: 每條線的標籤（放在線尾）；dashed: 要畫虛線的線索引集合。"""
    ox, oy, pw, ph = 44, H - 30, W - 44 - 36, H - 30 - 34
    xticks = xticks if xticks is not None else range(0, int(xmax) + 1)
    yticks = yticks if yticks is not None else range(0, int(ymax) + 1)
    s, xs, ys = _axes(W, H, ox, oy, pw, ph, xmax, ymax, xticks, yticks, xlabel, ylabel)
    if grid:
        for t in xticks:
            s += _l(ox + t * xs, oy, ox + t * xs, oy - ph, ' opacity=".12"')
        for v in yticks:
            s += _l(ox, oy - v * ys, ox + pw, oy - v * ys, ' opacity=".12"')
    for i, pts in enumerate(series):
        P = ' '.join('%s,%s' % (round(ox + a * xs, 1), round(oy - b * ys, 1)) for a, b in pts)
        d = ' stroke-dasharray="5 3"' if dashed and i in dashed else ''
        s += '<polyline points="%s" fill="none" stroke="currentColor" stroke-width="2"%s/>' % (P, d)
        if dots:
            for a, b in pts:
                s += '<circle cx="%s" cy="%s" r="2.5" fill="currentColor"/>' % (round(ox + a * xs, 1), round(oy - b * ys, 1))
        if labels:
            a, b = pts[-1]
            s += _t(ox + a * xs + 4, oy - b * ys + 3, labels[i], 11, "start")
    return _svg(W, H, s)

def bar_chart(cats, vals, ymax, ylabel="", yticks=None, W=300, H=170, hi=None):
    """直條圖。hi: 要加粗外框強調的索引集合。"""
    ox, oy, pw, ph = 44, H - 34, W - 44 - 14, H - 34 - 34
    yticks = yticks if yticks is not None else range(0, int(ymax) + 1)
    n = len(cats); slot = pw / n; bw = slot * 0.6
    s = _l(ox, oy, ox + pw, oy) + _l(ox, oy, ox, oy - ph - 8)
    for v in yticks:
        y = oy - v * ph / ymax
        s += _l(ox - 3, y, ox, y) + _t(ox - 6, y + 3, v, 9, "end") + _l(ox, y, ox + pw, y, ' opacity=".12"')
    s += _t(ox + 4, oy - ph - 12, ylabel, 9, "start")
    for i, (c, v) in enumerate(zip(cats, vals)):
        x = ox + slot * i + (slot - bw) / 2; h = v * ph / ymax
        st = ' stroke="currentColor" stroke-width="2"' if hi and i in hi else ''
        s += '<rect x="%s" y="%s" width="%s" height="%s" fill="currentColor" opacity=".7"%s/>' % (round(x, 1), round(oy - h, 1), round(bw, 1), round(h, 1), st)
        s += _t(x + bw / 2, oy + 13, c, 9)
    return _svg(W, H, s)

def climate_chart(temps, rains, tmax=40, rmax=400, title="", W=320, H=190):
    """雨溫圖：12 個月降水量直條（左軸 mm）＋氣溫折線（右軸 °C）。"""
    ox, oy, pw, ph = 44, H - 32, W - 44 - 44, H - 32 - 34
    s = _l(ox, oy, ox + pw, oy) + _l(ox, oy, ox, oy - ph) + _l(ox + pw, oy, ox + pw, oy - ph)
    for k in range(0, 5):
        y = oy - ph * k / 4
        s += _l(ox - 3, y, ox, y) + _t(ox - 6, y + 3, int(rmax * k / 4), 9, "end")
        s += _l(ox + pw, y, ox + pw + 3, y) + _t(ox + pw + 6, y + 3, int(tmax * k / 4), 9, "start")
    s += _t(ox, oy - ph - 8, "降水量(mm)", 9, "start") + _t(ox + pw, oy - ph - 8, "氣溫(°C)", 9, "end")
    slot = pw / 12; pts = []
    for m in range(12):
        x = ox + slot * m + slot * 0.2; h = rains[m] * ph / rmax
        s += '<rect x="%s" y="%s" width="%s" height="%s" fill="currentColor" opacity=".6"/>' % (round(x, 1), round(oy - h, 1), round(slot * 0.6, 1), round(h, 1))
        s += _t(x + slot * 0.3, oy + 12, m + 1, 9)
        pts.append('%s,%s' % (round(x + slot * 0.3, 1), round(oy - temps[m] * ph / tmax, 1)))
    s += '<polyline points="%s" fill="none" stroke="currentColor" stroke-width="2"/>' % ' '.join(pts)
    s += _t(ox + pw / 2, oy + 26, "月份　" + title, 9)
    return _svg(W, H, s)

def pie_chart(parts, W=260, H=170, r=60):
    """parts: [(標籤, 數值), ...]；用圖案區分（currentColor 的不同透明度），並把標籤標在扇形旁。"""
    total = float(sum(v for _, v in parts)); cx, cy = 80, H / 2; a0 = -math.pi / 2; s = ''
    for i, (lab, v) in enumerate(parts):
        a1 = a0 + 2 * math.pi * v / total
        x0, y0, x1, y1 = cx + r * math.cos(a0), cy + r * math.sin(a0), cx + r * math.cos(a1), cy + r * math.sin(a1)
        large = 1 if a1 - a0 > math.pi else 0
        op = 0.15 + 0.7 * (i / max(1, len(parts) - 1))
        s += '<path d="M%s,%s L%s,%s A%s,%s 0 %d 1 %s,%s Z" fill="currentColor" fill-opacity="%.2f" stroke="currentColor"/>' % (
            cx, cy, round(x0, 1), round(y0, 1), r, r, large, round(x1, 1), round(y1, 1), op)
        s += '<rect x="165" y="%d" width="10" height="10" fill="currentColor" fill-opacity="%.2f" stroke="currentColor"/>' % (30 + i * 20, op)
        s += _t(181, 39 + i * 20, "%s %s%%" % (lab, round(v * 100 / total)), 10, "start")
        a0 = a1
    return _svg(W, H, s)

def number_line(lo, hi, marks=None, step=1, W=300, H=60):
    """數線。marks: {值: 標籤}。"""
    ox, pw = 20, W - 40; xs = pw / (hi - lo); s = _l(ox, 30, ox + pw, 30)
    v = lo
    while v <= hi + 1e-9:
        s += _l(ox + (v - lo) * xs, 26, ox + (v - lo) * xs, 34) + _t(ox + (v - lo) * xs, 48, v)
        v += step
    for v, lab in (marks or {}).items():
        s += '<circle cx="%s" cy="30" r="4" fill="currentColor"/>' % round(ox + (v - lo) * xs, 1) + _t(ox + (v - lo) * xs, 18, lab, 11)
    return _svg(W, H, s)

def tape(dots_cm, label="", unit="cm", W=300):
    """打點計時器紙帶：dots_cm 為各點位置（cm）。"""
    sc = (W - 50) / float(max(dots_cm)); s = '<rect x="20" y="12" width="%d" height="22" fill="none" stroke="currentColor"/>' % (W - 30)
    for p in dots_cm:
        x = 30 + p * sc
        s += '<circle cx="%s" cy="23" r="2.6" fill="currentColor"/>' % round(x, 1) + _t(x, 50, p, 9)
    s += _t(W / 2, 70, "各點位置（單位：%s）%s" % (unit, label), 9)
    return _svg(W, 80, s)

def circuit_series(parts, W=300, H=110):
    """簡易串聯電路示意：parts 為元件字串串列，例如 ["電池 6V","R₁ 2Ω","R₂ 4Ω"]（方框＋文字）。"""
    n = len(parts); bw = (W - 40) / n; s = _l(20, 20, W - 20, 20) + _l(20, 20, 20, 90) + _l(W - 20, 20, W - 20, 90) + _l(20, 90, W - 20, 90)
    for i, p in enumerate(parts):
        x = 20 + bw * i + bw * 0.1
        s += '<rect x="%s" y="8" width="%s" height="24" fill="var(--card,#fff)" stroke="currentColor"/>' % (round(x, 1), round(bw * 0.8, 1))
        s += _t(x + bw * 0.4, 24, p, 10)
    return _svg(W, H, s)

def force_diagram(forces, W=260, H=190, label="物體"):
    """受力圖：forces = [(方向, 標籤)]，方向為 'up','down','left','right'；箭頭由方塊中心向外。"""
    cx, cy = W / 2, H / 2
    s = '<rect x="%s" y="%s" width="50" height="40" fill="none" stroke="currentColor"/>' % (cx - 25, cy - 20) + _t(cx, cy + 4, label, 10)
    d = {'up': (0, -1), 'down': (0, 1), 'left': (-1, 0), 'right': (1, 0)}
    for dirn, lab in forces:
        dx, dy = d[dirn]
        x0, y0 = cx + dx * (25 if dx else 0), cy + dy * (20 if dy else 0)
        x1, y1 = cx + dx * 80, cy + dy * 70
        s += _l(x0, y0, x1, y1, ' stroke-width="2"')
        ax, ay = -dy, dx
        s += '<polygon points="%s,%s %s,%s %s,%s" fill="currentColor"/>' % (
            round(x1, 1), round(y1, 1), round(x1 - dx * 8 + ax * 4, 1), round(y1 - dy * 8 + ay * 4, 1), round(x1 - dx * 8 - ax * 4, 1), round(y1 - dy * 8 - ay * 4, 1))
        s += _t(x1 + (dx * 6 if dx else 0) + (28 if dy else 0) * (1 if dy else 0) * 0 + (0 if dx else 18), y1 + (12 if dy > 0 else (-6 if dy < 0 else -8)), lab, 10, "start" if dx >= 0 else "end")
    return _svg(W, H, s)
