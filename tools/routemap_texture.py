"""ITM-13 노선도 텍스처 생성.

실행:  python3 tools/routemap_texture.py [out.png]

왜 직접 그리는가
  서울교통공사가 발행한 노선도 **도판 파일**은 그 기관의 저작물이라 게임
  에셋으로 굽지 않는다. 반면 어느 역이 어느 호선에 있고 어디서 갈아타는가는
  사실이다. 그 사실만 가져와 여기서 새로 그린다.

왜 텍스처인가
  이 저장소는 텍스처를 하나도 쓰지 않는다(export_station.py 가 이미지를
  통째로 뺀다). 그런데 역명을 폴리곤으로 넣으면 글리프 하나가 폴리곤
  덩어리라 43개 역만 해도 역사 전체보다 무거워진다. 노선도만 예외로 둔다.

레이아웃
  2호선을 둥근 사각형 고리로 그린다 — 실제 노선도도 그렇고, 그 고리 하나가
  '서울 노선도'라는 신호다. 역명은 고리 바깥으로 뺀다. 위·아래 구간에서는
  가로로 쓰면 서로 부딪히므로 90도 돌려 세운다.
"""
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "assets", "tex", "itm13_routemap.png")

S = 1024                     # 텍스처 한 변
PAPER = (247, 246, 242)
INK = (58, 62, 68)

FONT_PATHS = ("/System/Library/Fonts/AppleSDGothicNeo.ttc",
              "/System/Library/Fonts/Supplemental/AppleGothic.ttf")

# 실제 호선 색
C2 = (0, 168, 77)            # 2호선 순환
C1 = (0, 82, 164)            # 1호선
C3 = (239, 124, 28)          # 3호선
C4 = (0, 165, 222)           # 4호선
C5 = (153, 108, 172)         # 5호선
CK = (119, 196, 163)         # 경의중앙
CA = (73, 144, 214)          # 공항철도

# 2호선 순환선 43개 역. 시청에서 시계 반대 방향(을지로입구 → 왕십리 → 잠실 →
# 강남 → 신림 → 신도림 → 당산 → 홍대입구 → 시청)이 실제 순서다.
LOOP = [
    "시청", "을지로입구", "을지로3가", "을지로4가", "동대문역사문화공원", "신당",
    "상왕십리", "왕십리", "한양대", "뚝섬", "성수", "건대입구", "구의", "강변",
    "잠실나루", "잠실", "잠실새내", "종합운동장", "삼성", "선릉", "역삼", "강남",
    "교대", "서초", "방배", "사당", "낙성대", "서울대입구", "봉천", "신림",
    "신대방", "구로디지털단지", "대림", "신도림", "문래", "영등포구청", "당산",
    "합정", "홍대입구", "신촌", "이대", "아현", "충정로",
]
# 환승역 — 점을 크게 그린다
TRANSFER = {"시청", "을지로3가", "을지로4가", "동대문역사문화공원", "왕십리", "성수",
            "건대입구", "잠실", "종합운동장", "삼성", "선릉", "강남", "교대", "사당",
            "신도림", "영등포구청", "당산", "합정", "홍대입구", "충정로", "신설동"}

MARGIN = 116                 # 고리 좌우 여백
TOP = 236                    # 고리 위쪽 — 제목·범례와 세워 쓴 역명이 겹치지 않게
BOT = 128                    # 고리 아래쪽
CORNER = 118                 # 고리 모서리 반지름
LW = 13                      # 노선 두께


def _font(px, bold=True):
    for p in FONT_PATHS:
        try:
            f = ImageFont.truetype(p, px, index=1 if (bold and p.endswith(".ttc")) else 0)
            return f
        except Exception:
            continue
    raise RuntimeError("한글 폰트를 찾지 못했다: %s" % (FONT_PATHS,))


def rounded_loop_points(x0, y0, x1, y1, r, n):
    """둥근 사각형 둘레를 n 등분한 점과 그 지점의 '바깥 방향'을 돌려준다."""
    segs = []                                   # (길이, 시작점, 끝점 or 호 정보)
    straight = [((x0 + r, y0), (x1 - r, y0), (0, -1)),
                ((x1, y0 + r), (x1, y1 - r), (1, 0)),
                ((x1 - r, y1), (x0 + r, y1), (0, 1)),
                ((x0, y1 - r), (x0, y0 + r), (-1, 0))]
    arcs = [((x1 - r, y0 + r), 270.0), ((x1 - r, y1 - r), 0.0),
            ((x0 + r, y1 - r), 90.0), ((x0 + r, y0 + r), 180.0)]
    for i in range(4):
        a, b, nv = straight[i]
        segs.append(("L", math.hypot(b[0] - a[0], b[1] - a[1]), a, b, nv))
        c, a0 = arcs[i]
        segs.append(("A", math.pi * r / 2.0, c, a0, r))
    total = sum(s[1] for s in segs)
    pts = []
    for k in range(n):
        d = total * k / n
        for s in segs:
            if d > s[1]:
                d -= s[1]
                continue
            if s[0] == "L":
                _, ln, a, b, nv = s
                t = d / ln
                pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, nv))
            else:
                _, ln, c, a0, rr = s
                ang = math.radians(a0 + 90.0 * (d / ln))
                nv = (math.cos(ang), math.sin(ang))
                pts.append((c[0] + rr * nv[0], c[1] + rr * nv[1], nv))
            break
    return pts


def draw_label(img, text, anchor, nv, font, colour=INK):
    """고리 바깥 방향(nv)으로 역명을 붙인다. 위·아래 구간은 세워 쓴다."""
    # 글자에 종이색 테두리를 두른다. 교차 노선 위에 얹히면 그냥은 묻힌다
    # (실측: 시청이 1호선에, 동대문역사문화공원이 3호선에 먹혔다).
    HALO = 3
    tmp = Image.new("RGBA", (1, 1))
    w, h = ImageDraw.Draw(tmp).textbbox((0, 0), text, font=font,
                                        stroke_width=HALO)[2:]
    vertical = abs(nv[1]) > abs(nv[0])
    lab = Image.new("RGBA", (w + 4, h + 4), (0, 0, 0, 0))
    ImageDraw.Draw(lab).text((2, 2), text, font=font, fill=colour + (255,),
                             stroke_width=HALO, stroke_fill=PAPER + (235,))
    if vertical:
        lab = lab.rotate(90, expand=True)
    lw, lh = lab.size
    gap = 12
    x = anchor[0] + nv[0] * (gap + lw / 2.0) - lw / 2.0
    y = anchor[1] + nv[1] * (gap + lh / 2.0) - lh / 2.0
    img.alpha_composite(lab, (int(round(x)), int(round(y))))


def main():
    img = Image.new("RGBA", (S, S), PAPER + (255,))
    d = ImageDraw.Draw(img)
    f_st = _font(19)
    f_off = _font(17)
    f_ttl = _font(34)

    x0, y0 = MARGIN, TOP
    x1, y1 = S - MARGIN, S - BOT
    pts = rounded_loop_points(x0, y0, x1, y1, CORNER, len(LOOP))

    # ---- 교차 호선. 실제 환승역을 지나가게 놓는다 -------------------------
    def at(name):
        i = LOOP.index(name)
        return pts[i][0], pts[i][1]

    crossings = [
        (C1, [(at("시청")[0], 30), at("시청"), at("신도림"), (at("신도림")[0] - 96, S - 40)]),
        (C3, [(at("을지로3가")[0] + 150, 30), at("을지로3가"), at("교대"),
              (at("교대")[0] + 40, S - 40)]),
        (C4, [(at("동대문역사문화공원")[0] + 190, 40), at("동대문역사문화공원"),
              at("사당"), (at("사당")[0] - 70, S - 40)]),
        (C5, [(40, at("영등포구청")[1] + 60), at("영등포구청"), at("왕십리"),
              (S - 40, at("왕십리")[1] - 40)]),
        (CK, [(30, at("홍대입구")[1] - 120), at("홍대입구"), at("왕십리"),
              (S - 30, at("왕십리")[1] + 70)]),
        (CA, [(24, at("홍대입구")[1] + 34), at("홍대입구"),
              (at("홍대입구")[0] + 210, at("홍대입구")[1] + 250)]),
    ]
    for col, path in crossings:
        d.line([(p[0], p[1]) for p in path], fill=col + (255,), width=LW - 3,
               joint="curve")

    # ---- 2호선 순환선 ----------------------------------------------------
    ring = [(p[0], p[1]) for p in pts] + [(pts[0][0], pts[0][1])]
    d.line(ring, fill=C2 + (255,), width=LW, joint="curve")

    # ---- 역 점 + 역명 ----------------------------------------------------
    for i, name in enumerate(LOOP):
        x, y, nv = pts[i]
        big = name in TRANSFER
        r = 11 if big else 7
        d.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255, 255),
                  outline=INK + (255,), width=4 if big else 3)
        draw_label(img, name, (x, y), nv, f_st)

    # ---- 제목 · 범례 -----------------------------------------------------
    d.text((MARGIN - 8, 34), "수도권 전철 노선도", font=f_ttl, fill=INK + (255,))
    legend = [("1", C1), ("2", C2), ("3", C3), ("4", C4), ("5", C5),
              ("경의중앙", CK), ("공항철도", CA)]
    f_lg = _font(16)
    lx, ly, h = MARGIN - 8, 96, 30
    for lab, col in legend:
        tw = d.textbbox((0, 0), lab, font=f_lg)[2]
        w = max(h, tw + 20)                       # 여러 글자는 알약 모양으로 늘린다
        d.rounded_rectangle((lx, ly, lx + w, ly + h), radius=h // 2, fill=col + (255,))
        d.text((lx + (w - tw) / 2.0, ly + 5), lab, font=f_lg, fill=(255, 255, 255, 255))
        lx += w + 12

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.convert("RGB").save(OUT, optimize=True)
    print("ROUTEMAP OK -> %s  %dx%d  %.1f KB  역 %d개"
          % (OUT, S, S, os.path.getsize(OUT) / 1024.0, len(LOOP)))


main()
