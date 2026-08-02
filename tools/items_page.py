"""ITM 소품 렌더 → index.html 의 '픽업 소품' 항목.

실행:  python3 tools/items_page.py [render/_items] [index.html]

캐릭터용 lib/page.py 를 쓰지 않는 이유
  그쪽은 클립 카드(스프라이트 시트 · 루프 · 길이)를 전제한다. 소품은
  애니메이션이 없어 그 구조가 통째로 비어 버린다. 여기서는 4면도 띠 하나와
  치수 한 줄이면 충분하다. 대신 CSS 클래스는 기존 것(.band .cap .dhead)을
  그대로 써서 페이지가 두 벌로 갈리지 않게 한다.

재실행 가능해야 한다 — 기존 항목을 걷어내고 다시 넣는다.
"""
import base64
import io
import json
import os
import re
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
RD = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "render", "_items")
PAGE = sys.argv[2] if len(sys.argv) > 2 else os.path.join(REPO, "index.html")

CODE = "itm"
VIEWS = ["front", "q34", "side", "back"]
LABEL = {
    "ITM04_Card": ("ITM-04", "교통카드", "개찰구 통과 · 시작 상시 소지"),
    "ITM06_Mask": ("ITM-06", "마스크", "인파 밀림 저항 +50%"),
    "ITM06_MaskFolded": ("ITM-06B", "마스크 (접힌 상태)", "편의점 매대 진열용"),
    "ITM09_Umbrella": ("ITM-09", "우산 (접힌 상태)", "우산꽂이 · 인파 비켜세우기"),
    "ITM09_UmbrellaOpen": ("ITM-09B", "우산 (펼친 상태)", "접힌 우산과 같은 제품"),
}
ORDER = ["ITM04_Card", "ITM06_Mask", "ITM06_MaskFolded",
         "ITM09_Umbrella", "ITM09_UmbrellaOpen"]


def _need(path):
    if not os.path.exists(path):
        raise RuntimeError("missing render output: %s" % path)
    return path


def _b64_jpeg(im, q=88):
    if im.mode != "RGB":
        im = im.convert("RGB")
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=q, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def _check_fresh(meta_path):
    """소스 .blend 보다 오래된 렌더로 페이지를 만들지 못하게 막는다."""
    blend = os.path.join(REPO, "assets", "items.blend")
    if not os.path.exists(blend):
        raise RuntimeError("missing %s" % blend)
    bt = os.path.getmtime(blend)
    stale = [f for f in os.listdir(RD)
             if f.endswith(".png") and os.path.getmtime(os.path.join(RD, f)) < bt]
    if stale:
        raise RuntimeError("render output is older than items.blend "
                           "(%d files, e.g. %s) — re-render first"
                           % (len(stale), sorted(stale)[0]))


def _cut_block(src, marker):
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


def main():
    meta = json.load(open(_need(os.path.join(RD, "items.json")), encoding="utf-8"))
    _check_fresh(meta)
    missing = [k for k in ORDER if k not in meta]
    if missing:
        raise RuntimeError("render is missing items: %s" % missing)
    extra = [k for k in meta if k not in ORDER]
    if extra:
        raise RuntimeError("render has unknown items: %s (LABEL/ORDER 갱신 필요)" % extra)

    blocks = []
    total = 0
    for name in ORDER:
        tiles = [Image.open(_need(os.path.join(RD, "%s_%s.png" % (name, v))))
                 for v in VIEWS]
        w, h = tiles[0].size
        band = Image.new("RGB", (w * len(tiles), h), (14, 14, 16))
        for i, t in enumerate(tiles):
            band.paste(t.convert("RGB"), (i * w, 0))
        eid, nm, note = LABEL[name]
        m = meta[name]
        total += m["tris"]
        dim = " × ".join("%.0f" % (v * 1000) for v in m["dim_m"])
        blocks.append(
            '<div class="band"><img src="%s" alt="%s 4면도"></div>'
            '<div class="cap">%s · %s — %s · %s tris · %s mm</div>'
            % (_b64_jpeg(band), nm, eid, nm, note,
               format(m["tris"], ","), dim))

    detail = (
        '<div class="detail" data-char="%s"><button class="back">&larr; 목록</button>'
        '<div class="dhead"><span class="eid">ITM</span><h2>픽업 소품</h2>'
        '<span class="tail">정적 메시 · %d종 · 합계 %s tris</span></div>'
        '%s</div>'
        % (CODE, len(ORDER), format(total, ","), "".join(blocks)))

    entry = ('<button class="entry" data-go="%s"><span class="eid">ITM</span>'
             '<span class="ename">픽업 소품</span>'
             '<span class="emeta">정적 메시 %d종</span>'
             '<span class="arrow">&rarr;</span></button>' % (CODE, len(ORDER)))

    src = open(PAGE, encoding="utf-8").read()
    src = re.sub(r'<button class="entry" data-go="%s">.*?</button>' % CODE, "",
                 src, flags=re.S)
    src, _ = _cut_block(src, '<div class="detail" data-char="%s">' % CODE)

    anchor = '<button class="entry" data-go="map">'
    if anchor not in src:
        raise RuntimeError("entry anchor not found: %r" % anchor)
    src = src.replace(anchor, entry + "\n" + anchor, 1)

    # 마지막 캐릭터 블록 뒤에 붙인다.
    last = None
    for c in ("ss", "cp", "zp", "aj", "gp", "mc"):
        if 'data-char="%s"' % c in src:
            last = c
            break
    if last is None:
        raise RuntimeError("no character detail block to anchor to")
    j = _block_end(src, '<div class="detail" data-char="%s">' % last)
    src = src[:j] + "\n" + detail + src[j:]

    open(PAGE, "w", encoding="utf-8").write(src)
    print("ITEMS_PAGE OK  %d종 · 합계 %s tris · html %.1f KB (앵커: %s 뒤)"
          % (len(ORDER), format(total, ","), len(src) / 1024.0, last))


main()
