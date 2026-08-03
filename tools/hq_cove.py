"""패스 I — 벽면 코브 조명과 개찰구 상부 조명.

순회 렌더에서 벽면 칸(`12-platform-wall`)이 거의 검게 나왔다. 천장 트로퍼는
통행 중앙에만 있고, 벽까지는 빛이 안 간다. 실사 지하철역에서 벽이 밝은 이유는
광고 라이트박스와 **벽 상부를 씻는 코브 조명** 두 가지인데 후자가 없었다.

개찰구도 같은 문제였다. Z3 천장 트로퍼는 x 58·62·66·70 인데 개찰기는 x 60.3~61.7 이라
정작 기계 위가 비어 있었다. 실물은 개찰구 열 바로 위에 조명이 따로 붙는다.

코브는 **아래를 향한 발광 띠 + 그것을 가리는 립**이다. 립이 없으면 광원이
그대로 보여서 형광등을 벽에 붙여 놓은 꼴이 된다.
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
from hq_lib import Batch, mat, zone_collection   # noqa: E402

# (컬렉션, 태그, 축, 내면 좌표, 법선 부호, 시작, 끝, 천장 z)
COVES = [
    ("Z5_PLATFORM", "Z5wS", "y", 0.00, +1, 78.0, 206.0, -15.50),
    ("Z5_PLATFORM", "Z5wN", "y", 30.00, -1, 78.0, 206.0, -15.50),
    ("Z2_CONCOURSE", "Z2wS", "y", 0.00, +1, 0.0, 56.0, -2.80),
    ("Z2_CONCOURSE", "Z2wN", "y", 30.00, -1, 0.0, 56.0, -2.80),
    ("Z2_CONCOURSE", "Z2wW", "x", 0.00, +1, 0.0, 30.0, -2.80),
    ("Z3_GATES", "Z3wS", "y", 0.00, +1, 56.0, 72.0, -2.80),
    ("Z3_GATES", "Z3wN", "y", 32.00, -1, 56.0, 72.0, -2.80),
    ("Z3_GATES", "Z3wE", "x", 72.00, -1, 0.0, 32.0, -2.80),
    ("Z4_DESCENT", "Z4wS", "y", 2.00, +1, 72.0, 96.0, -2.80),
    # y 는 `hq_walls.WALLS` 의 Z4wN 과 반드시 같아야 한다 — 코브가 벽에서 떨어지면
    # 통로 한가운데 빛 띠만 뜬다. 9.60 은 하강부 난간 y 였다(위 벽 주석 참조).
    ("Z4_DESCENT", "Z4wN", "y", 12.00, -1, 72.0, 96.0, -2.80),
]


def build():
    m_lip = mat("HQ_COVE_LIP", (0.72, 0.72, 0.70), roughness=0.5)
    m_glow = mat("HQ_COVE_GLOW", (1.0, 0.98, 0.94),
                 emit=(1.0, 0.97, 0.92), strength=2.4, roughness=0.9)

    total = 0
    for coll_name, tag, axis, at, sgn, a0, a1, cz in COVES:
        coll = zone_collection(coll_name)
        lip = Batch(f"{tag}_hq_covelip", m_lip)
        glow = Batch(f"{tag}_hq_coveglow", m_glow)
        # 발광 띠는 벽에 붙이고, 립은 그 아래를 조금 더 내밀어 광원을 가린다
        _put(glow, axis, at, sgn, a0, a1, cz - 0.40, cz - 0.26, 0.005, 0.055)
        _put(lip, axis, at, sgn, a0, a1, cz - 0.46, cz - 0.38, 0.005, 0.115)
        for b in (glow, lip):
            ob = b.build(coll)
            if ob:
                total += len(ob.data.polygons)

    total += _gate_line()
    print(f"[hq_cove] 면 {total:,}개 추가")


def _gate_line():
    """개찰기 열 바로 위 라인 조명. 기계 위가 밝아야 통과 지점이 읽힌다."""
    coll = zone_collection("Z3_GATES")
    m_h = mat("HQ_GATELINE_HOUSING", (0.30, 0.31, 0.33), metallic=0.3, roughness=0.4)
    m_l = mat("HQ_GATELINE_LIGHT", (1.0, 0.985, 0.95),
              emit=(1.0, 0.98, 0.94), strength=4.0, roughness=0.9)
    hous = Batch("Z3_hq_gateline_housing", m_h)
    lamp = Batch("Z3_hq_gateline_light", m_l)
    x, cz = 61.0, -2.80
    hous.box(x - 0.34, 3.4, cz - 0.46, x + 0.34, 28.8, cz - 0.30)
    for s in (-1, 1):                                  # 매다는 봉
        for y in (5.0, 12.0, 20.0, 27.5):
            hous.box(x + s * 0.24 - 0.018, y - 0.018, cz - 0.36,
                     x + s * 0.24 + 0.018, y + 0.018, cz)
    lamp.box(x - 0.27, 3.5, cz - 0.475, x + 0.27, 28.7, cz - 0.44)
    n = 0
    for b in (hous, lamp):
        ob = b.build(coll)
        if ob:
            n += len(ob.data.polygons)
    return n


def _put(b, axis, at, sgn, p0, p1, z0, z1, d0, d1):
    n0, n1 = at + sgn * d0, at + sgn * d1
    if axis == "y":
        b.box(p0, min(n0, n1), z0, p1, max(n0, n1), z1)
    else:
        b.box(min(n0, n1), p0, z0, max(n0, n1), p1, z1)


build()
