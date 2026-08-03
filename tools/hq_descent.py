"""패스 H — 하강부 마감과 조명.

순회 렌더에서 가장 나쁜 칸이 `09-descent` 였다. 24.6 m 짜리 경사 터널이
거의 캄캄하고, 양 측벽 100 m² 가 아무것도 없는 회색 판이었다. 대합실과 승강장은
손봤는데 그 사이를 잇는 구간만 그레이박스로 남아 있었던 셈이다.

여기서 네 가지를 한다.

  1. 경사 소핏을 따라 흐르는 **연속 라인 조명** 두 줄
  2. 양 측벽 **패널 분할 + 광고 라이트박스** (소핏에 맞춰 경사로 흐른다)
  3. 도착부(x 120~128) 천장 조명
  4. 벽 상부 코니스

⚠ 경사면의 높이를 `z = lerp(z0, z1, t)` 로 잡으면 어긋난다. 중간에 계단참이 있어
실제 면이 꺾이기 때문이다. **소핏 메시에 아래에서 위로 레이를 쏴서** 읽는다.
`obj.ray_cast` 는 로컬 좌표를 받으므로 `matrix_world.inverted()` 로 변환할 것.

⚠ 벽 부착물의 높이는 바닥이 아니라 **소핏 기준**으로 잡는다. 바닥은 계단이라
높이가 톱니처럼 오르내려서, 바닥 기준으로 잡으면 광고가 계단을 뚫는다.
"""

from __future__ import annotations

import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))
                if "__file__" in dir() else r"C:\Users\User\Documents\HACKERTON\tools")
import hq_lib                                    # noqa: E402
import importlib                                 # noqa: E402
importlib.reload(hq_lib)
from hq_lib import Batch, frange, mat, zone_collection   # noqa: E402

SOFFIT = "Z4_desc_ceil"
# 하강 시작 ~ **계단이 끝나는 곳**.
# 127.4(도착부 끝)까지 마감을 넣었더니 x 120~127 구간이 이미 승강장이라,
# 측벽 마감(y 1.35 / 9.20)이 승강장 안 1.35 m 지점에 벽처럼 서 버렸다.
# 우선석(y 0.55~1.11) 바로 앞을 경사 띠가 가로지르고 세로 홈이 봉처럼 늘어서
# "의자를 가로막는 철근"으로 보였다. 도착부 마감은 승강장 패스가 담당한다.
X0, X1 = 96.2, 120.4
WALL_A, WALL_B = 1.35, 9.20   # 측벽 내면 (법선 +y / −y)
# 조명 줄은 **통행 폭 위**에 와야 한다. 3.10 은 에스컬레이터(y 1.35~3.05)와 계단
# (y 4.20~9.20) 사이 난간 위였고, 계단 24 m 를 7.40 한 줄이 감당하고 있었다.
# 그래서 하강부에 들어서면 소핏이 통짜 회색 판으로만 보였다.
LIGHT_ROWS = (2.20, 5.00, 8.20)
# 소핏 밑면 가로 리브 — 24 m 짜리 무늬 없는 경사면을 끊는다.
RIB_PITCH = 2.40
RIB_W = 0.22
RIB_D = 0.09
STEP = 0.80


def soffit_z(x, y):
    """소핏 밑면 높이. 아래에서 위로 레이를 쏴서 읽는다."""
    o = bpy.data.objects.get(SOFFIT)
    if o is None:
        return None
    inv = o.matrix_world.inverted()
    org = inv @ Vector((x, y, -24.0))
    tip = inv @ Vector((x, y, 0.0))
    ok, loc, nor, _ = o.ray_cast(org, (tip - org).normalized(), distance=30.0)
    if not ok:
        return None
    return (o.matrix_world @ loc).z


def build():
    m_hous = mat("HQ_DESC_HOUSING", (0.60, 0.62, 0.64), metallic=0.3, roughness=0.4)
    m_lamp = mat("HQ_DESC_LIGHT", (1.0, 0.985, 0.945),
                 emit=(1.0, 0.975, 0.925), strength=4.2, roughness=0.9)
    m_panel = mat("HQ_DESC_PANEL", (0.855, 0.845, 0.815), roughness=0.55)
    # 벽 패널(0.855)과 너무 벌어지면 홈이 아니라 **검은 봉 여러 개**로 읽힌다.
    # 광고를 걷어내고 나니 벽에 남은 게 이것뿐이라 더 두드러졌다.
    m_reveal = mat("HQ_DESC_REVEAL", (0.66, 0.655, 0.635), roughness=0.7)

    # 예전에 걸었던 광고와 그 프레임을 걷어낸다. 빈 `Batch` 는 오브젝트를 안 지우므로
    # (같은 함정에 사인 뱅크에서 이미 물렸다) 이름으로 직접 지운다.
    stale = ["Z4_hq_desc_adframe"]
    stale += [f"Z4_hq_descad{i}{k}" for i in range(4) for k in ("bg", "ink")]
    gone = 0
    for nm in stale:
        o = bpy.data.objects.get(nm)
        if o is not None:
            bpy.data.objects.remove(o, do_unlink=True)
            gone += 1

    coll = zone_collection("Z4_DESCENT")
    hous = Batch("Z4_hq_desc_housing", m_hous)
    lamp = Batch("Z4_hq_desc_light", m_lamp)
    panel = Batch("Z4_hq_desc_panel", m_panel)
    rev = Batch("Z4_hq_desc_reveal", m_reveal)

    miss = _ceiling_lines(hous, lamp)
    ribs = _soffit_ribs(rev)
    n = _wall_finish(panel, rev)

    total = 0
    for b in (hous, lamp, panel, rev):
        ob = b.build(coll)
        if ob:
            total += len(ob.data.polygons)
    print(f"[hq_descent] 벽 {n}면 · 소핏 리브 {ribs}줄 · 광고 철거 {gone}개 · "
          f"레이 실패 {miss}회 · 면 {total:,}개 추가")


def _soffit_ribs(b):
    """소핏 밑면 가로 리브.

    머리 여유는 전 구간 2.29 m 이상으로 **기하는 정상**인데도 "계단이랑 천장이
    합쳐져 보인다"는 제보가 나왔다. 원인은 높이가 아니라 24 m 경사면 전체가
    이음매 없는 한 장이라 눈이 거리를 못 재는 것이었다.
    리브를 일정 간격으로 놓으면 그 리듬이 곧 하강 거리의 눈금이 된다.

    경사면 위에 축정렬 상자를 놓으므로 폭(0.22)을 짧게 유지한다 — 길면 단차가 보인다.
    """
    n = 0
    x = X0 + RIB_PITCH / 2
    while x < X1 - 0.3:
        za = soffit_z(x, WALL_A + 0.4)
        zb = soffit_z(x, WALL_B - 0.4)
        if za is not None and zb is not None:
            z = min(za, zb)
            b.box(x - RIB_W / 2, WALL_A + 0.02, z - RIB_D, x + RIB_W / 2, WALL_B - 0.02, z)
            n += 1
        x += RIB_PITCH
    return n


def _ceiling_lines(hous, lamp):
    """경사 소핏을 따라 흐르는 라인 조명. 구간마다 높이를 다시 읽는다."""
    miss = 0
    for y in LIGHT_ROWS:
        x = X0
        while x < X1 - STEP:
            za = soffit_z(x, y)
            zb = soffit_z(x + STEP, y)
            if za is None or zb is None:
                miss += 1
                x += STEP
                continue
            # 경사면을 따라 눕히려면 사다리꼴이 필요하지만, 0.8 m 조각이면
            # 상자를 구간마다 다시 놓는 것으로 충분히 이어져 보인다.
            hous.box(x, y - 0.30, min(za, zb) - 0.14, x + STEP, y + 0.30, max(za, zb))
            lamp.box(x + 0.03, y - 0.24, min(za, zb) - 0.155,
                     x + STEP - 0.03, y + 0.24, min(za, zb) - 0.115)
            x += STEP
    return miss


def _wall_finish(panel, rev):
    """측벽 패널화. 높이는 소핏에서 내려 잡는다 — 바닥은 계단이라 못 쓴다.

    **광고는 걸지 않는다.** 여기 벽면은 경사 소핏을 따라가므로 광고도 계단을 따라
    비스듬히 흐르는데, 내려가는 사람 시야에서는 그게 벽에 붙은 판이 아니라
    허공에 뜬 판으로 읽힌다. 디렉터가 x 95~121 전 구간의 "전광판"을 전부 빼라고 했다.
    세로 홈과 가로 띠만으로 벽은 충분히 읽힌다.
    """
    n = 0
    for wy, sgn in ((WALL_A, +1), (WALL_B, -1)):
        # 세로 홈은 상자로 놓아도 된다 — 어차피 수직이다
        x = X0
        while x < X1:
            zc = soffit_z(min(x + 0.4, X1 - 0.05), wy + sgn * 0.5)
            if zc is not None:
                # 4.6 m 는 **계단 밑면을 뚫고 내려간다**(실측 z −21.67 — 승강장 바닥보다
                # 아래다). 계단 밑 빈 공간에서 보면 검은 봉 여러 개가 슬래브에 박힌
                # 것처럼 보였다. 벽이 실제로 보이는 높이는 소핏에서 3.3 m 까지다.
                _put(rev, wy, sgn, x, x + 0.035, zc - 3.30, zc - 0.10, 0.0, 0.016)
            x += 1.30
        # 가로 띠는 **경사를 따라야 한다.** 처음에 1.3 m 짜리 상자를 구간마다
        # 다시 놓았더니 단차가 생겨 벽에 덩어리가 계단처럼 붙은 꼴이 됐다.
        # 사다리꼴 판으로 이어 붙이면 한 줄로 흐른다.
        for drop, thick in ((0.10, 0.24), (2.60, 0.20)):
            _sloped_band(panel, wy, sgn, drop, thick)
        n += 1
    return n


def _sloped_band(b, wy, sgn, drop, thick, step=1.30):
    """소핏에서 `drop` 만큼 내려온 높이를 따라 흐르는 띠.

    한 마디를 **닫힌 프리즘**으로 만든다. 면 하나씩 손으로 감으면 축과 부호 조합에서
    반드시 절반이 뒤집힌다 — 검증된 상자 감김을 그대로 쓰고 z 만 x 마다 다르게 준다.
    (면은 x 에만 의존하므로 여전히 평면이다.)
    """
    ys = sorted((wy, wy + sgn * 0.050))
    x = X0
    prev = None
    while x <= X1:
        z = soffit_z(min(x, X1 - 0.05), wy + sgn * 0.5)
        if z is None:
            prev = None
            x += step
            continue
        cur = (x, z - drop - thick, z - drop)
        if prev is not None:
            (xa, ba, ta), (xb, bb, tb) = prev, cur
            n = len(b.verts)
            b.verts += [(xa, ys[0], ba), (xb, ys[0], bb), (xb, ys[1], bb), (xa, ys[1], ba),
                        (xa, ys[0], ta), (xb, ys[0], tb), (xb, ys[1], tb), (xa, ys[1], ta)]
            b.faces += [tuple(n + i for i in f) for f in hq_lib.BOX_FACES]
        prev = cur
        x += step


def _put(b, wy, sgn, x0, x1, z0, z1, d0, d1):
    n0, n1 = wy + sgn * d0, wy + sgn * d1
    b.box(x0, min(n0, n1), z0, x1, max(n0, n1), z1)


build()
