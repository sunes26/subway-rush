"""패스 B — 벽면 패널화와 광고 라이트박스.

홍대입구역 2호선 승강장 실사를 보면 벽에서 **비어 있는 부분이 거의 없다.**
스크린도어 사이사이가 전부 대형 라이트박스이고, 그 위아래로 띠와 걸레받이가 흐른다.
지금 우리 벽은 정반대다 — Z5 남벽 588 m²가 6면짜리 상자이고 그 위에 갈색 띠 하나.
1인칭으로 서면 "칠하다 만 복도"로 읽힌다.

여기서 벽마다 여섯 층을 올린다.

    걸레받이 → 하부 패널 리빌 → 광고 라이트박스 배열 → 상부 띠
    → 벽 패널 분할 → 코니스

**부착물이 이미 있는 구간은 피한다.** 계단 입구·상가·화장실 위에 광고를 얹으면
벽에 박힌 판이 된다. 벽 앞 1.4 m 안에 있는 오브젝트의 폭을 실측해 그 구간을 비운다 —
좌표를 손으로 적으면 반드시 빠뜨린다.
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

# (컬렉션, 태그, 축, 내면 좌표, 법선 부호, 진행 시작, 진행 끝, 바닥 z, 천장 z,
#  광고 하단 z, 광고 상단 z, 개구부)
#
# 광고 높이대는 계산으로 뽑지 않고 못박는다. Z5는 -17.38 에 노선색 띠가 이미
# 흐르고 있어서, 자동 계산값(-17.10)이 그 위로 올라타 서로 잡아먹었다.
#
# 개구부는 **비어 있어서** 계측으로 안 잡힌다. Z3 동벽의 y 2~12 는 Z4 통로
# 입구인데 아무 오브젝트가 없어 광고가 통로를 통째로 막았다.
WALLS = [
    ("Z5_PLATFORM", "Z5wS", "y",  0.00, +1, 78.0, 206.0, -20.0, -15.5,
     -19.10, -17.45, ()),
    ("Z5_PLATFORM", "Z5wN", "y", 30.00, -1, 78.0, 206.0, -20.0, -15.5,
     -19.10, -17.45, ()),
    ("Z2_CONCOURSE", "Z2wS", "y",  0.00, +1,  0.0,  56.0, -6.0, -2.8,
     -5.05, -3.55, ()),
    ("Z2_CONCOURSE", "Z2wN", "y", 30.00, -1,  0.0,  56.0, -6.0, -2.8,
     -5.05, -3.55, ()),
    ("Z2_CONCOURSE", "Z2wW", "x",  0.00, +1,  0.0,  30.0, -6.0, -2.8,
     -5.05, -3.55, ((24.5, 30.0),)),
    ("Z3_GATES", "Z3wS", "y",  0.00, +1, 56.0, 72.0, -6.0, -2.8,
     -5.05, -3.55, ()),
    # 개찰구 서쪽(x56~61)은 벽으로 막고, 그 동쪽(x61~72)은 반대 방면 통로
    # 연결부라 뚫어 둔다(디렉터 지시). `world.ts`의 Z3-N 충돌도 같은 x61 경계로
    # 맞춘다 — 시각·충돌이 어긋나면 안 보이는데 막히거나, 보이는데 안 막히는
    # 사고가 난다.
    #
    # ⚠ 예전엔 빌드 뒤 손으로 `xx_Z3_wall_N` 개명해 벽 전체(x56~72)를 지웠는데,
    #   그건 스크립트가 아니라 한 번 손댄 결과라 다음 리빌드에서 그대로
    #   되살아났다(실제로 그랬다). 개구부를 여기 표에 박아 멱등으로 만든다 —
    #   서쪽 벽은 리빌드해도 그대로 남는다.
    ("Z3_GATES", "Z3wN", "y", 32.00, -1, 56.0, 72.0, -6.0, -2.8,
     -5.05, -3.55, ((61.0, 72.0),)),
    ("Z3_GATES", "Z3wE", "x", 72.00, -1,  0.0,  32.0, -6.0, -2.8,
     -5.05, -3.55, ((1.4, 12.6),)),
    ("Z4_DESCENT", "Z4wS", "y",  2.00, +1, 72.0, 96.0, -6.0, -2.8,
     -5.05, -3.55, ()),
    # 북벽은 y 12.0 이다 — 부록 A 의 통로는 (72,2)→(96,12) 이고 충돌도 그렇다
    # (`world.ts` 의 `Z4-UPPER [72,2,95.8,12]` · `Z4-COR-N [72,12.0,95.8,12.4]`).
    # 9.60 으로 잡혀 있었는데, 그건 **하강부**(x 95.8~120.4)의 북측 난간 y 다.
    # 그래서 마감 벽 한 장이 통로 안으로 2.4 m 들어와 서 있었고, 거기 붙은 광고
    # 라이트박스가 통로 한복판에 튀어나온 것처럼 보였다.
    ("Z4_DESCENT", "Z4wN", "y", 12.00, -1, 72.0, 96.0, -6.0, -2.8,
     -5.05, -3.55, ()),
]

# 새 마감이 자리를 차지하면서 쓸모없어진 옛 오브젝트.
# 삭제는 하지 않는다 — `objects.remove()` 직후 전체 순회가 Blender를 두 번 죽였다.
# `xx_` 개명 + `hide_render` 가 이 프로젝트의 사실상 삭제 규약이다.
RETIRED = ("Z5_wall_ad",)

# 이 패스가 스스로 만들었다가 구성이 바뀌면서 이름이 달라진 것들.
# 남겨 두면 옛 단색 판이 새 포스터 **앞에** 서서 전부 백판으로 보인다 —
# 실제로 이것 때문에 한 번 헛돌았다.
RETIRED_PATTERNS = ("_hq_adface",)

AD_PITCH = 2.60          # 라이트박스 중심 간격
AD_W = 1.90              # 프레임 바깥 폭
FRAME = 0.075            # 프레임 두께
SKIRT_H = 0.13
CLEAR = 1.40             # 이 거리 안의 오브젝트가 있으면 그 구간은 비운다

# 라이트박스 한 장은 색 하나가 아니다.
# 단색 발광면으로 뽑았더니 강도 2.6에서 전부 하얗게 날아가 "빈 백판"이 됐다.
# 게임은 텍스처를 안 쓰므로 포스터의 정보량은 **지오메트리로** 만들어야 한다 —
# 바탕 · 상단 이미지 블록 · 하단 카피 바 · 세로 악센트 · 로고. 다섯 조각이면
# 멀리서 광고로 읽힌다. 발광은 색이 살아남는 1.1까지만 올린다.
AD_TINTS = [
    ((0.10, 0.22, 0.58), (0.86, 0.91, 0.99), (0.05, 0.09, 0.24)),   # 파랑 — 실사 최빈
    ((0.66, 0.14, 0.21), (0.99, 0.86, 0.72), (0.22, 0.04, 0.06)),
    ((0.09, 0.40, 0.31), (0.90, 0.97, 0.86), (0.03, 0.14, 0.10)),
    ((0.90, 0.74, 0.20), (0.35, 0.30, 0.24), (0.20, 0.16, 0.05)),
    ((0.34, 0.17, 0.48), (0.95, 0.88, 0.99), (0.12, 0.05, 0.19)),
    ((0.95, 0.95, 0.93), (0.20, 0.44, 0.82), (0.10, 0.11, 0.13)),
]


def _bounds(o):
    cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return (min(c.x for c in cs), min(c.y for c in cs), min(c.z for c in cs),
            max(c.x for c in cs), max(c.y for c in cs), max(c.z for c in cs))


# 벽 자신과 마감층은 벽 앞 1.4 m 안에 있지만 **장애물이 아니다.**
# 이걸 안 걸렀더니 벽 전체가 한 구간으로 병합돼 광고가 열 장도 안 붙었다.
SHELL = ("wall", "floor", "ceil", "platform", "band", "skirt", "tact", "joint",
         "cornice", "trim", "psd", "safety", "decal", "_hq_", "corridor", "road",
         "sidewalk", "trackwall", "railx", "grid", "spandrel")


def occupied(axis, at, normal, a0, a1, z0, z1):
    """벽 앞을 이미 차지한 구간을 실측한다.

    벽면에서 법선 방향 `CLEAR` 안에 걸치고, 광고가 놓일 높이대와 겹치는
    오브젝트의 진행축 범위를 모은다. 계단 입구·상가·화장실·역무실이 여기서 잡힌다.

    구조체와 마감층은 뺀다. 또 진행 구간의 40 % 넘게 걸치는 것도 뺀다 —
    그런 것은 장애물이 아니라 벽 자체다.
    """
    spans = []
    lo, hi = (at, at + normal * CLEAR) if normal > 0 else (at + normal * CLEAR, at)
    limit = (a1 - a0) * 0.40
    for o in bpy.data.objects:
        if o.type != "MESH" or o.hide_render:
            continue
        low = o.name.lower()
        if low.startswith(("xx_", "crowd", "dbg")) or any(k in low for k in SHELL):
            continue
        bx0, by0, bz0, bx1, by1, bz1 = _bounds(o)
        if bz1 < z0 + 0.5 or bz0 > z1 - 0.2:
            continue
        n0, n1 = (by0, by1) if axis == "y" else (bx0, bx1)
        if n1 < lo or n0 > hi:
            continue
        p0, p1 = (bx0, bx1) if axis == "y" else (by0, by1)
        if p1 < a0 or p0 > a1 or (p1 - p0) > limit:
            continue
        spans.append((p0 - 0.30, p1 + 0.30))
    spans.sort()
    merged: list[list[float]] = []
    for s0, s1 in spans:
        if merged and s0 <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], s1)
        else:
            merged.append([s0, s1])
    return [tuple(m) for m in merged]


def free(a, half, spans):
    return all(a + half < s0 or a - half > s1 for s0, s1 in spans)


def segments(a0, a1, cuts):
    """`cuts` 구간을 뺀 나머지 자유 구간."""
    out, cur = [], a0
    for c0, c1 in sorted(cuts):
        if c1 <= cur:
            continue
        if c0 > cur:
            out.append((cur, min(c0, a1)))
        cur = max(cur, c1)
        if cur >= a1:
            break
    if cur < a1:
        out.append((cur, a1))
    return [s for s in out if s[1] - s[0] > 0.4]


def build():
    m_skirt = mat("HQ_W_SKIRT", (0.34, 0.35, 0.37), metallic=0.45, roughness=0.35)
    m_panel = mat("HQ_W_PANEL", (0.895, 0.885, 0.855), roughness=0.55)
    m_reveal = mat("HQ_W_REVEAL", (0.44, 0.44, 0.43), roughness=0.7)
    m_frame = mat("HQ_AD_FRAME", (0.17, 0.18, 0.20), metallic=0.5, roughness=0.35)
    m_corn = mat("HQ_W_CORNICE", (0.80, 0.80, 0.78), roughness=0.5)
    ad_mats = []
    for i, (base, ink, deep) in enumerate(AD_TINTS):
        ad_mats.append((
            mat(f"HQ_AD{i}_bg", base, emit=base, strength=1.1, roughness=0.85),
            mat(f"HQ_AD{i}_ink", ink, emit=ink, strength=1.3, roughness=0.85),
            mat(f"HQ_AD{i}_deep", deep, emit=deep, strength=0.5, roughness=0.85),
        ))

    doomed = [bpy.data.objects.get(n) for n in RETIRED]
    doomed += [o for o in bpy.data.objects
               if any(p in o.name for p in RETIRED_PATTERNS)
               and not o.name.startswith("xx_")]
    for o in doomed:
        if o is None:
            continue
        o.name = "xx_" + o.name
        o.hide_render = True
        o.hide_viewport = True
        print(f"  폐기: {o.name[3:]}")

    total = 0
    for (coll_name, tag, axis, at, normal, a0, a1, zf, zc,
         ad_z0, ad_z1, openings) in WALLS:
        coll = zone_collection(coll_name)
        skirt = Batch(f"{tag}_hq_skirt", m_skirt)
        panel = Batch(f"{tag}_hq_panel", m_panel)
        reveal = Batch(f"{tag}_hq_reveal", m_reveal)
        frame = Batch(f"{tag}_hq_adframe", m_frame)
        corn = Batch(f"{tag}_hq_cornice", m_corn)
        faces = []
        for i, trio in enumerate(ad_mats):
            faces.append((Batch(f"{tag}_hq_ad{i}bg", trio[0]),
                          Batch(f"{tag}_hq_ad{i}ink", trio[1]),
                          Batch(f"{tag}_hq_ad{i}deep", trio[2])))

        spans = occupied(axis, at, normal, a0, a1, zf, zc) + list(openings)
        spans.sort()

        # 개구부는 벽이 아예 없는 곳이다. 걸레받이·패널·코니스까지 끊어야 한다 —
        # 광고만 비우면 통로 한가운데에 몰딩이 떠 있게 된다.
        for s0, s1 in segments(a0, a1, openings):
            _skirt(skirt, axis, at, normal, s0, s1, zf)
            _panels(panel, reveal, axis, at, normal, s0, s1, zf, zc, ad_z0, ad_z1)
            _cornice(corn, axis, at, normal, s0, s1, zc)
            # 마주 보는 두 벽이 같은 시드로 시작하면 광고가 좌우 대칭으로 똑같이
            # 반복돼 복도가 벽지처럼 보인다. 벽 이름으로 시작 색을 어긋낸다.
            _ads(frame, faces, axis, at, normal, s0, s1, ad_z0, ad_z1, spans,
                 seed0=sum(ord(c) for c in tag))

        flat = [b for trio in faces for b in trio]
        for b in (skirt, panel, reveal, frame, corn, *flat):
            ob = b.build(coll)
            if ob:
                total += len(ob.data.polygons)
        print(f"  {tag}: 비운 구간 {len(spans)}개")
    print(f"[hq_walls] 면 {total:,}개 추가")


# ── 층별 ─────────────────────────────────────────────────────────
def _put(b, axis, at, normal, p0, p1, z0, z1, d0, d1):
    """벽 진행축(p)·높이(z)·돌출(d)로 상자를 놓는다. d는 내면 기준 법선 거리."""
    n0, n1 = at + normal * d0, at + normal * d1
    if axis == "y":
        b.box(p0, min(n0, n1), z0, p1, max(n0, n1), z1)
    else:
        b.box(min(n0, n1), p0, z0, max(n0, n1), p1, z1)


def _skirt(b, axis, at, normal, a0, a1, zf):
    _put(b, axis, at, normal, a0, a1, zf, zf + SKIRT_H, -0.005, 0.035)


def _panels(pan, rev, axis, at, normal, a0, a1, zf, zc, ad_z0, ad_z1):
    """벽을 1.3 m 모듈로 나눈다. 홈이 있어야 큰 면이 면으로 안 읽힌다."""
    # 하부(걸레받이~광고) · 상부(광고~코니스) 두 띠를 얕게 덧대 리빌을 만든다
    for z0, z1 in ((zf + SKIRT_H, ad_z0 - 0.05), (ad_z1 + 0.05, zc - 0.22)):
        if z1 - z0 < 0.12:
            continue
        _put(pan, axis, at, normal, a0, a1, z0, z1, -0.004, 0.016)
    for p in frange(a0, a1, 1.30):
        if p <= a0 or p >= a1:
            continue
        _put(rev, axis, at, normal, p - 0.012, p + 0.012, zf + SKIRT_H, zc - 0.22,
             -0.004, 0.020)
    _put(rev, axis, at, normal, a0, a1, ad_z1 + 0.06, ad_z1 + 0.14, -0.004, 0.030)


def _ads(fr, faces, axis, at, normal, a0, a1, z0, z1, spans, seed0=0):
    half = AD_W / 2
    n = int((a1 - a0 - 1.0) / AD_PITCH)
    start = a0 + ((a1 - a0) - (n - 1) * AD_PITCH) / 2
    k = seed0
    for i in range(n):
        c = start + i * AD_PITCH
        if c - half < a0 or c + half > a1 or not free(c, half + 0.15, spans):
            continue
        # 프레임 — 네 변을 따로 놓아야 안쪽이 함몰돼 보인다
        fr_d = (0.02, 0.115)
        _put(fr, axis, at, normal, c - half, c - half + FRAME, z0, z1, *fr_d)
        _put(fr, axis, at, normal, c + half - FRAME, c + half, z0, z1, *fr_d)
        _put(fr, axis, at, normal, c - half, c + half, z0, z0 + FRAME, *fr_d)
        _put(fr, axis, at, normal, c - half, c + half, z1 - FRAME, z1, *fr_d)
        _poster(faces[k % len(faces)], axis, at, normal,
                c - half + FRAME, c + half - FRAME, z0 + FRAME, z1 - FRAME, k)
        k += 1


def _poster(trio, axis, at, normal, p0, p1, z0, z1, seed):
    """라이트박스 한 장의 판면 구성.

    바탕 위에 블록을 얹되 **앞으로 조금씩 더 내밀어** 겹침이 z-파이팅으로 안 가게 한다.
    구성은 시드로 세 가지를 돌린다 — 전부 같으면 벽 전체가 벽지가 된다.
    """
    bg, ink, deep = trio
    w, h = p1 - p0, z1 - z0
    d = 0.070
    _put(bg, axis, at, normal, p0, p1, z0, z1, 0.020, d)

    kind = seed % 3
    if kind == 0:            # 상단 이미지 · 하단 카피
        _put(ink, axis, at, normal, p0 + w * .06, p1 - w * .06,
             z0 + h * .38, z1 - h * .08, d, d + 0.008)
        _put(deep, axis, at, normal, p0 + w * .06, p0 + w * .74,
             z0 + h * .18, z0 + h * .30, d, d + 0.008)
        _put(deep, axis, at, normal, p0 + w * .06, p0 + w * .52,
             z0 + h * .07, z0 + h * .14, d, d + 0.008)
    elif kind == 1:          # 좌측 세로 이미지 · 우측 카피
        _put(ink, axis, at, normal, p0 + w * .05, p0 + w * .48,
             z0 + h * .07, z1 - h * .07, d, d + 0.008)
        for i in range(4):
            _put(deep, axis, at, normal, p0 + w * .55, p1 - w * .07 - w * .06 * i,
                 z1 - h * (.20 + .16 * i), z1 - h * (.13 + .16 * i), d, d + 0.008)
    else:                    # 큰 로고 원 · 상하 띠
        _put(deep, axis, at, normal, p0, p1, z1 - h * .16, z1, d, d + 0.008)
        _put(deep, axis, at, normal, p0, p1, z0, z0 + h * .12, d, d + 0.008)
        _fan(ink, axis, at, normal, (p0 + p1) / 2, (z0 + z1) / 2,
             min(w, h) * 0.26, d + 0.008)


def _fan(b, axis, at, normal, cu, cv, r, depth, seg=20):
    """판면 위의 원. 한 면짜리라 감김을 직접 맞춰야 한다.

    (u, v) 반시계 삼각형의 법선은 축마다 부호가 반대다 —
    y벽에서는 −y, x벽에서는 +x. 이걸 한 규칙으로 뭉뚱그리면 절반이 안 보인다.
    """
    n0 = at + normal * depth
    ccw_normal = -1 if axis == "y" else +1
    flip = (ccw_normal != normal)
    for i in range(seg):
        a = 2 * math.pi * i / seg
        c = 2 * math.pi * (i + 1) / seg
        pts = [(cu, cv), (cu + math.cos(a) * r, cv + math.sin(a) * r),
               (cu + math.cos(c) * r, cv + math.sin(c) * r)]
        tri = [(u, n0, v) for u, v in pts] if axis == "y" else [(n0, u, v) for u, v in pts]
        b.quad(list(reversed(tri)) if flip else tri)


def _cornice(b, axis, at, normal, a0, a1, zc):
    """천장 접합부 몰딩. 두 단으로 꺾어야 벽과 천장이 그냥 만나지 않는다."""
    _put(b, axis, at, normal, a0, a1, zc - 0.22, zc - 0.10, -0.004, 0.075)
    _put(b, axis, at, normal, a0, a1, zc - 0.10, zc, -0.004, 0.135)


build()
