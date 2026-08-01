"""render/_ss 결과를 index.html 의 ACT-08 항목으로 심는다.

  python3 tools/ss_page.py

카드 수·프레임 수·길이는 전부 render/_ss/sheets.json 에서 읽는다.
손으로 적으면 클립을 고칠 때마다 페이지가 조용히 거짓말을 한다.
"""
import json, os, base64, io, re, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RD = os.path.join(ROOT, "render", "_ss")
PAGE = os.path.join(ROOT, "index.html")
BAND_VIEWS = ["front", "q34", "side", "back"]
NS = 15


def b64_jpeg(im, q=86):
    if im.mode != "RGB":
        im = im.convert("RGB")
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=q, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def need(path):
    if not os.path.exists(path):
        raise RuntimeError("missing render output: %s" % path)
    return path


def check_fresh():
    """소스 .blend 보다 오래된 렌더로 페이지를 만들지 못하게 막는다.

    렌더를 백그라운드로 돌려 놓고 '파일 개수'로 완료를 기다렸다가, 직전 실행이
    남긴 파일 때문에 조건이 즉시 참이 되어 옛날 이미지로 페이지를 만든 적이 있다.
    개수가 아니라 시각으로 판정한다.
    """
    blend = os.path.join(ROOT, "assets", "ss_character.blend")
    if not os.path.exists(blend):
        raise RuntimeError("missing %s" % blend)
    bt = os.path.getmtime(blend)
    stale = [f for f in os.listdir(RD)
             if f.endswith(".png") and os.path.getmtime(os.path.join(RD, f)) < bt]
    if stale:
        raise RuntimeError("render output is older than the .blend (%d files, e.g. %s) "
                           "— re-run tools/ss_render.py first"
                           % (len(stale), sorted(stale)[0]))


check_fresh()


# ------------------------------------------------------------------ 4면도
tiles = [Image.open(need(os.path.join(RD, "view_%s.png" % v))) for v in BAND_VIEWS]
w, h = tiles[0].size
band = Image.new("RGB", (w * len(tiles), h), (14, 14, 16))
for i, t in enumerate(tiles):
    band.paste(t.convert("RGB"), (i * w, 0))
BAND = b64_jpeg(band, 88)

# ------------------------------------------------------------ 스프라이트 시트
meta = json.load(open(need(os.path.join(RD, "sheets.json"))))
if len(meta) != 15:
    raise RuntimeError("expected 15 clips in sheets.json, got %d" % len(meta))
cards = []
for m in meta:
    act = m["action"]
    frames = [Image.open(need(os.path.join(RD, "sheet_%s_%02d.png" % (act, i))))
              for i in range(NS)]
    fw, fh = frames[0].size
    sheet = Image.new("RGB", (fw * NS, fh), (14, 14, 16))
    for i, fr in enumerate(frames):
        sheet.paste(fr.convert("RGB"), (i * fw, 0))
    cards.append({"act": act, "n": m["nframes"], "loop": m["loop"],
                  "dur": m["dur"], "img": b64_jpeg(sheet, 82)})

# ------------------------------------------------------------------- 마크업
LOOPN = sum(1 for c in cards if c["loop"])
card_html = "".join(
    '<article class="card" data-n="%d" data-dur="%.2f" data-loop="%d">'
    '<div class="view"><div class="sprite" style="background-image:url(&quot;%s&quot;);'
    'background-size:%d%% 100%%"></div>'
    '<span class="fno">01 / %d</span><span class="paused">정지</span></div>'
    '<div class="cmeta"><div class="crow"><span class="cname">%s</span>'
    '<span class="tag%s">%s</span></div>'
    '<div class="cstat"><span><b>%d</b>f</span><span><b>%.2f</b>s</span></div>'
    '<input type="range" min="0" max="%d" value="0" step="1" aria-label="%s 프레임">'
    '</div></article>'
    % (NS, c["dur"], 1 if c["loop"] else 0, c["img"], NS * 100, NS,
       c["act"], " on" if c["loop"] else "", "LOOP" if c["loop"] else "ONCE",
       c["n"] - 1, c["dur"], NS - 1, c["act"])
    for c in cards)

DETAIL = (
    '<div class="detail" data-char="ss"><button class="back">&larr; 목록</button>'
    '<div class="dhead"><span class="eid">ACT-08</span><h2>역무원</h2>'
    '<span class="tail">순찰 액터 · Z3 개찰구 · 30 fps</span></div>'
    '<div class="band"><img src="%s" alt="역무원 4면도"></div>'
    '<div class="cap">정면 · 3/4 · 측면 · 후면</div>'
    '<div class="anims"><div class="ahead"><h3>애니메이션 %d종</h3>'
    '<div class="transport"><button class="t" data-play aria-pressed="true">■ 일시정지</button>'
    '<div class="seg"><button class="t" data-rate="0.25">0.25×</button>'
    '<button class="t" data-rate="0.5">0.5×</button>'
    '<button class="t" data-rate="1" aria-pressed="true">1×</button>'
    '<button class="t" data-rate="2">2×</button></div></div></div>'
    '<div class="grid">%s</div></div></div>'
    % (BAND, len(cards), card_html))

ENTRY = ('<button class="entry" data-go="ss"><span class="eid">ACT-08</span>'
         '<span class="ename">역무원</span>'
         '<span class="emeta">테이저 · 무전 · 애니메이션 %d종</span>'
         '<span class="arrow">&rarr;</span></button>' % len(cards))

src = open(PAGE, encoding="utf-8").read()

# 이미 심어 둔 ACT-08 은 통째로 걷어낸다 (재실행 가능해야 한다)
src = re.sub(r'<button class="entry" data-go="ss">.*?</button>', "", src, flags=re.S)
old = re.search(r'<div class="detail" data-char="ss">', src)
if old:
    i = old.start()
    depth, j = 0, i
    while j < len(src):
        if src.startswith("<div", j):
            depth += 1
        elif src.startswith("</div>", j):
            depth -= 1
            if depth == 0:
                j += 6
                break
        j += 1
    src = src[:i] + src[j:]

anchor_entry = '<button class="entry" data-go="map">'
if anchor_entry not in src:
    raise RuntimeError("entry list anchor not found in index.html")
src = src.replace(anchor_entry, ENTRY + "\n" + anchor_entry, 1)

m = re.search(r'<div class="detail" data-char="cp">', src)
if not m:
    raise RuntimeError("cp detail block not found in index.html")
i = m.start()
depth, j = 0, i
while j < len(src):
    if src.startswith("<div", j):
        depth += 1
    elif src.startswith("</div>", j):
        depth -= 1
        if depth == 0:
            j += 6
            break
    j += 1
if depth != 0:
    raise RuntimeError("cp detail block is unbalanced — refusing to edit")
src = src[:j] + "\n" + DETAIL + src[j:]

open(PAGE, "w", encoding="utf-8").write(src)
print("SS_PAGE OK  cards=%d loop=%d  band=%dx%d  html=%.1f KB"
      % (len(cards), LOOPN, band.size[0], band.size[1], len(src) / 1024.0))
