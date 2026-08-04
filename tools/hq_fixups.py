"""패스 L — 플레이 중 눈으로 잡힌 결함 수정. `hq_all.py` 의 마지막 마감 단계.

전부 실제로 걸어 보고 나온 것들이다. 좌표는 전부 실측했다.

  1. **전광판이 멀리서 사라진다** — 글자 높이 0.17 m 에 문안 14자, 압출 2 mm.
     원거리에서 획이 서브픽셀이 되어 반짝이다 없어진다(z-파이팅이 아니다 —
     글자는 화면보다 13 mm 앞에 있어 여유가 충분하다).
     → 문안을 줄이고 키우고, **발광 바탕 띠**를 깐다. 글자가 안 읽히는 거리에서도
       "켜진 사인"으로는 읽혀야 한다.

  2. **지상 차양이 떠 있다** — `Z1_bld_can_7/8` 이 y 33.9 에서 끝나는데
     건물 앞면은 y 34.0 이다. 10 cm 가 비어 공중에 뜬 판이 된다.
     → 건물면까지 붙이고 브래킷을 단다.

  3. **계단통에 빛이 걸린다** — 대합실 천장 조명이 계단 개구부 **경계에서 잘려**
     그 끝동강이 계단 위에 뜬 것처럼 보인다. 실물에서도 바닥 개구부 가장자리에는
     조명을 안 붙인다.
     → 조명 계열만 개구부보다 한 뼘(0.9 m) 더 물러나게 다시 자른다.

  5. **입구에 상자가 있다** — 그레이박스 시절 `Z1_OBJ05_entrance` 가 들고 있던
     난간 보다. 계단통 위를 눈높이로 7.6 m 가로지른다. 아래를 받치는 것이 없다.
     → 보를 걷어내고, 그 위에 얹혀 있던 캐노피 기둥 6개를 땅까지 내린다.

  6. **출구번호 원판이 공중에 떠 있다** — 매다는 기둥이 없다.
     → 표지주를 세우고 원판·숫자를 그 위에 다시 앉힌다.

  7. **초록 띠가 기둥 없는 자리에 떠 있다** — 기둥 중심을 x·y 각각의 군집으로
     구해 **곱집합**으로 돌린 탓이다. 실제 기둥은 9개인데 띠는 12개가 나왔다.
     → 기둥 메시의 연결 요소에서 진짜 중심을 뽑아 다시 굽는다.
"""

from __future__ import annotations

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))
                if "__file__" in dir() else r"C:\Users\User\Documents\HACKERTON\tools")
import hq_lib                                    # noqa: E402
import importlib                                 # noqa: E402
importlib.reload(hq_lib)
from hq_lib import Batch, mat, zone_collection   # noqa: E402

FONT = "Malgun Gothic Bold"

# ── 1. 전광판 ────────────────────────────────────────────────────
# 화면은 x 1.66 m · z 0.49 m. 여기에 14자를 넣으면 한 자가 12 cm 도 안 된다.
# 방면만 남기고 키운다 — 승강장에서 알아야 하는 건 "어느 쪽 열차인가" 하나다.
PIDS_TEXT = "신도림 방면"
PIDS_SIZE = 0.30


def pids():
    m_txt = mat("HQ_PIDS_TXT", (1.0, 0.62, 0.10), emit=(1.0, 0.62, 0.10), strength=3.0)
    m_band = mat("HQ_PIDS_BAND", (0.42, 0.20, 0.02),
                 emit=(0.85, 0.38, 0.04), strength=1.1)
    band = Batch("Z5_hq_pids_band", m_band)

    n = 0
    for o in list(bpy.data.objects):
        if not o.name.startswith("Z5_pids_txt_") or o.type != "FONT":
            continue
        cu = o.data
        cu.body = ("◀ " if o.name.endswith("_N") else "▶ ") + PIDS_TEXT
        cu.size = PIDS_SIZE
        cu.materials.clear()
        cu.materials.append(m_txt)
        n += 1

    # 발광 바탕 띠 — 글자가 안 읽히는 거리에서도 사인이 켜져 있다는 것은 보인다.
    # 화면(y 6.0~6.6) 바로 앞에 얇게 깐다. 글자는 그보다 더 앞이라 안 가린다.
    for cx in (92.0, 124.0, 156.0, 188.0):
        for y, d in ((6.60, +1), (6.00, -1)):
            # 띠·케이스·문안 모두 `PIDS_*` 절대 좌표에서 나온다. 예전처럼
            # 한쪽만 상대 이동시키면 둘이 갈라져 띠가 공중에 남는다.
            band.box(cx - 0.78, y + d * 0.004, PIDS_BAND_Z[0],
                     cx + 0.78, y + d * 0.010, PIDS_BAND_Z[1])
    ob = band.build(zone_collection("Z5_PLATFORM"))
    print(f"  전광판 {n}개 문안 '{PIDS_TEXT}' {PIDS_SIZE} m · 바탕 띠 "
          f"{len(ob.data.polygons) if ob else 0}면")


# ── 2. 지상 차양 ─────────────────────────────────────────────────
BLD_FACE_Y = 34.00


def awnings():
    """건물 앞면까지 늘이고 브래킷을 단다. 지금은 10 cm 띄워 공중에 떠 있다."""
    m_br = mat("HQ_AWN_BRACKET", (0.42, 0.43, 0.45), metallic=0.4, roughness=0.5)
    br = Batch("Z1_hq_awn_bracket", m_br)
    n = 0
    for o in bpy.data.objects:
        if not o.name.startswith("Z1_bld_can_") or o.type != "MESH":
            continue
        cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
        y1 = max(c.y for c in cs)
        if y1 >= BLD_FACE_Y - 1e-4:
            continue
        # 메시 정점을 직접 늘인다 — 스케일을 쓰면 두께까지 같이 늘어난다
        inv = o.matrix_world.inverted()
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            if abs(w.y - y1) < 1e-3:
                w.y = BLD_FACE_Y
                v.co = inv @ w
        o.data.update()
        x0, x1 = min(c.x for c in cs), max(c.x for c in cs)
        z0, z1 = min(c.z for c in cs), max(c.z for c in cs)
        for t in (0.18, 0.5, 0.82):                    # 브래킷 세 개
            bx = x0 + (x1 - x0) * t
            br.box(bx - 0.035, min(c.y for c in cs), z0 - 0.42,
                   bx + 0.035, BLD_FACE_Y, z0)
        n += 1
    ob = br.build(zone_collection("Z1_GROUND"))
    print(f"  차양 {n}장을 건물면(y {BLD_FACE_Y})까지 붙이고 브래킷 "
          f"{len(ob.data.polygons) // 6 if ob else 0}개")


# ── 3. 계단 개구부에서 조명 물리기 ───────────────────────────────
# 개구부는 x 2.0~14.9 · y 25.4~30.05 다(`hq_punch_openings`). 조명만 한 뼘 더 물린다.
LIGHT_CLEAR = 0.90
LIGHT_LAYERS = ("_hq_troflight", "_hq_trof", "_hq_coveglow", "_hq_covelip",
                "ceil_lamp", "ceil_trof")


def light_setback():
    x0, y0, x1, y1 = 2.00 - LIGHT_CLEAR, 25.40 - LIGHT_CLEAR, 14.90 + LIGHT_CLEAR, 30.10
    z0, z1 = -3.60, -2.40
    coll = bpy.data.collections.get("Z2_CONCOURSE")
    if coll is None:
        return
    hit = removed = 0
    for o in coll.all_objects:
        if o.type != "MESH" or o.name.startswith("xx_"):
            continue
        if not any(k in o.name for k in LIGHT_LAYERS):
            continue
        mw, inv = o.matrix_world, o.matrix_world.inverted()
        bm = bmesh.new()
        bm.from_mesh(o.data)
        for co_w, no_w in ((Vector((x0, 0, 0)), Vector((1, 0, 0))),
                           (Vector((x1, 0, 0)), Vector((1, 0, 0))),
                           (Vector((0, y0, 0)), Vector((0, 1, 0)))):
            bmesh.ops.bisect_plane(
                bm, geom=list(bm.faces) + list(bm.edges) + list(bm.verts),
                plane_co=inv @ co_w, plane_no=(inv.to_3x3() @ no_w).normalized(),
                clear_inner=False, clear_outer=False)
        doomed = [f for f in bm.faces
                  if (lambda c: x0 <= c.x <= x1 and y0 <= c.y <= y1 and z0 <= c.z <= z1)
                  (mw @ f.calc_center_median())]
        if doomed:
            bmesh.ops.delete(bm, geom=doomed, context="FACES")
            bm.to_mesh(o.data)
            o.data.update()
            hit += 1
            removed += len(doomed)
        bm.free()
    print(f"  계단 개구부 조명 물리기: 오브젝트 {hit}개에서 면 {removed}개 제거")


# ── 4. 지상 계단 난간벽 ──────────────────────────────────────────
# 계단통 옆면(`Z1_st_wall`)이 지상 z=0 에서 끝난다. 그래서 계단 위에 걸린 캐노피가
# **받침 없이 뜬 판**으로 보인다 — 사용자가 "양 옆에 떠 있는 오브젝트"라고 지적한 것이다.
# 실제 지상 계단 입구에는 허리 높이 난간벽이 둘러져 있다.
STAIR_X0, STAIR_X1 = 2.00, 14.88
STAIR_Y = (25.10, 30.90)          # 계단벽 바깥면
PARAPET_H = 1.05
PARAPET_T = 0.22


def parapet():
    m_wall = mat("HQ_PARAPET", (0.72, 0.71, 0.68), roughness=0.6)
    m_cap = mat("HQ_PARAPET_CAP", (0.55, 0.56, 0.58), metallic=0.35, roughness=0.4)
    w = Batch("Z1_hq_parapet", m_wall)
    c = Batch("Z1_hq_parapet_cap", m_cap)
    for y, sgn in ((STAIR_Y[0], -1), (STAIR_Y[1], +1)):
        y0, y1 = sorted((y, y + sgn * PARAPET_T))
        w.box(STAIR_X0, y0, 0.0, STAIR_X1, y1, PARAPET_H)
        c.box(STAIR_X0 - 0.03, y0 - 0.03, PARAPET_H, STAIR_X1 + 0.03, y1 + 0.03,
              PARAPET_H + 0.06)
    # 계단 머리쪽 마구리 — 지상에서 보면 여기가 입구 문틀 구실을 한다
    for y, sgn in ((STAIR_Y[0], -1), (STAIR_Y[1], +1)):
        y0, y1 = sorted((y, y + sgn * PARAPET_T))
        w.box(STAIR_X1, y0, 0.0, STAIR_X1 + PARAPET_T, y1, PARAPET_H)
    w.box(STAIR_X1, STAIR_Y[0] - PARAPET_T, 0.0, STAIR_X1 + PARAPET_T,
          STAIR_Y[1] + PARAPET_T, PARAPET_H)
    c.box(STAIR_X1 - 0.03, STAIR_Y[0] - PARAPET_T - 0.03, PARAPET_H,
          STAIR_X1 + PARAPET_T + 0.03, STAIR_Y[1] + PARAPET_T + 0.03, PARAPET_H + 0.06)
    coll = zone_collection("Z1_GROUND")
    n = sum(len(b.build(coll).data.polygons) for b in (w, c))
    print(f"  계단 난간벽 (높이 {PARAPET_H} m) · 면 {n}개")


# ── 5. 입구를 가로지르는 난간 보 ─────────────────────────────────
# 플레이어가 (0.4, 27.5, 0.0) 에 서서 "역 입구에 상자가 있다 · 계단이어야 할 것 같다"
# 라고 지적한 것. 실측하면 `Z1_OBJ05_entrance` 안에 **연결 요소 두 덩어리**가 있다.
#
#   남측  x −0.896…6.721 · y 25.400…26.171 · z −2.043…1.625  (정점 54개)
#   북측  x −0.896…6.721 · y 29.832…30.604 · z −2.043…1.625
#
# 정점 x 값이 양 끝(−0.9 근처와 6.6 근처)에만 있다 — 가운데가 비어 있는 **보**다.
# 몸통은 z 1.454…1.625 (두께 17 cm · 폭 77 cm) 로 7.6 m 를 건너지르고, 다리는
# 서쪽 하나(보도에 묻힘)와 x 6.53 하나뿐이다. 눈높이(1.62 m)에서 좌우 1.3 m 거리라
# 화면 절반을 시커먼 덩어리가 채운다. 그게 "상자"다.
#
# 난간은 이미 `parapet()` 이 y 24.88…25.10 · 높이 1.05 로 세워 두었다. 이 보는
# 계단통 **안쪽**(y > 25.40)에 있는 중복이고, 아래가 비어 떠 있다. 걷어낸다.
#
# 보 위에 캐노피 기둥 6개(x −0.362 · 2.908 · 6.178 × 남북, z 1.613…3.804)가 얹혀
# 있으므로 같이 처리한다 — 계단통 벽(`Z1_st_wall` y 25.10…25.40, 윗면 z 0) 위로
# 옮겨 땅까지 내린다. 계단 위에 그냥 내리면 이번엔 계단을 막는 기둥이 된다.
ENTR_OBJ = "Z1_OBJ05_entrance"
POST_Z0 = 1.613                  # 기둥 밑면 (보 윗면 1.625 에 얹혀 있던 높이)
POST_Y = {25.788: 25.30, 30.215: 30.70}   # 기둥 중심 y → 계단통 벽 위
POST_FOOT = -0.02                # 보도(−0.01)·계단벽 윗면(0.0) 아래로 살짝


def _islands(ob):
    """메시를 연결 요소로 쪼갠다. (면 목록, 월드 bbox) 를 돌려준다."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    mw = ob.matrix_world
    seen, out = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for e in cur.link_edges:
                ov = e.other_vert(cur)
                if ov.index not in seen:
                    seen.add(ov.index)
                    stack.append(ov)
        cs = [mw @ vv.co for vv in comp]
        out.append((bm, comp,
                    (min(c.x for c in cs), min(c.y for c in cs), min(c.z for c in cs),
                     max(c.x for c in cs), max(c.y for c in cs), max(c.z for c in cs))))
    return bm, out


def entrance_beam():
    ob = bpy.data.objects.get(ENTR_OBJ)
    if ob is None or ob.type != "MESH":
        return
    bm, comps = _islands(ob)
    doomed, moved = [], 0
    for _, comp, bb in comps:
        x0, y0, z0, x1, y1, z1 = bb
        # (a) 난간 보 — 길이 5 m 넘고, 윗면이 눈높이 아래(1.70)이며, 다리가 −1.9 까지 내려간다
        if (x1 - x0) > 5.0 and z1 < 1.70 and z0 < -1.9:
            doomed += [f for v in comp for f in v.link_faces]
            continue
        # (b) 계단통 안(x ≥ 1.98)에만 있는 낮은 조각 — 계단 위에 뜬 판·난간 동자
        #     캐노피 지붕(z 3.757~5.611)은 3.5 위라 걸리지 않는다
        if x0 >= 1.98 and z1 < 3.5:
            doomed += [f for v in comp for f in v.link_faces]
            continue
        # (c) 캐노피 기둥 — 보가 사라지면 뜬다. 계단통 벽 위로 옮겨 땅까지 내린다.
        #     밑면 z 로 알아본다. 한 번 내리면 z0 가 바뀌므로 다시 돌려도 안 겹친다.
        if abs(z0 - POST_Z0) < 0.02 and (x1 - x0) < 0.6:
            key = min(POST_Y, key=lambda k: abs(k - (y0 + y1) / 2))
            dy = POST_Y[key] - (y0 + y1) / 2
            inv = ob.matrix_world.inverted()
            for v in comp:
                w = ob.matrix_world @ v.co
                w.y += dy
                if abs(w.z - z0) < 0.02:
                    w.z = POST_FOOT
                v.co = inv @ w
            moved += 1
    if doomed:
        bmesh.ops.delete(bm, geom=list(set(doomed)), context="FACES")
    if doomed or moved:
        bm.to_mesh(ob.data)
        ob.data.update()
    bm.free()
    print(f"  입구 난간 보 철거: 면 {len(set(doomed))}개 · 캐노피 기둥 {moved}개 접지")


# ── 5b. 입구를 가로막던 가로 판 ──────────────────────────────────
# 난간 보를 걷어낸 뒤에도 입구 앞에 **수평 판이 두 장** 남아 있었다.
# 섬으로 쪼개서 재면
#     x −0.69…−0.21 · y 25.87…30.00 · z 0.54…0.57   (허리 높이)
#     x −0.69…−0.21 · y 25.87…30.00 · z 0.20…0.23   (정강이 높이)
# 폭 4.13 m 짜리 판이 두께 3 cm 로 입구 어귀를 가로지른다. 받치는 것이 없어
# 내려다보면 **인도 위에 뜬 판**으로 읽힌다 — 디렉터가 지적한 그 오브젝트다.
#
# 그런데 이 둘만 지우면 안 된다. 인방(`Z1_entr_lintel`, z 2.55…3.83)을 받치는
# 세로 핀 두 개가 **z 0.55 에서 시작한다** — 아래를 가로 판에 얹어 둔 셈이라
# 판이 사라지면 인방째로 허공에 뜬다. 핀을 지면(z 0)까지 내려 문설주로 만든다.
# 그래야 바깥 모서리 기둥 + 문설주 + 인방으로 **문틀**이 성립한다.
BAR_X = (-0.75, -0.15)           # 판·핀이 있는 x 구간
BAR_ZBOT = 0.10                  # **지면 위만** 잡는다. 이 하한이 없으면 같은 x·폭 조건에
                                 # 지하 소핏 조각(z −1.63)까지 걸려 천장에 구멍이 난다.
                                 # 실제로 한 번 지웠고, 아래 `entr_soffit()` 이 그걸 되살린다.
BAR_ZTOP = 0.60                  # 이 아래 있는 가로 판만 잡는다
BAR_SPAN = 3.0                   # 입구 폭(4.13 m)만 잡고 작은 조각은 남긴다
JAMB_FOOT = 0.0                  # 문설주가 닿아야 하는 지면

# 위 조건이 과하게 잡아 지워 버린 입구 목 소핏. 원래 `Z1_OBJ05_entrance` 의 섬이었고
# x 로 −0.55…−0.18 → −0.18…0.21 → 0.21…1.27 로 이어지는 계단식 천장의 **첫 칸**이다.
# 그 자리가 비면 입구 아래에서 올려다볼 때 천장이 뚫려 보인다.
# 이름이 붙은 별도 오브젝트로 다시 세운다 — Batch 는 같은 이름이면 메시만 갈아 끼우므로
# 몇 번을 돌려도 하나다(원래 섬처럼 지워질 일도 없다).
SOFFIT = (-0.55, 26.04, -1.64, -0.18, 30.29, -1.62)


def entrance_bars():
    ob = bpy.data.objects.get(ENTR_OBJ)
    if ob is None or ob.type != "MESH":
        return
    bm, comps = _islands(ob)
    doomed, grounded = [], 0
    for _, comp, bb in comps:
        x0, y0, z0, x1, y1, z1 = bb
        if not (BAR_X[0] < x0 and x1 < BAR_X[1]):
            continue
        # (a) 입구를 가로지르는 얇은 가로 판 — **지면 위**만
        if (y1 - y0) > BAR_SPAN and BAR_ZBOT < z0 and z1 < BAR_ZTOP:
            doomed += [f for v in comp for f in v.link_faces]
            continue
        # (b) 인방 받침 핀 — 판 위에 얹혀 있다. 지면까지 내린다.
        #     한 번 내리면 z0 가 0 이 되므로 다시 돌려도 조건에 안 걸린다(멱등).
        if (y1 - y0) < 0.2 and z1 > 3.0 and 0.3 < z0 < BAR_ZTOP:
            inv = ob.matrix_world.inverted()
            for v in comp:
                w = ob.matrix_world @ v.co
                if abs(w.z - z0) < 0.02:
                    w.z = JAMB_FOOT
                v.co = inv @ w
            grounded += 1
    if doomed:
        bmesh.ops.delete(bm, geom=list(set(doomed)), context="FACES")
    if doomed or grounded:
        bm.to_mesh(ob.data)
        ob.data.update()
    bm.free()
    print(f"  입구 가로 판 철거: 면 {len(set(doomed))}개 · 문설주 {grounded}개 접지")


def entr_soffit():
    """`entrance_bars` 가 과하게 잡아 지웠던 입구 목 천장 첫 칸을 세운다."""
    m = bpy.data.materials.get("MAT_ENTR")
    if m is None:
        print("  ! MAT_ENTR 없음 — 소핏 생략")
        return
    b = Batch("Z1_hq_entr_soffit", m)
    b.box(*SOFFIT)
    ob = b.build(zone_collection("Z1_GROUND"))
    print(f"  입구 목 소핏 복원: 면 {len(ob.data.polygons) if ob else 0}개")


# ── 6. 출구번호 원판 ─────────────────────────────────────────────
# `Z1_exitnum_disc0/1` 과 짝인 문자 `Z1_exitnum_txt0/1` 이 x 1.35·1.62 / y 25.62·25.28
# / z 2.185…2.415 에 떠 있었다. 바로 아래로 레이를 쏘면 각각 0.56 m · 2.20 m 아래까지
# 아무것도 없다 — 매다는 것이 없는 원판이다. 게다가 둘이 x 로 0.27, y 로 0.34 어긋나
# 앞뒤 한 쌍으로도 안 읽힌다.
#
# 실물 지하철 출구에는 계단 어귀에 **출구번호 표지주**가 선다. 그걸 세우고 원판을
# 그 위에 앞뒤로 앉힌다. 숫자는 입구 사인(`Z1_entr_exitno`)과 같은 "1" 로 맞춘다 —
# 원판만 4번이면 같은 입구가 두 번호를 달게 된다.
EXITPOST = (1.60, 25.20)         # 계단통 서쪽 어귀 · 난간(x 2.00 부터) 앞
EXITPOST_R = 0.045
EXITPOST_H = 2.55
EXITDISC_Z = 2.30
EXIT_NO = "1"


def exit_number_post():
    steel = bpy.data.materials.get("ENTR_STEEL")
    if steel is None:                        # 씬에 없으면 새로 만들지 않고 포기
        return
    px, py = EXITPOST
    b = Batch("Z1_hq_exitpost", steel)
    b.tube("z", 0.0, EXITPOST_H, px, py, EXITPOST_R, seg=10)
    b.tube("z", 0.0, 0.03, px, py, EXITPOST_R * 2.4, seg=10)     # 바닥 플랜지
    b.build(zone_collection("Z1_GROUND"))

    n = 0
    for i, sgn in ((0, -1), (1, +1)):        # disc0 = −y 면 · disc1 = +y 면
        d = bpy.data.objects.get(f"Z1_exitnum_disc{i}")
        if d is not None:
            d.location = (px, py + sgn * 0.055, EXITDISC_Z)
            d.rotation_euler = (math.pi / 2, 0.0, 0.0 if sgn < 0 else math.pi)
            n += 1
        t = bpy.data.objects.get(f"Z1_exitnum_txt{i}")
        if t is not None and t.type == "FONT":
            t.data.body = EXIT_NO
            t.location = (px, py + sgn * 0.072, EXITDISC_Z)
            t.rotation_euler = (math.pi / 2, 0.0, 0.0 if sgn < 0 else math.pi)
    print(f"  출구번호 표지주 (x {px} · y {py} · h {EXITPOST_H}) · 원판 {n}장 재설치")


# ── 7. 대합실 기둥 초록 띠 ───────────────────────────────────────
# `build_details.z2_column_bands` 는 기둥 중심을 x 군집 × y 군집의 **곱집합**으로 만든다.
# 실측하면 x 군집이 [12, 25, 36, 48] · y 군집이 [10, 16, 20] 이라 띠가 12개 나오는데,
# `Z2_colr_shaft` 의 연결 요소로 센 **진짜 기둥은 9개**다:
#   (12,10) (12,20) (24,10) (24,20) (26,16) (36,10) (36,20) (48,10) (48,20)
# x 24 와 26 이 0.9 m 밖에 안 떨어져 한 군집(25)으로 뭉친 것이 원인이다.
# 그래서 (12,16) (25,10) (25,16) (25,20) (36,16) (48,16) 여섯 개가 **기둥 없는 자리에**
# 지름 1.1 m 짜리 초록 고리로 떠 있었다 — 사용자가 지적한 네 지점이 전부 이 중 하나다.
# 반대로 (24,10) (24,20) (26,16) 세 기둥에는 띠가 없었다.
BAND_Z = (-4.62, -4.46)          # 기존 띠와 같은 높이 (굽도리 위 허리)
BAND_GAP = 0.006                 # 기둥 표면에서 띄우는 양 — z-파이팅 방지


def column_bands():
    grn = bpy.data.materials.get("LINE2_GRN")
    shaft = bpy.data.objects.get("Z2_colr_shaft")
    if grn is None or shaft is None:
        return
    bm, comps = _islands(shaft)
    b = Batch("Z2_DET_LINE2_GRN", grn)
    n = 0
    for _, _, bb in comps:
        x0, y0, _, x1, y1, _ = bb
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        r = (x1 - x0) / 2 + BAND_GAP
        b.tube("z", BAND_Z[0], BAND_Z[1], cx, cy, r, seg=12, cap=False)
        n += 1
    bm.free()
    ob = b.build(zone_collection("Z2_CONCOURSE"))
    # 정점을 월드 좌표로 쌓았으므로 오브젝트 변환은 항등이어야 한다.
    # 예전 메시가 오프셋을 물고 있으면 띠가 통째로 밀린 자리에 나온다.
    if ob is not None:
        ob.location = (0.0, 0.0, 0.0)
        ob.rotation_euler = (0.0, 0.0, 0.0)
        ob.scale = (1.0, 1.0, 1.0)
    print(f"  기둥 초록 띠 {n}개 (실제 기둥 수와 일치 · 곱집합 12개 → {n}개)")


# ── 8. 계단 난간동자 ─────────────────────────────────────────────
# `build_details.z4_stair_balusters` 는 난간 정점을 x 로 양자화해 밑면을 찾았다.
# 난간은 **회전된 상자**라 정점이 8개뿐이고 양자화 키도 8개뿐이라,
# 중간 구간이 전부 `min(키, |키−x|)` 로 **끝점의 z** 를 쓰게 됐다.
# 그 결과 동자 절반이 승강장 바닥(z≈−19.9)에 꽂히고 절반은 계단 위에 떠 있었다.
# (웹 픽: `STAIR_RAIL @[111.4, 9.3, −19.4]` — 계단은 x 113 부터 시작한다)
#
# build_details 는 ORDER 밖이라 그쪽 수정만으로는 blend 에 닿지 않는다.
# 여기서 같은 이름의 메시를 **레이로 다시 굽는다.**
# ⚠ 하강 계단의 **중앙 난간(y 6.70)은 넣지 않는다.** 동자까지 세우면 계단 한복판에
#    세로 격자가 서서, 위에서 내려다볼 때 계단 표면이 체크무늬로 덮인 것처럼 보인다
#    (디렉터 지적). 난간 자체도 `hide_rail_center()` 에서 익스포트에서 뺀다.
RAILS = (("Z4_st_rail_4.12", None, "Z4_st_stringL", "Z4_st_"),
         ("Z4_st_rail_9.28", None, "Z4_st_stringR", "Z4_st_"),
         # 지상 출입구 계단. 실사 출입구 사진에서 가장 눈에 띄는 것이 **촘촘한
         # 스테인리스 동자**인데 여기엔 핸드레일 세 줄만 있고 받치는 것이 없었다.
         # 난간 셋이 한 오브젝트에 들어 있어 y 를 직접 준다.
         ("Z1_st_rail", 25.75, None, "Z1_st_"),
         ("Z1_st_rail", 28.00, None, "Z1_st_"),
         ("Z1_st_rail", 30.25, None, "Z1_st_"))
POST_HALF = 0.024
POST_PITCH = 0.95                # 실사 동자 간격. 1.25 는 성기다
POST_MIN = 0.15                  # 이보다 짧으면 동자가 아니라 점이다


def _ray_z(ob, x, y, z_from, z_to):
    inv = ob.matrix_world.inverted()
    org = inv @ Vector((x, y, z_from))
    tip = inv @ Vector((x, y, z_to))
    d = tip - org
    ok, loc, _n, _i = ob.ray_cast(org, d.normalized(), distance=d.length)
    return (ob.matrix_world @ loc).z if ok else None


def _stand_z(x, y, base, prefix):
    """동자가 딛는 면. 옆 난간은 계단 옆판 위, 그 밖은 계단면 위."""
    if base:
        ob = bpy.data.objects.get(base)
        return _ray_z(ob, x, y, 4.0, -26.0) if ob else None
    best = None
    for ob in bpy.data.objects:
        if not ob.name.startswith((prefix + "tread", prefix + "nose", prefix + "riser")):
            continue
        z = _ray_z(ob, x, y, 4.0, -26.0)
        if z is not None and (best is None or z > best):
            best = z
    return best


def _zero(ob):
    """정점을 월드로 쌓았으니 오브젝트 변환은 항등이어야 한다."""
    if ob is None:
        return
    ob.parent = None
    ob.location = (0.0, 0.0, 0.0)
    ob.rotation_euler = (0.0, 0.0, 0.0)
    ob.scale = (1.0, 1.0, 1.0)


def stair_balusters():
    m = bpy.data.materials.get("STAIR_RAIL")
    if m is None:
        return
    out = {"Z4_st_": ("Z4_DET_STAIR_RAIL", "Z4_DESCENT"),
           "Z1_st_": ("Z1_hq_baluster", "Z1_GROUND")}
    batches = {k: Batch(n, m) for k, (n, _c) in out.items()}
    made, skipped = 0, 0
    for name, ry, base, prefix in RAILS:
        o = bpy.data.objects.get(name)
        if o is None:
            continue
        pts = [o.matrix_world @ v.co for v in o.data.vertices]
        cy = ry if ry is not None else (min(p.y for p in pts) + max(p.y for p in pts)) / 2
        b = batches[prefix]
        x = min(p.x for p in pts) + 0.5
        xmax = max(p.x for p in pts) - 0.35
        while x < xmax:
            zt = _ray_z(o, x, cy, -26.0, 4.0)          # 난간 밑면
            zb = _stand_z(x, cy, base, prefix)         # 딛는 면
            if zt is not None and zb is not None and zt - zb > POST_MIN:
                b.box(x - POST_HALF, cy - POST_HALF, zb,
                      x + POST_HALF, cy + POST_HALF, zt + 0.01)
                made += 1
            else:
                skipped += 1
            x += POST_PITCH
    for k, (_n, coll) in out.items():
        _zero(batches[k].build(zone_collection(coll)))
    print(f"  계단 난간동자 {made}개 (딛는 면 못 찾아 거른 자리 {skipped})")


# ── 9. 바닥 유도 사인 테두리 ─────────────────────────────────────
# `build_details.z2_floor_signs` 는 색 판 아래에 **더 큰 어두운 테두리**를 깐다.
# 그런데 그 테두리가 `TXT_DARK`(깊이층 7)이고 판은 `SIGN_INFO`(2)라, 폴리곤 오프셋이
# 지오메트리 z 순서를 뒤집어 **테두리가 판을 통째로 덮었다** — 바닥에 검은 구멍이 났다.
#
# 층으로 풀려고 판을 8, 글자를 9 로 올렸더니 이번엔 매달림 사인의 반대편 글자가
# 판을 뚫고 비쳤다(판 두께 9 cm · 글자가 판 밖 1 cm). 층은 건드리지 않는 게 맞다.
# 실사 바닥 유도 사인에도 검은 테두리는 없다. **테두리를 걷어낸다.**
FLOOR_SIGN_Z = -5.90       # 이보다 낮은 아일랜드만 바닥 것이다
                           # (벽 광고 테두리 z −5.82~−4.74 · 매달림 사인 −3.62~−3.02)


def floor_sign_border():
    ob = bpy.data.objects.get("Z2_DET_TXT_DARK")
    if ob is None:
        return
    bm, comps = _islands(ob)
    # `_islands` 는 (bm, 정점목록, 월드bbox) 를 준다 — 가운데가 정점이다
    doomed = [verts for _bm, verts, bb in comps if bb[5] < FLOOR_SIGN_Z]
    if doomed:
        bmesh.ops.delete(bm, geom=[v for vs in doomed for v in vs], context="VERTS")
        bm.to_mesh(ob.data)
        ob.data.update()
    bm.free()
    print(f"  바닥 유도 사인 테두리 {len(doomed)}개 제거")


# ── 10. 벽에 딱 붙은 사인 판 ────────────────────────────────────
# `build_wc` 의 사인 판들이 **뒤 부재와 정확히 같은 평면**에 있다.
#   `Z2_OBJ13_sign` 뒷면 y 22.98 = `Z2_OBJ13_frame` 앞면 y 22.98
#   `Z2_OBJ14_signplate` 뒷면 y 25.00 = `Z2_OBJ14_shell` 앞면 y 25.00
# 깊이 버퍼가 못 가르므로 카메라를 돌리면 그 면이 깜빡인다("유실물 보관소가 깜빡인다").
# 판을 통로 쪽으로 조금 당겨 평면을 뗀다. **목표 y 를 절대값으로 주므로 멱등하다.**
PULL = [
    ("Z2_OBJ13_sign", 22.92), ("Z2_OBJ13_txt", 22.86),
    ("Z2_OBJ14_signplate", 24.94), ("Z2_OBJ14_pic_blue", 24.90),
    ("Z2_OBJ14_pic_red", 24.90), ("Z2_OBJ14_pic_grn", 24.90),
]


def pull_signs():
    n = 0
    for name, target in PULL:
        ob = bpy.data.objects.get(name)
        if ob is None:
            continue
        if ob.type == "MESH" and ob.data.vertices:
            cur = max((ob.matrix_world @ v.co).y for v in ob.data.vertices)
            d = target - cur
            if abs(d) > 1e-4:
                for v in ob.data.vertices:
                    v.co.y += d
                ob.data.update()
                n += 1
        else:                                   # FONT — 정점이 없으니 위치로
            if abs(ob.location.y - target) > 1e-4:
                ob.location.y = target
                n += 1
    # 화장실 글자도 판을 따라 나온다. 이름이 접두사라 따로 훑는다.
    for ob in bpy.data.objects:
        if ob.name.startswith("Z2_OBJ14_txt_") and abs(ob.location.y - 24.86) > 1e-4:
            ob.location.y = 24.86
            n += 1
    print(f"  벽 붙은 사인 판 {n}개 떼어냄")


# ── 11. 유실물 창구 프레임이 유리를 삼킨다 ──────────────────────
# `Z2_OBJ13_frame` (BN_FRAME) 이 y 22.98~23.18 인데 `Z2_OBJ13_glass` 는 23.06~23.10 —
# **유리가 프레임 두께 안에 통째로 파묻혀 있다.** 투명면 앞뒤가 불투명 프레임 안에
# 갇히면 깊이 정렬이 카메라 각도마다 뒤집혀 깜빡인다.
# 실측(`zfight.spec`): 이 지점 뒤집힘 8,924 px — 예산 4,000 의 두 배였다.
# 프레임을 유리 앞에서 끊는다. 목표 y 를 절대값으로 주므로 멱등하다.
FRAME_CUT = ("Z2_OBJ13_frame", 23.03)


def frame_clear_glass():
    name, cut = FRAME_CUT
    ob = bpy.data.objects.get(name)
    if ob is None or ob.type != "MESH":
        return
    n = 0
    inv = ob.matrix_world.inverted()
    for v in ob.data.vertices:
        w = ob.matrix_world @ v.co
        if w.y > cut + 1e-4:
            w.y = cut
            v.co = inv @ w
            n += 1
    if n:
        ob.data.update()
    print(f"  유실물 창구 프레임 정점 {n}개를 유리 앞(y {cut})에서 끊음")


# ── 12. 하강 계단 중앙 난간 ─────────────────────────────────────
# 계단 폭 5 m 에 난간이 3열(y 4.12 · 6.70 · 9.28)이었다. 동자를 세우고 나니
# 가운데 열이 계단 한복판을 세로로 가르고, 위에서 내려다보면 그 격자가
# **계단 표면을 체크무늬로 덮은 것**처럼 보였다.
# 그레이박스 오브젝트라 지우면 되살릴 수 없으므로 익스포트에서만 뺀다.
def hide_rail_center():
    o = bpy.data.objects.get("Z4_st_rail_6.70")
    if o is None:
        return
    o.hide_render = True
    o.hide_viewport = True
    print("  하강 계단 중앙 난간 익스포트 제외")


# ── 13. 화살표 방향 ─────────────────────────────────────────────
# `build_details` 는 ORDER 밖이라 원본을 고쳐도 blend 에 안 닿는다. 실제 수리는 여기다.
#
# 바닥 유도 사인 글자는 rotZ −90° 로 누워 있어 **읽는 방향이 −y · 글자 위가 +x** 다.
# 그래서 화면 문자와 월드 방향의 대응이 이렇게 된다.
#
#     →  −y(남)   ←  +y(북)   ↑  +x(동)   ↓  −x(서)
#
# 다섯 개가 전부 "→" 였는데 그건 남쪽을 가리키는 것이라 하나도 안 맞았다.
# 목적지는 출구 계단 x 2~14.6 · y 25.4~30.6, 개찰구 x 56~, 화장실 x 36~51 · y 25~30 이다.
#
# `Z3_exitband` 의 "←" 는 양면에 같은 문안이 걸리는데 좌우는 보는 사람 기준이라
# 한쪽은 반드시 틀린다. 개찰구 위 띠는 "여기가 나가는 곳"이면 충분하므로 뺀다.
FLOOR_Z = -5.988
ARROW_TEXTS = [
    ("Z2_decal_txt0", "1 · 3 출구  ←", (10.0, 15.0, FLOOR_Z), 0.20, "Z2_CONCOURSE",
     (0.0, 0.0, -math.pi / 2)),
    ("Z2_decal_txt1", "1 · 3 출구  ↓", (24.0, 15.0, FLOOR_Z), 0.20, "Z2_CONCOURSE",
     (0.0, 0.0, -math.pi / 2)),
    ("Z2_decal_txt2", "승강장  Platform  ↑", (38.0, 15.0, FLOOR_Z), 0.20, "Z2_CONCOURSE",
     (0.0, 0.0, -math.pi / 2)),
    ("Z2_decal_txt3", "승강장  Platform  ↑", (50.0, 15.0, FLOOR_Z), 0.20, "Z2_CONCOURSE",
     (0.0, 0.0, -math.pi / 2)),
    ("Z2_decal_txt4", "화장실  Restroom  ↑", (17.0, 24.0, FLOOR_Z), 0.20, "Z2_CONCOURSE",
     (0.0, 0.0, -math.pi / 2)),
]
EXIT_BAND_CX = 62.6


def _font_text(name, body, loc, size, coll_name, rot, matname):
    """FONT 오브젝트로 다시 만든다. 익스포터가 커브를 메시로 바꿔 주므로
    `build_details.text` 처럼 미리 구울 필요가 없고, 문안을 나중에 또 고칠 수 있다."""
    old = bpy.data.objects.get(name)
    if old is not None:
        bpy.data.objects.remove(old, do_unlink=True)
    cu = bpy.data.curves.new(name, type="FONT")
    cu.body = body
    cu.font = bpy.data.fonts.get(FONT) or cu.font
    cu.size = size
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.extrude = 0.002
    cu.resolution_u = 1
    m = bpy.data.materials.get(matname)
    if m is not None:
        cu.materials.append(m)
    ob = bpy.data.objects.new(name, cu)
    ob.location = loc
    ob.rotation_euler = rot
    zone_collection(coll_name).objects.link(ob)


def sign_arrows():
    for name, body, loc, size, coll, rot in ARROW_TEXTS:
        _font_text(name, body, loc, size, coll, rot, "TXT_WHITE")
    n = 0
    for i, cy in enumerate((8.0, 16.0, 24.0)):
        for s, sfx in ((-1, "W"), (1, "E")):
            _font_text(f"Z3_exitband{i}{sfx}", "나가는 곳  Exit",
                       (EXIT_BAND_CX + s * 0.135, cy, -3.32), 0.20, "Z3_GATES",
                       (math.pi / 2, 0.0, math.pi / 2 * (3 if s < 0 else 1)), "TXT_DARK")
            n += 1
    print(f"  바닥 유도 사인 {len(ARROW_TEXTS)}개 방향 교정 · 출구 띠 {n}개 화살표 제거")


# ── 14. Z4 통로 벽 광고·걸레받이가 **중복**이다 ───────────────────
# `build_details.z4_wall_ads` 가 북쪽 내면을 9.60 으로 두고 있었다. 그건 하강부 난간
# y 이고 통로는 y 2~12 라(부록 A · 충돌 `Z4-UPPER`), 광고가 벽보다 2.4 m 앞
# 허공에 떠 있었다(디렉터 지적).
#
# 그런데 12.00 으로 옮겨 보니 **같은 자리에 광고가 두 벌**이 됐다 —
# `hq_walls.WALLS` 가 이미 Z4wS(y 2.00) · Z4wN(y 12.00) 에 걸레받이 · 광고 · 띠를
# 전부 만들고 있었고, 그쪽이 프레임 네 변에 포스터 3종으로 더 정교하다.
# 위치가 달라서 겹치지 않았을 뿐 처음부터 중복이었던 것이다.
# → 옮기는 게 아니라 **걷어낸다.** 원본 쪽도 무력화해 뒀다.
AD_BANDS = ((1.90, 2.25), (9.40, 9.75), (11.80, 12.15))
AD_Z = (-6.05, -3.50)
AD_MATS = ("Z4_DET_SIGN_DARK", "Z4_DET_AD_PANEL", "Z4_DET_AD_PANEL2",
           "Z4_DET_AD_PANEL3", "Z4_DET_ST_TRIM")


def corridor_ads_drop():
    gone = 0
    for name in AD_MATS:
        ob = bpy.data.objects.get(name)
        if ob is None or ob.type != "MESH":
            continue
        bm, comps = _islands(ob)
        doomed = []
        for _bm, verts, bb in comps:
            if not any(lo <= bb[1] and bb[4] <= hi for lo, hi in AD_BANDS):
                continue
            if not (AD_Z[0] <= bb[2] and bb[5] <= AD_Z[1]):
                continue
            doomed.append(verts)
        if doomed:
            bmesh.ops.delete(bm, geom=[v for vs in doomed for v in vs], context="VERTS")
            bm.to_mesh(ob.data)
            ob.data.update()
            gone += len(doomed)
        bm.free()
    print(f"  통로 벽 중복 부재 {gone}개 제거 (hq_walls 가 담당)")


# ── 15. 승강장 전광판이 천장에 가린다 ────────────────────────────
# `Z5_pids_*` 는 그레이박스 원본이라 만드는 패스가 없다. 케이스가 z −16.78~−16.15 로
# 천장(−15.50)에 바짝 붙어 있고, 천장 마감 덕트가 −16.05 까지 내려온다.
# 그래서 비스듬히 올려다보면 마감층이 전광판 앞을 지나 글자 윗획을 먹는다.
# 매다는 봉도 −15.66 에서 끝나 천장에 0.16 m 못 닿아 있었다.
# → 케이스 계열을 내리고 봉을 천장까지 늘인다.
# ⚠⚠ **상대 이동은 여기서 절대 쓰지 않는다.** 이전 판은 `w.z -= PIDS_DROP` 이라
#    빌드를 돌릴 때마다 0.55 m 씩 또 내려갔다. 세 번 돌리자 케이스가 1.65 m
#    가라앉아 눈높이를 막았고(디렉터 지적: "신도림 방면이 너무 아래에 있어"),
#    `pids()` 의 발광 띠만 제자리에 남아 **공중에 뜬 판**이 됐다.
#    ORDER 패스는 몇 번을 돌려도 같은 결과여야 한다 — 전부 절대 z 로 못 박는다.
PIDS_BOT = -17.65                # 케이스 밑변 = 승강장 바닥(−20) 위 2.35 m
PIDS_SCREEN_INSET = 0.07         # 화면은 케이스 안쪽으로
PIDS_BAND_Z = (-17.50, -17.18)   # 문안 뒤 발광 띠
PIDS_CEIL = -15.50


def _place_z(ob, bottom):
    """오브젝트를 **자기 높이는 유지한 채** 밑변이 `bottom` 에 오도록 옮긴다."""
    inv = ob.matrix_world.inverted()
    ws = [ob.matrix_world @ v.co for v in ob.data.vertices]
    dz = bottom - min(w.z for w in ws)
    if abs(dz) < 1e-6:
        return 0.0
    for v, w in zip(ob.data.vertices, ws):
        w.z += dz
        v.co = inv @ w
    ob.data.update()
    return dz


def pids_place():
    case = bpy.data.objects.get("Z5_pids_case")
    _place_z(case, PIDS_BOT) if case and case.type == "MESH" else None
    top = PIDS_BOT
    if case is not None:
        ws = [case.matrix_world @ v.co for v in case.data.vertices]
        top = max(w.z for w in ws)
        mid = (PIDS_BOT + top) / 2

    scr = bpy.data.objects.get("Z5_pids_screen")
    if scr is not None and scr.type == "MESH":
        _place_z(scr, PIDS_BOT + PIDS_SCREEN_INSET)

    # 봉은 **늘인다** — 아래는 케이스 윗변, 위는 천장이다
    rod = bpy.data.objects.get("Z5_pids_rod")
    if rod is not None and rod.type == "MESH":
        ws = [rod.matrix_world @ v.co for v in rod.data.vertices]
        lo, hi = min(w.z for w in ws), max(w.z for w in ws)
        inv = rod.matrix_world.inverted()
        for v, w in zip(rod.data.vertices, ws):
            t = (w.z - lo) / (hi - lo) if hi > lo else 0.0
            w.z = top + t * (PIDS_CEIL - top)
            v.co = inv @ w
        rod.data.update()

    n = 0
    for o in bpy.data.objects:
        if not (o.name.startswith("Z5_pids_txt_") and o.type == "FONT"):
            continue
        ws = [o.matrix_world @ Vector(c) for c in o.bound_box]
        o.location.z += mid - (min(w.z for w in ws) + max(w.z for w in ws)) / 2
        n += 1
    print(f"  전광판 밑변 z {PIDS_BOT}(바닥 위 {PIDS_BOT + 20.0:.2f} m) · "
          f"봉 {top:.2f}→{PIDS_CEIL} · 문안 {n}개")


# ── 16. 하강 소핏이 승강장 위로 7.5 m 흘러내린다 ──────────────────
# 지적: "120.3, 11.7, −20 — 여기 천장이 왜 내려와 있어?"
#
# 실측하면 떠 있는 게 아니라 **경사 램프**였다. y 0.95~9.60 띠에서
#
#     x 120.5  z −17.28   ← 하강 소핏 바닥
#     x 124.0  z −16.52
#     x 128.0  z −15.50   ← 승강장 천장과 합류
#
# 즉 소핏이 계단을 다 지난 뒤에도 7.5 m 를 더 기어올라 승강장 천장에 붙는다.
# 실사 승강장에 그런 램프는 없다. 계단 개구부 가장자리에서 천장이 **수직으로**
# 꺾이고(마구리), 그 너머는 평천장이다. 램프는 8.5 m 폭짜리 민짜 쐐기라
# 우물천장 두 장 사이에서 "천장이 무너져 내리는" 것으로 읽힌다.
#
# `hq_descent` 는 이미 같은 교훈을 X1=120.4 로 새겨 뒀다(승강장 안에 마감이
# 들어가 우선석을 가로막았던 건). 정작 바닥 슬래브와 `build_ceiling.sloped_ribs`
# (x1=127.0)가 안 따라왔다. 둘 다 ORDER 밖이라 여기서 자른다.
DESC_CUT_X = 121.00              # `hq_punch_openings` 의 Z5 천장 개구 동쪽 끝
DESC_TRIM = ("Z4_desc_ceil", "Z4_desc_ribs")
DESC_BAND_Y = (0.94, 9.61)
FASCIA_X = (120.92, 121.12)
FASCIA_Z = (-17.18, -15.48)      # 절단면 밑변 −17.16 ~ 승강장 천장 밑면 −15.50


def descent_soffit_stop():
    cut = 0
    for name in DESC_TRIM:
        o = bpy.data.objects.get(name)
        if o is None or o.type != "MESH":
            continue
        inv = o.matrix_world.inverted()
        # 평면은 오브젝트 로컬 좌표로 줘야 한다
        co = inv @ Vector((DESC_CUT_X, 0.0, 0.0))
        no = (inv.to_3x3().transposed() @ Vector((1.0, 0.0, 0.0))).normalized()
        bm = bmesh.new()
        bm.from_mesh(o.data)
        before = len(bm.verts)
        bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                               plane_co=co, plane_no=no, clear_outer=True)
        if len(bm.verts) != before:
            # 이미 잘린 다음 회차에는 절대 돌리면 안 된다 — 다른 정당한 열린
            # 경계까지 메워 버린다. 실제로 잘라낸 회차에만 마구리를 메운다.
            try:
                bmesh.ops.holes_fill(bm, edges=list(bm.edges), sides=0)
            except Exception:
                pass              # 못 메워도 마구리 박스가 덮는다
            cut += 1
        bm.to_mesh(o.data)
        o.data.update()
        bm.free()

    # 잘린 끝을 수직 마구리로 막는다. 재질은 소핏 것을 그대로 써서
    # 병합 맵·발광 목록 등록을 새로 안 만든다(같은 함정에 세 번 물렸다).
    src = bpy.data.objects.get("Z4_desc_ceil")
    m = src.data.materials[0] if src and src.data.materials else None
    if m is not None:
        b = Batch("Z4_hq_desc_fascia", m)
        b.box(FASCIA_X[0], DESC_BAND_Y[0], FASCIA_Z[0],
              FASCIA_X[1], DESC_BAND_Y[1], FASCIA_Z[1])
        b.build(zone_collection("Z4_DESCENT"))
    print(f"  하강 소핏 {cut}개를 x {DESC_CUT_X} 에서 절단 · 마구리 마감")


# ── 17. 승강장 역명판이 너무 크다 ────────────────────────────────
# 지적: "안내판 박스가 너무 커."
#
# 실측 5.20 × 1.72 m, 밑변이 바닥에서 **1.68 m**. 실사 매달림 역명판은
# 3.2 × 0.95 안팎이고 밑변은 2.4~2.5 m 다 — 폭이 1.6배, 높이가 1.8배인 데다
# 통로 위 유효고까지 못 맞춘다. 판 안에서도 글자 위쪽 여백만 0.52 m 로
# 혼자 비어 있었다(아래 여백은 0.15 m).
#
# 글자는 안 줄인다. 한글 자고 0.35 m 는 실사(0.30~0.35)와 같아서, 문제는
# 글자가 아니라 **글자를 감싼 판**이다. 판만 줄이고 글자 뭉치는 통째로 올린다.
SIGN_W, SIGN_H = 3.40, 1.30
SIGN_TOP = -16.30                # 밑변 −17.60 = 바닥(−20) 위 2.40 m
SIGN_ROD_DX, SIGN_ROD_TOP = 1.40, -15.30
SIGN_KR_MARGIN = 0.15            # 판 윗변 ~ 한글 윗변


def _bounds(o):
    ws = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return (min(w.x for w in ws), max(w.x for w in ws),
            min(w.z for w in ws), max(w.z for w in ws))


def hanging_name_signs():
    n = 0
    for k in range(8):
        plate = bpy.data.objects.get(f"Z5_hang_plate{k}")
        if plate is None or plate.type != "MESH":
            continue
        x0, x1, z0, z1 = _bounds(plate)
        cx = (x0 + x1) / 2
        sx = SIGN_W / (x1 - x0)
        sz = SIGN_H / (z1 - z0)
        # 글자 뭉치는 한글 윗변이 판 윗변에서 SIGN_KR_MARGIN 아래 오도록 올린다.
        kr = bpy.data.objects.get(f"Z5_hang_kr{k}_1")
        lift = 0.0
        if kr is not None:
            lift = (SIGN_TOP - SIGN_KR_MARGIN) - _bounds(kr)[3]

        for nm in (f"Z5_hang_plate{k}", f"Z5_hang_band{k}"):
            o = bpy.data.objects.get(nm)
            if o is None or o.type != "MESH":
                continue
            inv = o.matrix_world.inverted()
            keep = nm.endswith(f"band{k}")
            for v in o.data.vertices:
                w = o.matrix_world @ v.co
                w.x = cx + (w.x - cx) * sx
                # 판은 새 상자에 맞춰 다시 재고, 띠는 글자와 같이 올린다
                w.z = (w.z + lift) if keep else (SIGN_TOP - (z1 - w.z) * sz)
                v.co = inv @ w
            o.data.update()

        for pre in ("kr", "en", "dir"):
            for side in (-1, 1):
                o = bpy.data.objects.get(f"Z5_hang_{pre}{k}_{side}")
                if o is not None:
                    o.location.z += lift

        for rod in [o for o in bpy.data.objects
                    if o.name.startswith(f"Z5_hang_rod{k}_") and o.type == "MESH"]:
            rx0, rx1, _, _ = _bounds(rod)
            side = 1 if (rx0 + rx1) / 2 > cx else -1
            tx = cx + side * SIGN_ROD_DX
            inv = rod.matrix_world.inverted()
            hw = (rx1 - rx0) / 2
            for v in rod.data.vertices:
                w = rod.matrix_world @ v.co
                w.x = tx + (1 if w.x > (rx0 + rx1) / 2 else -1) * hw
                w.z = SIGN_TOP if w.z < (SIGN_TOP + SIGN_ROD_TOP) / 2 else SIGN_ROD_TOP
                v.co = inv @ w
            rod.data.update()
        n += 1
    print(f"  역명판 {n}개 → {SIGN_W}×{SIGN_H} m · 밑변 바닥 위 "
          f"{SIGN_TOP - SIGN_H + 20.0:.2f} m")


def build():
    pids()
    awnings()
    light_setback()
    parapet()
    entrance_beam()
    entrance_bars()
    entr_soffit()
    exit_number_post()
    column_bands()
    stair_balusters()
    floor_sign_border()
    pull_signs()
    frame_clear_glass()
    hide_rail_center()
    sign_arrows()
    corridor_ads_drop()
    pids_place()
    descent_soffit_stop()
    hanging_name_signs()
    print("[hq_fixups] 완료")


build()
