"""렌더 결과를 index.html 의 캐릭터 항목으로 심는다.

카드 수·프레임 수·길이는 전부 `sheets.json` 에서 읽는다. 손으로 적으면
클립을 고칠 때마다 페이지가 조용히 거짓말을 한다.
"""
import base64
import io
import json
import os
import re

from PIL import Image

from lib import repo
from spec import PAGE_ORDER

BAND_VIEWS = ["front", "q34", "side", "back"]
NS = 15


def _b64_jpeg(im, q=86):
    if im.mode != "RGB":
        im = im.convert("RGB")
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=q, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def _need(path):
    if not os.path.exists(path):
        raise RuntimeError("missing render output: %s" % path)
    return path


def _check_fresh(spec, rd):
    """소스 .blend 보다 오래된 렌더로 페이지를 만들지 못하게 막는다.

    렌더를 백그라운드로 돌려 놓고 '파일 개수'로 완료를 기다렸다가, 직전
    실행이 남긴 파일 때문에 조건이 즉시 참이 되어 옛날 이미지로 페이지를
    만든 적이 있다. 개수가 아니라 시각으로 판정한다.
    """
    blend = repo(spec["blend"])
    if not os.path.exists(blend):
        raise RuntimeError("missing %s" % blend)
    bt = os.path.getmtime(blend)
    stale = [f for f in os.listdir(rd)
             if f.endswith(".png") and os.path.getmtime(os.path.join(rd, f)) < bt]
    if stale:
        raise RuntimeError("render output is older than the .blend "
                           "(%d files, e.g. %s) — re-render first"
                           % (len(stale), sorted(stale)[0]))


def _cut_block(src, marker):
    """`marker` 로 시작하는 <div> 블록을 통째로 잘라낸다."""
    m = re.search(re.escape(marker), src)
    if not m:
        return src, False
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
        raise RuntimeError("unbalanced block for %r — refusing to edit" % marker)
    return src[:i] + src[j:], True


def _block_end(src, marker):
    m = re.search(re.escape(marker), src)
    if not m:
        raise RuntimeError("anchor not found: %r" % marker)
    depth, j = 0, m.start()
    while j < len(src):
        if src.startswith("<div", j):
            depth += 1
        elif src.startswith("</div>", j):
            depth -= 1
            if depth == 0:
                return j + 6
        j += 1
    raise RuntimeError("unbalanced anchor block %r" % marker)


def _neighbours(code, src):
    """정규 순서에서 이 캐릭터의 앞/뒤 이웃 중 페이지에 실제로 있는 것."""
    if code not in PAGE_ORDER:
        raise RuntimeError("%s not in PAGE_ORDER" % code)
    i = PAGE_ORDER.index(code)
    prev = next((c for c in reversed(PAGE_ORDER[:i])
                 if 'data-char="%s"' % c in src), None)
    nxt = next((c for c in PAGE_ORDER[i + 1:]
                if 'data-go="%s"' % c in src), None)
    return prev, nxt


def run(spec, after=None, page=None):
    """정규 순서(spec.PAGE_ORDER)에 맞는 자리에 이 캐릭터 블록을 넣는다."""
    code = spec["code"]
    rd = repo(spec["render_dir"])
    page = page or repo("index.html")
    _check_fresh(spec, rd)

    tiles = [Image.open(_need(os.path.join(rd, "view_%s.png" % v))) for v in BAND_VIEWS]
    w, h = tiles[0].size
    band = Image.new("RGB", (w * len(tiles), h), (14, 14, 16))
    for i, t in enumerate(tiles):
        band.paste(t.convert("RGB"), (i * w, 0))
    BAND = _b64_jpeg(band, 88)

    meta = json.load(open(_need(os.path.join(rd, "sheets.json"))))
    if len(meta) != len(spec["clips"]):
        raise RuntimeError("sheets.json has %d clips, spec has %d"
                           % (len(meta), len(spec["clips"])))
    cards = []
    for m in meta:
        act = m["action"]
        frames = [Image.open(_need(os.path.join(rd, "sheet_%s_%02d.png" % (act, i))))
                  for i in range(NS)]
        fw, fh = frames[0].size
        sheet = Image.new("RGB", (fw * NS, fh), (14, 14, 16))
        for i, fr in enumerate(frames):
            sheet.paste(fr.convert("RGB"), (i * fw, 0))
        cards.append({"act": act, "n": m["nframes"], "loop": m["loop"],
                      "dur": m["dur"], "img": _b64_jpeg(sheet, 82)})

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

    detail = (
        '<div class="detail" data-char="%s"><button class="back">&larr; 목록</button>'
        '<div class="dhead"><span class="eid">%s</span><h2>%s</h2>'
        '<span class="tail">%s</span></div>'
        '<div class="band"><img src="%s" alt="%s 4면도"></div>'
        '<div class="cap">정면 · 3/4 · 측면 · 후면</div>'
        '<div class="anims"><div class="ahead"><h3>애니메이션 %d종</h3>'
        '<div class="transport"><button class="t" data-play aria-pressed="true">■ 일시정지</button>'
        '<div class="seg"><button class="t" data-rate="0.25">0.25×</button>'
        '<button class="t" data-rate="0.5">0.5×</button>'
        '<button class="t" data-rate="1" aria-pressed="true">1×</button>'
        '<button class="t" data-rate="2">2×</button></div></div></div>'
        '<div class="grid">%s</div></div></div>'
        % (code, spec["id"], spec["name"], spec["tail"], BAND, spec["name"],
           len(cards), card_html))

    entry = ('<button class="entry" data-go="%s"><span class="eid">%s</span>'
             '<span class="ename">%s</span><span class="emeta">%s</span>'
             '<span class="arrow">&rarr;</span></button>'
             % (code, spec["id"], spec["name"],
                spec["entry_meta"].format(nclips=len(cards))))

    src = open(page, encoding="utf-8").read()
    # 재실행 가능해야 한다 — 기존 항목을 통째로 걷어내고 다시 넣는다.
    src = re.sub(r'<button class="entry" data-go="%s">.*?</button>' % code, "",
                 src, flags=re.S)
    src, _ = _cut_block(src, '<div class="detail" data-char="%s">' % code)

    prev, nxt = _neighbours(code, src)
    # 엔트리는 '다음 캐릭터' 앞에 넣는다. 다음 캐릭터가 없으면 **캐릭터가 아닌
    # 첫 항목**(아이템·지도) 앞이 마지막 자리다. 예전처럼 무조건 map 앞에 넣으면
    # 아이템 섹션 **뒤로** 밀려 캐릭터 묶음이 끊긴다 — 상세 블록은 앞 캐릭터
    # 뒤에 붙으므로 목록과 상세의 순서가 서로 어긋나기까지 한다(실측).
    if nxt:
        anchor = '<button class="entry" data-go="%s">' % nxt
    else:
        codes = re.findall(r'<button class="entry" data-go="([a-z]+)">', src)
        tail = [c for c in codes if c not in PAGE_ORDER]
        if not tail:
            raise RuntimeError("no non-character entry to anchor %s before" % code)
        anchor = '<button class="entry" data-go="%s">' % tail[0]
    if anchor not in src:
        raise RuntimeError("entry anchor not found: %r" % anchor)
    src = src.replace(anchor, entry + "\n" + anchor, 1)

    # 상세 블록은 '앞 캐릭터' 블록 끝에 붙인다.
    ref = after or prev
    if ref is None:
        raise RuntimeError("no preceding detail block for %s" % code)
    j = _block_end(src, '<div class="detail" data-char="%s">' % ref)
    src = src[:j] + "\n" + detail + src[j:]

    open(page, "w", encoding="utf-8").write(src)
    print("PAGE OK %s  cards=%d loop=%d  band=%dx%d  html=%.1f KB"
          % (code, len(cards), sum(1 for c in cards if c["loop"]),
             band.size[0], band.size[1], len(src) / 1024.0))
