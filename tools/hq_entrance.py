"""패스 M — 지상 출입구 계단통 내부 마감.

순회 04·05 칸이 씬에서 가장 나빴다. 화면의 70 %가 **무늬도 조명도 없는 회색 판**
두 장(계단통 소핏과 좌우 벽)이고, 그 사이로 계단이 조금 보인다. 여기는 게임을
시작하고 30초 안에 지나는 자리라 첫인상을 그대로 결정한다.

실사 출입구 계단(구글 이미지 다수 대조)에서 이 공간을 만드는 것은 넷이다.

  * 천장을 따라 **길게 이어진 라인 조명** — 계단 길이를 눈으로 재게 해 준다
  * 벽면 **세로 패널 분할**과 허리 높이 띠
  * 각 단 앞코의 **노란 논슬립** (이미 있다 — `STAIR_NOSE` 는 노랑)
  * **촘촘한 난간 동자** (`hq_fixups.stair_balusters` 가 붙인다)

⚠ 소핏은 계단식 박스 네 개다. 레이로 읽은 값을 그대로 쓰면 조명과 띠도 계단처럼
   턱이 진다. 양 끝만 읽어 **선형으로 펴서** 쓴다 — 계단 경사는 어차피 일정하다.
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
from hq_lib import Batch, mat, zone_collection   # noqa: E402

SOFFIT = "Z1_st_ceil"
X0, X1 = 2.30, 14.30           # 계단통 유효 구간
WALL_S, WALL_N = 25.40, 30.60  # 벽 내면
LIGHT_ROWS = (26.85, 29.15)
STEP = 0.80
RIB_PITCH = 1.60
REVEAL_PITCH = 1.15
# 소핏에서 아래로 — 상부 코니스 **한 줄만** 둔다.
# 처음에 초록으로 두 줄(상부 + 허리)을 넣었더니 기존 `Z1_st_band` 까지 합쳐
# 벽 하나에 초록 띠가 세 줄이 되어, 계단통이 아니라 초록 리본 터널로 보였다.
# 색도 회색으로 돌린다 — 초록은 사인 색이라 구조 부재에 쓰면 의미가 흐려진다.
BAND_DROP = (0.14, 0.30)


def soffit_z(x, y):
    o = bpy.data.objects.get(SOFFIT)
    if o is None:
        return None
    inv = o.matrix_world.inverted()
    org = inv @ Vector((x, y, -9.0))
    tip = inv @ Vector((x, y, 6.0))
    d = tip - org
    ok, loc, _n, _i = o.ray_cast(org, d.normalized(), distance=d.length)
    return (o.matrix_world @ loc).z if ok else None


def _fit():
    """소핏 밑면을 x 의 1차식으로 편다. (a, b) → z = a·x + b"""
    xa, xb = X0 + 0.2, X1 - 0.2
    za = soffit_z(xa, 28.0)
    zb = soffit_z(xb, 28.0)
    if za is None or zb is None:
        return None
    return (zb - za) / (xb - xa), za - (zb - za) / (xb - xa) * xa


def build():
    fit = _fit()
    if fit is None:
        print("[hq_entrance] 소핏 레이 실패 — 건너뜀")
        return
    a, b = fit
    z_at = lambda x: a * x + b

    m_hous = mat("HQ_ENTST_HOUSING", (0.58, 0.60, 0.62), metallic=0.3, roughness=0.4)
    m_lamp = mat("HQ_ENTST_LIGHT", (1.0, 0.985, 0.945),
                 emit=(1.0, 0.975, 0.925), strength=4.6, roughness=0.9)
    m_rib = mat("HQ_ENTST_RIB", (0.46, 0.47, 0.48), roughness=0.6)
    m_panel = mat("HQ_ENTST_PANEL", (0.795, 0.785, 0.755), roughness=0.55)
    m_band = mat("HQ_ENTST_BAND", (0.70, 0.70, 0.68), roughness=0.5)

    coll = zone_collection("Z1_GROUND")
    hous = Batch("Z1_hq_entst_housing", m_hous)
    lamp = Batch("Z1_hq_entst_light", m_lamp)
    rib = Batch("Z1_hq_entst_rib", m_rib)
    panel = Batch("Z1_hq_entst_panel", m_panel)
    band = Batch("Z1_hq_entst_band", m_band)

    n_f = _soffit_face(panel, z_at)
    n_l = _lines(hous, lamp, z_at)
    n_r = _ribs(rib, z_at)
    n_w = _walls(panel, band, z_at) + n_f

    total = 0
    for bt in (hous, lamp, rib, panel, band):
        ob = bt.build(coll)
        if ob:
            ob.parent = None
            ob.location = (0.0, 0.0, 0.0)
            ob.rotation_euler = (0.0, 0.0, 0.0)
            ob.scale = (1.0, 1.0, 1.0)
            total += len(ob.data.polygons)
    print(f"[hq_entrance] 조명 {n_l}마디 · 리브 {n_r}줄 · 벽 홈 {n_w}개 · 면 {total:,}개")


def _soffit_face(b, z_at, step=1.20):
    """소핏 밑면 마감판.

    계단을 아래에서 올려다보면 오른쪽에만 굵은 **검은 사선** 세 줄이 있었다.
    라이트맵을 꺼도 남았고 레이캐스트로도 안 잡혔다 — 지오메트리가 아니라
    소핏 밑면(`Z1_st_ceil`, 어두운 `ST_CEIL`)과 벽이 만나는 모서리가
    비스듬히 보이는 각도에서 검게 읽힌 것이었다.

    발광체는 자기만 빛나므로 라인 조명을 달아도 밑면 자체는 어두운 채다.
    밑면을 **밝은 판으로 덮어** 톤을 올린다. 경사면이라 사다리꼴 프리즘으로 잇는다.
    """
    n = 0
    x = X0
    prev = None
    while x <= X1:
        cur = (x, z_at(x))
        if prev is not None:
            (xa, za), (xb, zb) = prev, cur
            k = len(b.verts)
            y0, y1 = WALL_S + 0.01, WALL_N - 0.01
            t = 0.020
            b.verts += [(xa, y0, za - t), (xb, y0, zb - t), (xb, y1, zb - t), (xa, y1, za - t),
                        (xa, y0, za), (xb, y0, zb), (xb, y1, zb), (xa, y1, za)]
            b.faces += [tuple(k + i for i in f) for f in hq_lib.BOX_FACES]
            n += 1
        prev = cur
        x += step
    return n


def _lines(hous, lamp, z_at):
    """경사를 따라 흐르는 라인 조명. 0.8 m 마디로 끊어 놓아도 이어져 보인다."""
    n = 0
    for y in LIGHT_ROWS:
        x = X0
        while x < X1 - STEP:
            za, zb = z_at(x), z_at(x + STEP)
            lo, hi = min(za, zb), max(za, zb)
            hous.box(x, y - 0.17, lo - 0.13, x + STEP, y + 0.17, hi)
            lamp.box(x + 0.02, y - 0.13, lo - 0.155,
                     x + STEP - 0.02, y + 0.13, lo - 0.095)
            x += STEP
            n += 1
    return n


def _ribs(b, z_at):
    """소핏 가로 리브. 12 m 짜리 민판에 거리 눈금을 준다."""
    n = 0
    x = X0 + RIB_PITCH / 2
    while x < X1 - 0.2:
        z = z_at(x)
        b.box(x - 0.10, WALL_S + 0.02, z - 0.08, x + 0.10, WALL_N - 0.02, z)
        x += RIB_PITCH
        n += 1
    return n


def _walls(panel, band, z_at):
    """벽 세로 홈 + 상부·허리 띠. 높이는 전부 소핏에서 내려 잡는다."""
    n = 0
    for wy, sgn in ((WALL_S, +1), (WALL_N, -1)):
        x = X0
        while x < X1:
            z = z_at(x)
            _put(panel, wy, sgn, x, x + 0.045, z - 3.10, z - 0.10, 0.0, 0.020)
            x += REVEAL_PITCH
            n += 1
        _sloped(band, wy, sgn, BAND_DROP[0], BAND_DROP[1], z_at)
    return n


def _put(b, wy, sgn, x0, x1, z0, z1, d0, d1):
    n0, n1 = wy + sgn * d0, wy + sgn * d1
    b.box(x0, min(n0, n1), z0, x1, max(n0, n1), z1)


def _sloped(b, wy, sgn, d0, d1, z_at, step=1.15):
    """경사를 따라 한 줄로 흐르는 띠.

    구간마다 축정렬 상자를 다시 놓으면 벽에 계단 모양 덩어리가 붙는다.
    검증된 상자 감김을 그대로 쓰되 z 만 x 마다 다르게 준 **사다리꼴 프리즘**으로 잇는다.
    (`hq_descent._sloped_band` 와 같은 이유·같은 방법)
    """
    ys = sorted((wy, wy + sgn * 0.045))
    x = X0
    prev = None
    while x <= X1:
        z = z_at(x)
        cur = (x, z - d1, z - d0)
        if prev is not None:
            (xa, ba, ta), (xb, bb, tb) = prev, cur
            k = len(b.verts)
            b.verts += [(xa, ys[0], ba), (xb, ys[0], bb), (xb, ys[1], bb), (xa, ys[1], ba),
                        (xa, ys[0], ta), (xb, ys[0], tb), (xb, ys[1], tb), (xa, ys[1], ta)]
            b.faces += [tuple(k + i for i in f) for f in hq_lib.BOX_FACES]
        prev = cur
        x += step


build()
