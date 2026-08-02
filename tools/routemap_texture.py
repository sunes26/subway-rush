"""ITM-13 노선도 텍스처 — 수도권 전철 전 노선망 (공식 도식 좌표).

실행:  python3 tools/routemap_texture.py [out.png] [--no-names]

데이터
  assets/data/seoul_rail.csv — routemap_data.py 가 서울교통공사 사이버스테이션
  getLineData.do 에서 뽑는다. 점 1,195개 · 역 800개 · 노선 24개.

왜 추정이 없는가
  선 모양·역 순서·환승 표시·역명 붙일 방향이 전부 원본에 있다.
  노선마다 점이 순서대로 늘어서 있고, 이름 없는 점은 노선이 꺾이는 자리다.
  그대로 이으면 공식 노선도의 선 모양이 나온다 — 실제로 없는 교차가
  생길 수 없고, 역 순서를 지어낼 일도 없다.

  서울교통공사가 발행한 노선도 **이미지 파일**은 굽지 않는다. 좌표·역명·
  환승 관계는 사실이라 그것만 가져와 여기서 새로 그린다.

라벨
  data-labelPos 가 방향(N/S/E/W/NE/…)을 준다. 공식 도판이 겹치지 않게
  정해 둔 값이라 그대로 따른다.
"""
import csv
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
NAMES = "--no-names" not in sys.argv
CSV = os.path.join(REPO, "assets", "data", "seoul_rail.csv")
OUT = ARGS[0] if ARGS else os.path.join(REPO, "assets", "tex", "itm13_routemap.png")

W, H = 2048, 1344            # 원본 좌표계가 298×193 가로형이다
PAPER = (247, 246, 242)
INK = (46, 50, 56)
MARGIN = 46
TOP = 128

FONT_PATHS = ("/System/Library/Fonts/AppleSDGothicNeo.ttc",
              "/System/Library/Fonts/Supplemental/AppleGothic.ttf")

# data-labelPos → (dx, dy, 가로정렬, 세로정렬) 배수
DIRS = {
    "N": (0, -1, "c", "b"), "S": (0, 1, "c", "t"),
    "E": (1, 0, "l", "m"), "W": (-1, 0, "r", "m"),
    "NE": (1, -1, "l", "b"), "NW": (-1, -1, "r", "b"),
    "SE": (1, 1, "l", "t"), "SW": (-1, 1, "r", "t"),
}


def _font(px, bold=True):
    for p in FONT_PATHS:
        try:
            return ImageFont.truetype(p, px, index=1 if (bold and p.endswith(".ttc")) else 0)
        except Exception:
            continue
    raise RuntimeError("한글 폰트를 찾지 못했다")


def main():
    rows = list(csv.DictReader(open(CSV, encoding="utf-8")))
    if not rows:
        raise RuntimeError("데이터가 비었다: %s" % CSV)
    for r in rows:
        r["x"], r["y"], r["seq"] = float(r["x"]), float(r["y"]), int(r["seq"])

    xs = [r["x"] for r in rows]
    ys = [r["y"] for r in rows]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    aw, ah = W - 2 * MARGIN, H - TOP - MARGIN
    sc = min(aw / (x1 - x0), ah / (y1 - y0))
    ox = MARGIN + (aw - (x1 - x0) * sc) / 2.0
    oy = TOP + (ah - (y1 - y0) * sc) / 2.0

    def px(r):
        return (ox + (r["x"] - x0) * sc, oy + (r["y"] - y0) * sc)

    img = Image.new("RGBA", (W, H), PAPER + (255,))
    d = ImageDraw.Draw(img)
    LW = 6

    lines = {}
    for r in rows:
        lines.setdefault(r["line_key"], {"line": r["line"], "colour": r["colour"],
                                         "pts": []})["pts"].append(r)
    for L in lines.values():
        L["pts"].sort(key=lambda r: r["seq"])

    # ---- 노선 -------------------------------------------------------------
    for L in lines.values():
        col = tuple(int(L["colour"][i:i + 2], 16) for i in (0, 2, 4))
        d.line([px(p) for p in L["pts"]], fill=col + (255,), width=LW,
               joint="curve")

    # ---- 역 마커 ----------------------------------------------------------
    for r in rows:
        if not r["name"]:
            continue
        x, y = px(r)
        if "interchange" in r["marker"]:
            rr = LW * 1.15
            d.ellipse((x - rr, y - rr, x + rr, y + rr), fill=(255, 255, 255, 255),
                      outline=INK + (255,), width=3)
        else:
            rr = LW * 0.55
            d.ellipse((x - rr, y - rr, x + rr, y + rr), fill=(255, 255, 255, 255),
                      outline=INK + (210,), width=2)

    # ---- 역명 -------------------------------------------------------------
    if NAMES:
        f = _font(15)
        for r in rows:
            nm = r["name"]
            if not nm:
                continue
            x, y = px(r)
            dx, dy, ha, va = DIRS.get(r["label_pos"] or "E", DIRS["E"])
            bb = d.textbbox((0, 0), nm, font=f, stroke_width=2)
            tw, th = bb[2] - bb[0], bb[3] - bb[1]
            gap = LW * 1.5
            tx = x + dx * gap
            ty = y + dy * gap
            if ha == "c":
                tx -= tw / 2.0
            elif ha == "r":
                tx -= tw
            if va == "m":
                ty -= th / 2.0
            elif va == "b":
                ty -= th
            d.text((tx, ty), nm, font=f, fill=INK + (255,),
                   stroke_width=2, stroke_fill=PAPER + (230,))

    # ---- 제목 · 범례 ------------------------------------------------------
    d.text((MARGIN, 22), "수도권 전철 노선도", font=_font(44), fill=INK + (255,))
    named = sum(1 for r in rows if r["name"])
    d.text((MARGIN, 78), "%d역 · %d노선 · 서울교통공사 사이버스테이션 공식 좌표"
           % (named, len(set(r["line"] for r in rows))), font=_font(17),
           fill=(118, 124, 132, 255))
    fl = _font(17)
    seen, lx, ly, hh = [], MARGIN + 560, 26, 30
    for r in rows:
        if r["line"] in seen:
            continue
        seen.append(r["line"])
        col = tuple(int(r["colour"][i:i + 2], 16) for i in (0, 2, 4))
        tw = d.textbbox((0, 0), r["line"], font=fl)[2]
        ww = max(hh, tw + 18)
        if lx + ww > W - MARGIN:
            lx, ly = MARGIN + 560, ly + hh + 7
        d.rounded_rectangle((lx, ly, lx + ww, ly + hh), radius=hh // 2,
                            fill=col + (255,))
        d.text((lx + (ww - tw) / 2.0, ly + 5), r["line"], font=fl,
               fill=(255, 255, 255, 255))
        lx += ww + 8

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.convert("RGB").save(OUT, optimize=True)
    print("ROUTEMAP OK -> %s  %dx%d  %.1f KB  %d역 · %d노선%s"
          % (OUT, W, H, os.path.getsize(OUT) / 1024.0, named, len(seen),
             " · 역명 포함" if NAMES else " · 역명 생략"))


main()
