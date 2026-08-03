"""패스 F — 대합실 상가.

56 m 짜리 대합실에 점포가 두 칸이었다. 실제 홍대입구 대합실은 개찰구 밖이
통째로 상가 거리라, 두 칸으로는 "역 안에 가게가 하나 있다" 이상으로 안 읽힌다.

여기서 남벽을 따라 다섯 칸을 더 낸다. 한 칸의 구성은 실사에서 잰 것을 따른다.

    파일런 → 간판 밴드(발광 + 상호) → 유리 파사드(멀리언 3) → 돌출 양면 간판
    → 내부: 뒷벽 선반 3단 · 중앙 곤돌라 · 계산대 · 냉장 쇼케이스 · 천장 조명

**개구부는 통행이 아니라 시선을 위한 것이다.** 유리로 통으로 막으면 안을 아무리 채워도
반사판으로 보인다. 그래서 가운데 1.6 m 는 유리를 비운다.

글자 회전은 규약을 따른다 — FONT 는 `rotX(90°)` 만 걸면 법선이 −y 다.
+y 를 향해야 하면 `rotZ = π`. 기본값을 π 로 뒀다가 간판이 거울상이 된 적이 있으니
**보는 쪽을 먼저 정하고** 표를 본다.
"""

from __future__ import annotations

import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))
                if "__file__" in dir() else r"C:\Users\User\Documents\HACKERTON\tools")
import hq_lib                                    # noqa: E402
import importlib                                 # noqa: E402
importlib.reload(hq_lib)
from hq_lib import Batch, mat, zone_collection   # noqa: E402

FLOOR = -6.00
HEAD = -3.00              # 점포 상단
BAND_H = 0.62             # 간판 밴드 높이
DEPTH = 3.60              # 안쪽 깊이
FONT = "Malgun Gothic Bold"

# (상호, 간판색, 상품색 3종)
BRANDS = [
    ("편의점", (0.10, 0.34, 0.70), ((0.85, 0.22, 0.18), (0.18, 0.45, 0.82), (0.95, 0.80, 0.20))),
    ("빵집", (0.80, 0.46, 0.14), ((0.78, 0.58, 0.32), (0.90, 0.76, 0.50), (0.55, 0.36, 0.20))),
    ("카페", (0.32, 0.20, 0.14), ((0.42, 0.28, 0.18), (0.88, 0.86, 0.80), (0.20, 0.42, 0.28))),
    ("화장품", (0.82, 0.34, 0.52), ((0.95, 0.72, 0.78), (0.98, 0.94, 0.90), (0.62, 0.24, 0.40))),
    ("분식", (0.76, 0.16, 0.14), ((0.90, 0.30, 0.20), (0.95, 0.88, 0.62), (0.30, 0.52, 0.24))),
    ("액세서리", (0.44, 0.24, 0.62), ((0.72, 0.62, 0.86), (0.94, 0.90, 0.60), (0.35, 0.55, 0.80))),
]

# (태그, 벽면 y, 법선 부호, 시작 x, 칸 수, 칸 폭, 브랜드 인덱스)
#   남벽은 자판기(x 10.5·21.5, y 4.6)를 피해 파사드를 y 3.6 에 둔다.
BAYS = [
    ("S", 0.00, +1, 8.80, 5, 4.30, [0, 1, 2, 3, 4]),
    ("N", 30.00, -1, 32.20, 1, 3.80, [5]),
]


def build():
    m_pil = mat("HQ_SHOP_PILASTER", (0.86, 0.855, 0.83), roughness=0.5)
    m_frame = mat("HQ_SHOP_FRAME", (0.62, 0.64, 0.66), metallic=0.5, roughness=0.3)
    m_glass = mat("HQ_SHOP_GLASS", (0.74, 0.83, 0.87), roughness=0.12)
    m_intwall = mat("HQ_SHOP_INTWALL", (0.93, 0.92, 0.89), roughness=0.6)
    m_intfloor = mat("HQ_SHOP_INTFLOOR", (0.80, 0.78, 0.74), roughness=0.4)
    m_shelf = mat("HQ_SHOP_SHELF", (0.90, 0.90, 0.88), roughness=0.5)
    m_counter = mat("HQ_SHOP_COUNTER", (0.28, 0.30, 0.32), roughness=0.45)
    m_light = mat("HQ_SHOP_LIGHT", (1.0, 0.98, 0.92),
                  emit=(1.0, 0.97, 0.90), strength=5.0)
    m_chill = mat("HQ_SHOP_CHILL", (0.72, 0.86, 0.92),
                  emit=(0.62, 0.86, 0.96), strength=1.6)
    m_txt = mat("HQ_SHOP_TXT", (0.98, 0.98, 0.96),
                emit=(0.95, 0.95, 0.92), strength=1.2)

    coll = zone_collection("Z2_CONCOURSE")
    pil = Batch("Z2_hq_shop_pilaster", m_pil)
    frame = Batch("Z2_hq_shop_frame", m_frame)
    glass = Batch("Z2_hq_shop_glass", m_glass)
    iw = Batch("Z2_hq_shop_intwall", m_intwall)
    fl = Batch("Z2_hq_shop_intfloor", m_intfloor)
    sh = Batch("Z2_hq_shop_shelf", m_shelf)
    ct = Batch("Z2_hq_shop_counter", m_counter)
    li = Batch("Z2_hq_shop_light", m_light)
    ch = Batch("Z2_hq_shop_chill", m_chill)
    goods = [Batch(f"Z2_hq_shop_goods{i}", mat(f"HQ_SHOP_GOODS{i}", c, roughness=0.6))
             for i, c in enumerate([(0.85, 0.22, 0.18), (0.18, 0.45, 0.82),
                                    (0.95, 0.80, 0.20), (0.78, 0.58, 0.32),
                                    (0.42, 0.28, 0.18), (0.95, 0.72, 0.78),
                                    (0.90, 0.30, 0.20), (0.72, 0.62, 0.86)])]
    bands = []
    for i, (_, col, _) in enumerate(BRANDS):
        bands.append(Batch(f"Z2_hq_shop_band{i}",
                           mat(f"HQ_SHOP_BAND{i}", col, emit=col, strength=1.5)))

    n = 0
    for tag, wy, sgn, x0, count, w, brands in BAYS:
        for k in range(count):
            bx = x0 + k * w
            bi = brands[k % len(brands)]
            _bay(pil, frame, glass, iw, fl, sh, ct, li, ch, goods, bands[bi],
                 bx, bx + w - 0.14, wy, sgn, bi)
            _signage(coll, bx + (w - 0.14) / 2, wy, sgn, bi, m_txt, bands[bi].material)
            n += 1

    total = 0
    for b in (pil, frame, glass, iw, fl, sh, ct, li, ch, *goods, *bands):
        ob = b.build(coll)
        if ob:
            total += len(ob.data.polygons)
    print(f"[hq_shops] 점포 {n}칸 · 면 {total:,}개 추가")


def _bay(pil, frame, glass, iw, fl, sh, ct, li, ch, goods, band,
         ax0, ax1, wy, sgn, bi):
    """점포 한 칸. y 는 벽면(wy)에서 안쪽(sgn 반대)으로 DEPTH 만큼."""
    y_in = wy                      # 안쪽 끝(벽)
    y_face = wy + sgn * DEPTH      # 파사드
    lo, hi = min(y_in, y_face), max(y_in, y_face)

    # 파일런 · 상인방
    for e in (ax0 - 0.13, ax1):
        pil.box(e, y_face - sgn * 0.08, FLOOR, e + 0.13, y_face + sgn * 0.10, HEAD)
    pil.box(ax0 - 0.13, y_face - sgn * 0.08, HEAD - 0.06,
            ax1 + 0.13, y_face + sgn * 0.10, HEAD)

    # 간판 밴드 — 프레임 안에 발광면
    frame.box(ax0 - 0.10, y_face + sgn * 0.04, HEAD - BAND_H - 0.05,
              ax1 + 0.10, y_face + sgn * 0.14, HEAD - 0.02)
    band.box(ax0 - 0.06, y_face + sgn * 0.14, HEAD - BAND_H,
             ax1 + 0.06, y_face + sgn * 0.17, HEAD - 0.06)

    # 유리 파사드 — 가운데 1.6 m 는 개구부로 비운다
    door = 1.60
    cx = (ax0 + ax1) / 2
    segs = [(ax0, cx - door / 2), (cx + door / 2, ax1)]
    for s0, s1 in segs:
        if s1 - s0 < 0.15:
            continue
        glass.box(s0, y_face - sgn * 0.015, FLOOR + 0.12, s1, y_face, HEAD - BAND_H - 0.05)
        frame.box(s0, y_face - sgn * 0.030, FLOOR, s1, y_face + sgn * 0.015, FLOOR + 0.12)
        frame.box(s0, y_face - sgn * 0.030, HEAD - BAND_H - 0.11,
                  s1, y_face + sgn * 0.015, HEAD - BAND_H - 0.05)
        for m in (1, 2):
            mx = s0 + (s1 - s0) * m / 3
            frame.box(mx - 0.022, y_face - sgn * 0.030, FLOOR + 0.12,
                      mx + 0.022, y_face + sgn * 0.015, HEAD - BAND_H - 0.11)
    for s in (-1, 1):                             # 개구부 문선
        e = cx + s * door / 2
        frame.box(e - 0.030, y_face - sgn * 0.030, FLOOR,
                  e + 0.030, y_face + sgn * 0.015, HEAD - BAND_H - 0.05)

    # 내부 — 바닥 · 뒷벽 · 좌우벽 · 천장
    fl.box(ax0, lo, FLOOR, ax1, hi, FLOOR + 0.012)
    iw.box(ax0, y_in - sgn * 0.10, FLOOR, ax1, y_in, HEAD)
    for e in (ax0 - 0.10, ax1):
        iw.box(e, lo, FLOOR, e + 0.10, hi, HEAD)
    iw.box(ax0, lo, HEAD - 0.10, ax1, hi, HEAD)
    for m in (0.30, 0.70):                        # 천장 조명 두 줄
        ly = lo + (hi - lo) * m
        li.box(ax0 + 0.35, ly - 0.09, HEAD - 0.13, ax1 - 0.35, ly + 0.09, HEAD - 0.10)

    # 뒷벽 선반 3단 + 상품
    for lvl in range(3):
        z = FLOOR + 0.55 + lvl * 0.55
        sh.box(ax0 + 0.06, y_in + sgn * 0.06, z, ax1 - 0.06, y_in + sgn * 0.52, z + 0.035)
        _goods(goods, ax0 + 0.12, ax1 - 0.12, y_in + sgn * 0.12, y_in + sgn * 0.46,
               z + 0.035, 0.30, bi + lvl)

    # 중앙 곤돌라
    gy = (lo + hi) / 2
    sh.box(ax0 + 0.55, gy - 0.32, FLOOR, ax1 - 1.35, gy + 0.32, FLOOR + 0.08)
    for lvl in range(3):
        z = FLOOR + 0.42 + lvl * 0.42
        sh.box(ax0 + 0.55, gy - 0.32, z, ax1 - 1.35, gy + 0.32, z + 0.03)
        _goods(goods, ax0 + 0.60, ax1 - 1.40, gy - 0.28, gy + 0.28, z + 0.03, 0.26,
               bi + lvl + 1)

    # 계산대
    ct.box(ax1 - 1.20, y_face - sgn * 1.05, FLOOR, ax1 - 0.18, y_face - sgn * 0.42,
           FLOOR + 0.98)
    sh.box(ax1 - 1.24, y_face - sgn * 1.09, FLOOR + 0.98, ax1 - 0.14,
           y_face - sgn * 0.38, FLOOR + 1.04)

    # 냉장 쇼케이스 — 유리문 3짝, 안이 밝다
    cw = 1.55
    ch.box(ax0 + 0.10, y_face - sgn * 0.95, FLOOR, ax0 + 0.10 + cw,
           y_face - sgn * 0.32, FLOOR + 1.95)
    for d in range(3):
        dx = ax0 + 0.14 + d * (cw - 0.08) / 3
        frame.box(dx, y_face - sgn * 0.34, FLOOR + 0.05,
                  dx + 0.030, y_face - sgn * 0.30, FLOOR + 1.90)


def _goods(goods, x0, x1, y0, y1, z, h, seed):
    """선반 위 상품 블록. 폭을 조금씩 다르게 해야 '줄지어 선 큐브'가 안 된다."""
    x = x0
    i = seed
    while x < x1 - 0.10:
        w = 0.16 + ((i * 37) % 11) * 0.018
        d = 0.10 + ((i * 53) % 7) * 0.020
        hh = h * (0.62 + ((i * 29) % 9) * 0.042)
        goods[i % len(goods)].box(x, y0, z, min(x + w, x1), min(y0 + d, y1), z + hh)
        x += w + 0.022
        i += 1


def _signage(coll, cx, wy, sgn, bi, m_txt, m_band):
    """간판 글자와 돌출 양면 간판.

    FONT 기본 상태에서 `rotX(90°)` 만 걸면 법선 −y · 읽는 방향 +x 다.
    +y 를 향해야 하는 남벽 점포는 `rotZ = π`.
    """
    name, _, _ = BRANDS[bi]
    y_face = wy + sgn * DEPTH
    rz = math.pi if sgn > 0 else 0.0

    def text(obj_name, body, size, loc, material, rot_z):
        o = bpy.data.objects.get(obj_name)
        if o is None or o.type != "FONT":
            cu = bpy.data.curves.new(obj_name, type="FONT")
            o = bpy.data.objects.new(obj_name, cu)
            coll.objects.link(o)
        cu = o.data
        cu.body = body
        cu.font = bpy.data.fonts.get(FONT) or cu.font
        cu.size = size
        cu.align_x = "CENTER"
        cu.align_y = "CENTER"
        cu.extrude = 0.004
        cu.resolution_u = 1          # 한글 글리프 분할이 glTF 용량의 88 % 였다
        cu.materials.clear()
        cu.materials.append(material)
        o.location = loc
        o.rotation_euler = (math.pi / 2, 0.0, rot_z)
        return o

    text(f"Z2_hq_shopname{bi}_{int(cx * 10)}", name, 0.34,
         (cx, y_face + sgn * 0.185, HEAD - BAND_H / 2 - 0.03), m_txt, rz)

    # 돌출 양면 간판 — 통로 축이 x 이므로 판은 x 로 얇다
    bx = cx + 1.10
    blade = bpy.data.objects.get(f"Z2_hq_blade{bi}_{int(cx * 10)}")
    b = Batch(f"Z2_hq_blade{bi}_{int(cx * 10)}", m_band)
    b.box(bx - 0.035, y_face + sgn * 0.16, HEAD - 1.65,
          bx + 0.035, y_face + sgn * 1.00, HEAD - 0.55)
    b.box(bx - 0.012, y_face + sgn * 0.02, HEAD - 1.20,
          bx + 0.012, y_face + sgn * 0.18, HEAD - 1.05)
    b.build(coll)
    for s in (-1, 1):
        text(f"Z2_hq_bladetxt{bi}_{int(cx * 10)}_{s}", name, 0.20,
             (bx + s * 0.042, y_face + sgn * 0.58, HEAD - 1.10),
             m_txt, math.pi / 2 if s > 0 else 3 * math.pi / 2)


build()
