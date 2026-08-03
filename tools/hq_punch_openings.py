"""패스 K — 천장 개구부를 뚫는다. `hq_ceiling` 뒤, 머티리얼 통합 앞.

지상에서 대합실로 내려오는 계단은 **대합실 천장을 관통한다.** 그래서 그 구간의
천장에는 구멍이 있어야 한다. `Z2_ceiling` 슬래브에는 이미 뚫려 있었는데
(x 2.0~14.9 · y 25.4~30.0 이 비어 있다), 그 위에 얹은 마감층이 그걸 몰랐다.

결과: 계단 중간에서 앞을 보면 **천장 격자가 발밑에 바닥처럼 깔리고**,
계단 밑에서 올려다보면 천장이 계단을 뚫고 지나간다. 기존 `Z2_ceil_grid` 도 같은 상태였다 —
1.2 m 격자라 덜 튀었을 뿐 원래부터 잘못돼 있었다.

빌더마다 개구부를 인자로 넘기는 대신 **면을 잘라내는 방식**을 택했다.
그래야 내가 만들지 않은 기존 오브젝트도 같이 고쳐지고, 앞으로 층을 더 얹어도
여기 한 곳만 지나면 된다.

판정은 면 중심의 xy 다. 개구부 안에 들어간 면만 지운다 —
천장 밴드(z) 밖에 있는 것은 건드리지 않는다.
"""

from __future__ import annotations

import bmesh
import bpy
from mathutils import Vector

# (컬렉션, 이름 부분일치 조건은 아래 CEIL 패턴, x0, y0, x1, y1, z 하한, z 상한)
#
# 계단은 x 2.0(z 0) → 14.6(z −6) 으로 내려온다. 천장면은 z −2.80 이라
# x≈7.6 에서 정확히 교차한다. 구멍은 **머리 높이가 확보되는 지점까지** 열어야 한다 —
# x 12.8 에서 계단면이 −5.0 이라 그때 비로소 2.2 m 가 뜬다.
#
# 범위는 **슬래브의 구멍과 정확히 맞춘다.** `Z2_ceiling` 은 x 2.0~14.9 · y 25.4~30.0 이
# 비어 있다. 마감층을 그보다 좁게 잘라내면 그 차이만큼 격자가 허공에 남는다.
#
# 같은 일이 **승강장에서 그대로 재발**했다. Z5 천장(z −15.50)은 x 78~206 전체에 깔려
# 있는데 하강 계단은 x 113 부근에서 그 높이를 지나 −20 까지 내려간다.
# 그래서 계단 중턱에서 앞을 보면 승강장 천장 티바를 **위에서** 내려다보게 되고,
# 그 격자가 계단 앞에 깔린 체크무늬처럼 보였다(디렉터 지적).
# 실측: 계단면이 −15.5 가 되는 지점이 x ≈ 113, 계단 끝이 x 120.4.
# 에스컬레이터(y 1.35~3.05)도 같은 구간에서 천장을 지나므로 y 는 통로 폭 전체로 연다.
OPENINGS = [
    ("Z2_CONCOURSE", 2.00, 25.40, 14.90, 30.05, -3.60, -2.40),
    ("Z5_PLATFORM", 112.50, 0.90, 121.00, 9.60, -16.40, -14.90),
]

CEIL = ("_ceil", "ceiling", "_hq_tee", "_hq_trof", "_hq_troflight", "_hq_duct",
        "_hq_grille", "_hq_device", "_hq_ceilrecess", "_hq_sprinkler",
        "_hq_covelip", "_hq_coveglow", "_hq_cornice")


def punch(coll_name, x0, y0, x1, y1, z0, z1):
    coll = bpy.data.collections.get(coll_name)
    if coll is None:
        return 0, 0
    hit_objs = removed = 0
    for o in coll.all_objects:
        if o.type != "MESH" or o.name.startswith("xx_"):
            continue
        if not any(k in o.name for k in CEIL):
            continue
        mw = o.matrix_world
        inv = mw.inverted()
        bm = bmesh.new()
        bm.from_mesh(o.data)

        # ⚠ 면 중심으로만 판정하면 **긴 리브가 하나도 안 지워진다.**
        # 천장 티바는 56 m 를 가로지르는 상자 하나라 중심이 구멍 밖에 있다.
        # 실제로 이것 때문에 구멍 위에 격자만 허공에 남아, 계단에서 그 사이로
        # 대합실 바닥이 내려다보였다.
        # → 개구부의 네 경계면으로 **메시를 먼저 자르고** 나서 안쪽을 지운다.
        for co_w, no_w in ((Vector((x0, 0, 0)), Vector((1, 0, 0))),
                           (Vector((x1, 0, 0)), Vector((1, 0, 0))),
                           (Vector((0, y0, 0)), Vector((0, 1, 0))),
                           (Vector((0, y1, 0)), Vector((0, 1, 0)))):
            bmesh.ops.bisect_plane(
                bm, geom=list(bm.faces) + list(bm.edges) + list(bm.verts),
                plane_co=inv @ co_w, plane_no=(inv.to_3x3() @ no_w).normalized(),
                clear_inner=False, clear_outer=False)

        doomed = []
        for f in bm.faces:
            c = mw @ f.calc_center_median()
            if x0 <= c.x <= x1 and y0 <= c.y <= y1 and z0 <= c.z <= z1:
                doomed.append(f)
        if doomed:
            bmesh.ops.delete(bm, geom=doomed, context="FACES")
            bm.to_mesh(o.data)
            o.data.update()
            hit_objs += 1
            removed += len(doomed)
        bm.free()
    return hit_objs, removed


def orphans():
    """빌더에서 빠졌는데 오브젝트만 남은 것.

    스프링클러 패스를 지웠지만 `*_hq_sprinkler` 오브젝트는 씬에 그대로 있었다.
    패스를 지울 때 오브젝트까지 사라지지는 않는다 — 화분 유령과 같은 부류다.
    """
    gone = ("_hq_sprinkler",)
    n = 0
    for o in list(bpy.data.objects):
        if any(k in o.name for k in gone) and not o.name.startswith("xx_"):
            o.name = "xx_" + o.name
            o.hide_render = True
            o.hide_viewport = True
            n += 1
    return n


def build():
    total_o = total_f = 0
    for spec in OPENINGS:
        o, f = punch(*spec)
        total_o += o
        total_f += f
        print(f"  {spec[0]} 개구부 x{spec[1]}~{spec[3]} y{spec[2]}~{spec[4]}: "
              f"오브젝트 {o}개에서 면 {f}개 제거")
    n = orphans()
    print(f"[hq_punch_openings] 면 {total_f}개 제거 · 폐기된 패스 잔재 {n}개 정리")


build()
