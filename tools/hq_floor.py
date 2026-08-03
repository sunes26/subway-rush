"""패스 D — 바닥 정밀 마감.

기존 조인트는 1.2 m 격자다. 실사 홍대입구역 승강장은 **600 각 화강석**이라,
눈높이에서 보면 우리 바닥의 타일 한 장이 실제의 네 장 크기다. 그래서 걸어도
바닥이 안 흐르고 큰 판 위를 미끄러지는 느낌이 난다.

여기서 세 가지를 더한다.

  1. 600 서브 조인트 — 기존 1.2 m 격자 사이를 한 번 더 나눈다
  2. 구역 띠 — 존 경계와 벽 앞 0.9 m 에 색이 다른 마감 띠 (실사에서 거의 항상 있다)
  3. 설비 — 배수 그레이팅 · 맨홀 · 점검구

바닥에 얹는 것은 전부 **위를 향한 한 면**이다. xy 반시계로 감아야 위에서 보인다.
"""

from __future__ import annotations

import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))
                if "__file__" in dir() else r"C:\Users\User\Documents\HACKERTON\tools")
import hq_lib                                    # noqa: E402
import importlib                                 # noqa: E402
importlib.reload(hq_lib)
from hq_lib import Batch, frange, mat, zone_collection   # noqa: E402

# (컬렉션, 태그, x0, y0, x1, y1, 바닥 윗면 z)
FLOORS = [
    ("Z5_PLATFORM", "Z5A", 78.0, 0.0, 206.0, 11.9, -20.00),
    ("Z5_PLATFORM", "Z5B", 78.0, 20.2, 206.0, 30.0, -20.00),
    ("Z2_CONCOURSE", "Z2", 0.0, 0.0, 56.0, 30.0, -6.00),
    ("Z3_GATES", "Z3", 56.0, 0.0, 72.0, 32.0, -6.00),
    # 통로 폭은 y 2~12 다(부록 A · 충돌 `Z4-UPPER`). 9.6 은 하강부 난간 y 라
    # 바닥 마감이 통로 북쪽 2.4 m 를 안 덮고 그레이박스 바닥이 드러나 있었다.
    ("Z4_DESCENT", "Z4", 72.0, 2.0, 96.0, 12.0, -6.00),
]

SUB = 0.60
LIFT = 0.004            # 바닥면 위 살짝 — 같은 z면 z-파이팅이 난다


def build():
    m_sub = mat("HQ_FLOOR_SUBJOINT", (0.655, 0.628, 0.566), roughness=0.6)
    m_border = mat("HQ_FLOOR_BORDER", (0.545, 0.520, 0.470), roughness=0.55)
    m_grate = mat("HQ_FLOOR_GRATE", (0.34, 0.35, 0.36), metallic=0.5, roughness=0.4)
    m_hatch = mat("HQ_FLOOR_HATCH", (0.46, 0.46, 0.45), metallic=0.35, roughness=0.5)

    total = 0
    for coll_name, tag, x0, y0, x1, y1, z in FLOORS:
        coll = zone_collection(coll_name)
        sub = Batch(f"{tag}_hq_subjoint", m_sub)
        bor = Batch(f"{tag}_hq_border", m_border)
        gra = Batch(f"{tag}_hq_grate", m_grate)
        hat = Batch(f"{tag}_hq_hatch", m_hatch)

        _sub_joints(sub, x0, y0, x1, y1, z)
        _border(bor, x0, y0, x1, y1, z)
        _services(gra, hat, x0, y0, x1, y1, z)

        for b in (sub, bor, gra, hat):
            ob = b.build(coll)
            if ob:
                total += len(ob.data.polygons)
        print(f"  {tag}: 바닥 마감")
    print(f"[hq_floor] 면 {total:,}개 추가")


def _sub_joints(b, x0, y0, x1, y1, z):
    """600 서브 조인트. 기존 1.2 m 격자와 겹치지 않게 반 칸씩 어긋나게 놓는다."""
    w = 0.014
    for x in frange(x0 + SUB, x1 - SUB, SUB * 2):
        b.box(x - w, y0, z, x + w, y1, z + LIFT)
    for y in frange(y0 + SUB, y1 - SUB, SUB * 2):
        b.box(x0, y - w, z, x1, y + w, z + LIFT)


def _border(b, x0, y0, x1, y1, z):
    """벽 앞 마감 띠. 큰 바닥이 벽에 그냥 닿으면 벽이 물에 뜬 것처럼 보인다."""
    t, gap = 0.85, 0.06
    for a0, b0, a1, b1 in (
        (x0, y0, x1, y0 + t), (x0, y1 - t, x1, y1),
        (x0, y0 + t, x0 + t, y1 - t), (x1 - t, y0 + t, x1, y1 - t),
    ):
        b.box(a0, b0, z, a1, b1, z + LIFT * 0.6)
    for a0, b0, a1, b1 in (
        (x0, y0 + t, x1, y0 + t + gap), (x0, y1 - t - gap, x1, y1 - t),
    ):
        b.box(a0, b0, z, a1, b1, z + LIFT)


def _services(g, h, x0, y0, x1, y1, z):
    """배수 그레이팅 · 맨홀 · 점검구. 없으면 바닥이 '깔아만 둔 판'이다."""
    for x in frange(x0 + 6.0, x1 - 6.0, 12.0):
        for y in (y0 + 1.1, y1 - 1.1):
            g.box(x - 0.55, y - 0.14, z, x + 0.55, y + 0.14, z + LIFT)
            for k in range(5):
                sx = x - 0.44 + k * 0.22
                g.box(sx - 0.018, y - 0.11, z + LIFT, sx + 0.018, y + 0.11, z + LIFT * 2)
    for x in frange(x0 + 11.0, x1 - 11.0, 22.0):
        y = (y0 + y1) / 2
        h.disc(x, y, z + LIFT, 0.36, seg=20)
        h.disc(x, y, z + LIFT * 1.6, 0.28, seg=20)


build()
