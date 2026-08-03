"""패스 C — 승강장 기둥 · 스크린도어 · 바닥 표시.

승강장 1인칭에서 화면을 채우는 것은 세 가지다. 왼쪽 스크린도어, 오른쪽 벽, 발밑 바닥.
벽은 패스 B에서 끝냈고, 여기서 나머지 둘과 기둥을 한다.

홍대입구역 2호선 실사에서 잰 것:

  * 기둥은 매끈한 원통이 아니다. **패널이 세로 2줄 · 가로 3단**으로 나뉘고
    이음새가 뚜렷하다. 바닥에 스테인리스 걸레받이, 위쪽 양옆에 검은 스피커 두 개.
  * 스크린도어 **하부가 통째로 광고 라이트박스**다. 이게 승강장에서 가장 밝은 면이고,
    지금 우리 것은 같은 자리가 짙은 남색 단색이라 통로가 어두컴컴해 보인다.
  * 바닥에는 승차위치 원형 표시가 줄줄이 있다 (레퍼런스 스크린샷 2·4·9에서도 같다).
    사람이 많으면 벽 사인이 가려져 **바닥만 보인다** — 그래서 바닥 정보가 촘촘하다.

기둥 중심은 좌표를 적지 않고 메시에서 군집으로 되짚는다. 손으로 적으면 계단 자리에서
빠진 한 본을 반드시 놓친다.
"""

from __future__ import annotations

import math
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

PLATFORM_Z = -20.0
PSD_Y = 12.00            # 승강장을 향하는 면
PSD_TOP = -17.80
COL_R = 0.55


def centers(obj_name, gap=1.5):
    """원기둥 묶음 메시에서 기둥 중심을 되짚는다."""
    o = bpy.data.objects.get(obj_name)
    if o is None:
        return []
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    out = []
    used = [False] * len(pts)
    for i, p in enumerate(pts):
        if used[i]:
            continue
        grp = [j for j, q in enumerate(pts)
               if not used[j] and abs(q.x - p.x) < gap and abs(q.y - p.y) < gap]
        for j in grp:
            used[j] = True
        out.append((sum(pts[j].x for j in grp) / len(grp),
                    sum(pts[j].y for j in grp) / len(grp)))
    # 같은 기둥이 여러 조각으로 갈릴 수 있어 한 번 더 뭉친다
    merged = []
    for c in sorted(out):
        if merged and abs(c[0] - merged[-1][0]) < gap and abs(c[1] - merged[-1][1]) < gap:
            merged[-1] = ((merged[-1][0] + c[0]) / 2, (merged[-1][1] + c[1]) / 2)
        else:
            merged.append(c)
    return merged


def build():
    m_seam = mat("HQ_COL_SEAM", (0.52, 0.53, 0.54), roughness=0.5)
    m_steel = mat("HQ_STEEL", (0.60, 0.62, 0.64), metallic=0.55, roughness=0.30)
    m_spk = mat("HQ_SPEAKER", (0.10, 0.10, 0.11), roughness=0.7)
    m_glass = mat("HQ_PSD_GLASS", (0.82, 0.89, 0.93), roughness=0.15)
    m_pframe = mat("HQ_PSD_MULL", (0.80, 0.81, 0.82), metallic=0.35, roughness=0.35)
    m_warn = mat("HQ_PSD_WARN", (0.95, 0.78, 0.10), roughness=0.6)
    m_dark = mat("HQ_PSD_DARK", (0.14, 0.15, 0.16), roughness=0.6)
    m_mark = mat("HQ_FLOOR_MARK", (0.42, 0.74, 0.66), roughness=0.55)
    m_markr = mat("HQ_FLOOR_MARK_R", (0.86, 0.86, 0.84), roughness=0.55)
    m_numb = mat("HQ_FLOOR_NUM", (0.20, 0.22, 0.24), roughness=0.6)

    coll = zone_collection("Z5_PLATFORM")
    coll2 = zone_collection("Z2_CONCOURSE")

    seam = Batch("Z5_hq_colseam", m_seam)
    steel = Batch("Z5_hq_colsteel", m_steel)
    spk = Batch("Z5_hq_colspeaker", m_spk)
    seam2 = Batch("Z2_hq_colseam", m_seam)
    steel2 = Batch("Z2_hq_colsteel", m_steel)
    spk2 = Batch("Z2_hq_colspeaker", m_spk)

    z5 = centers("Z5_colr_shaft")
    z2 = centers("Z2_colr_shaft")
    for cx, cy in z5:
        _column(seam, steel, spk, cx, cy, COL_R, PLATFORM_Z, -15.70)
    for cx, cy in z2:
        _column(seam2, steel2, spk2, cx, cy, COL_R, -6.00, -2.98)
    print(f"  기둥 Z5 {len(z5)}본 · Z2 {len(z2)}본")

    glass = Batch("Z5_hq_psdglass", m_glass)
    pfr = Batch("Z5_hq_psdmull", m_pframe)
    warn = Batch("Z5_hq_psdwarn", m_warn)
    pdark = Batch("Z5_hq_psddark", m_dark)
    ads = _psd_ads(pfr, pdark)
    _psd_doors(glass, pfr, warn, pdark)
    _spandrel(pfr, pdark)

    mark = Batch("Z5_hq_boardmark", m_mark)
    markr = Batch("Z5_hq_boardring", m_markr)
    numb = Batch("Z5_hq_boardnum", m_numb)
    _floor_marks(mark, markr, numb)

    total = 0
    for b in (seam, steel, spk, glass, pfr, warn, pdark, mark, markr, numb, *ads):
        ob = b.build(coll)
        if ob:
            total += len(ob.data.polygons)
    for b in (seam2, steel2, spk2):
        ob = b.build(coll2)
        if ob:
            total += len(ob.data.polygons)
    print(f"[hq_platform] 면 {total:,}개 추가")


# ── 기둥 ─────────────────────────────────────────────────────────
def _column(seam, steel, spk, cx, cy, r, z0, z1):
    """패널 이음새 · 스테인리스 걸레받이 · 스피커.

    이음새는 얇은 고리와 세로 리브로 만든다. 원통 표면에 홈을 파는 것보다
    **덧대는** 쪽이 감김 사고가 없고 실사에서도 이음새 몰딩이 튀어나와 있다.
    """
    h = z1 - z0
    for t in (0.34, 0.70):                           # 가로 2단
        z = z0 + h * t
        seam.ring(cx, cy, z - 0.012, z + 0.012, r, r + 0.014, seg=10)
    for k in range(2):                               # 세로 2분할
        a = math.pi / 4 + k * math.pi
        ux, uy = math.cos(a), math.sin(a)
        px, py = -uy, ux
        w = 0.016
        n = len(seam.verts)
        for rr in (r, r + 0.012):
            for s in (-w, w):
                for z in (z0 + 0.42, z1 - 0.12):
                    seam.verts.append((cx + ux * rr + px * s, cy + uy * rr + py * s, z))
        # 8정점 상자 (rr,s,z 순서 → 0..7)
        for f in ((0, 1, 3, 2), (5, 4, 6, 7), (4, 5, 1, 0),
                  (6, 4, 0, 2), (7, 6, 2, 3), (5, 7, 3, 1)):
            seam.faces.append(tuple(n + i for i in f))
    steel.ring(cx, cy, z0 + 0.005, z0 + 0.10, r + 0.002, r + 0.020, seg=10)
    steel.ring(cx, cy, z1 - 0.10, z1 - 0.005, r + 0.002, r + 0.020, seg=10)
    for sgn in (-1, 1):                              # 스피커 두 개
        sx, sy = cx + sgn * (r + 0.05), cy
        spk.box(sx - 0.055, sy - 0.10, z1 - 0.75, sx + 0.055, sy + 0.10, z1 - 0.42)
        spk.box(sx - 0.075 * sgn, sy - 0.07, z1 - 0.72, sx + 0.02 * sgn, sy + 0.07,
                z1 - 0.45)


# ── 스크린도어 ───────────────────────────────────────────────────
def _panels(prefix):
    out = []
    for o in bpy.data.objects:
        if not o.name.startswith(prefix) or o.type != "MESH":
            continue
        cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
        out.append((min(c.x for c in cs), max(c.x for c in cs)))
    return sorted(out)


def _psd_ads(fr, dark):
    """고정 패널 하부를 광고 라이트박스로. 홍대입구역 승강장의 가장 밝은 면이다."""
    tints = [((0.12, 0.24, 0.60), (0.88, 0.92, 1.00)),
             ((0.70, 0.16, 0.24), (1.00, 0.90, 0.78)),
             ((0.10, 0.42, 0.33), (0.92, 0.98, 0.90)),
             ((0.93, 0.78, 0.22), (0.24, 0.20, 0.16))]
    batches = []
    for i, (base, ink) in enumerate(tints):
        # 발광을 1.6까지 올렸더니 색이 날아가 분홍 백판이 됐다. 1.0 전후가
        # "라이트박스인데 색이 보이는" 지점이다.
        batches.append((Batch(f"Z5_hq_psdad{i}bg",
                              mat(f"HQ_PSDAD{i}_bg", base, emit=base, strength=1.0)),
                        Batch(f"Z5_hq_psdad{i}ink",
                              mat(f"HQ_PSDAD{i}_ink", ink, emit=ink, strength=1.2))))
    z0, z1 = PLATFORM_Z + 0.28, PLATFORM_Z + 1.62
    k = 0
    for x0, x1 in _panels("Z5_psd_fix_"):
        if x1 - x0 < 1.1:
            continue
        m = 0.13
        fr.box(x0 + m - 0.05, PSD_Y - 0.055, z0 - 0.05,
               x1 - m + 0.05, PSD_Y - 0.005, z1 + 0.05)
        bg, ink = batches[k % len(batches)]
        bg.box(x0 + m, PSD_Y - 0.075, z0, x1 - m, PSD_Y - 0.050, z1)
        w = (x1 - m) - (x0 + m)
        ink.box(x0 + m + w * .08, PSD_Y - 0.082, z0 + (z1 - z0) * .42,
                x1 - m - w * .08, PSD_Y - 0.074, z1 - (z1 - z0) * .08)
        ink.box(x0 + m + w * .08, PSD_Y - 0.082, z0 + (z1 - z0) * .14,
                x0 + m + w * .62, PSD_Y - 0.074, z0 + (z1 - z0) * .26)
        k += 1
    print(f"  스크린도어 광고 {k}장")
    return [b for pair in batches for b in pair]


def _psd_doors(glass, fr, warn, dark):
    """도어 유리 · 중앙 맞댐 · 하부 경고띠 · 손잡이."""
    for x0, x1 in _panels("Z5_psd_door_"):
        cx = (x0 + x1) / 2
        glass.box(x0 + 0.06, PSD_Y - 0.035, PLATFORM_Z + 0.14,
                  x1 - 0.06, PSD_Y - 0.015, PSD_TOP - 0.16)
        for e in (x0, x1 - 0.06):                     # 문틀 세로
            fr.box(e, PSD_Y - 0.055, PLATFORM_Z + 0.02, e + 0.06, PSD_Y + 0.02, PSD_TOP)
        fr.box(cx - 0.022, PSD_Y - 0.055, PLATFORM_Z + 0.02,
               cx + 0.022, PSD_Y + 0.02, PSD_TOP)     # 중앙 맞댐
        fr.box(x0, PSD_Y - 0.055, PSD_TOP - 0.10, x1, PSD_Y + 0.02, PSD_TOP)
        warn.box(x0 + 0.06, PSD_Y - 0.055, PLATFORM_Z + 0.02,
                 x1 - 0.06, PSD_Y - 0.030, PLATFORM_Z + 0.14)
        dark.box(cx - 0.30, PSD_Y - 0.060, PSD_TOP - 0.36, cx - 0.06,
                 PSD_Y - 0.048, PSD_TOP - 0.20)       # 픽토그램 자리
        dark.box(cx + 0.06, PSD_Y - 0.060, PSD_TOP - 0.36, cx + 0.30,
                 PSD_Y - 0.048, PSD_TOP - 0.20)


def _spandrel(fr, dark):
    """스크린도어 위 208 m² 를 모듈로 나눈다. 지금은 6면짜리 회색 한 장이다."""
    z0, z1 = -17.13, -15.50
    for x in frange(78.0, 206.0, 1.60):
        fr.box(x - 0.020, PSD_Y - 0.070, z0 + 0.06, x + 0.020, PSD_Y - 0.045, z1 - 0.06)
    fr.box(78.0, PSD_Y - 0.075, z0 + 0.02, 206.0, PSD_Y - 0.045, z0 + 0.10)
    fr.box(78.0, PSD_Y - 0.075, z1 - 0.14, 206.0, PSD_Y - 0.045, z1 - 0.02)
    for x in frange(80.0, 204.0, 16.0):               # 간접조명 코브
        dark.box(x - 3.2, PSD_Y - 0.090, z0 + 0.55, x + 3.2, PSD_Y - 0.070, z0 + 1.05)


# ── 바닥 표시 ────────────────────────────────────────────────────
def _floor_marks(mark, ring, numb):
    """승차위치 표시.

    문 하나마다 발밑에 원형 표시와 대기 화살표가 있다. 열차 문 위치(`Z5_psd_door_*`)에서
    직접 x를 읽어야 어긋나지 않는다 — 등간격으로 찍으면 문 사이에 표시가 놓인다.
    """
    # 유도블록(z −19.974)보다 위로 올려야 한다. 처음에 −19.994 에 뒀더니
    # 유도블록 밑에 깔려 한 장도 안 보였다.
    z = PLATFORM_Z + 0.030
    cy = 9.80                                          # 경고블록(y 10.55~) 안쪽
    n = 0
    for x0, x1 in _panels("Z5_psd_door_"):
        cx = (x0 + x1) / 2
        mark.disc(cx, cy, z, 0.46, seg=24)
        ring.disc(cx, cy, z + 0.003, 0.33, seg=24)
        mark.disc(cx, cy, z + 0.006, 0.20, seg=20)
        for s in (-1, 1):                              # 대기 두 줄 화살표
            for k in range(3):
                y = 8.20 - k * 0.66
                ax = cx + s * 0.78
                # xy 반시계가 위(+z)를 향한다. 뒤집으면 바닥을 향해 안 보인다.
                mark.quad([(ax - 0.22, y - 0.28, z), (ax + 0.22, y - 0.28, z),
                           (ax, y + 0.18, z)])
        numb.box(cx - 0.26, cy - 0.86, z, cx + 0.26, cy - 0.72, z + 0.004)
        n += 1
    print(f"  승차위치 {n}곳")


build()
