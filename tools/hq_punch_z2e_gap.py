"""Z2-E 벽(x56, Z2/Z3 경계) 개구부 확장 — 디렉터 지시.

    "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe" -b ^
        assets\\station_map.blend -P tools\\hq_punch_z2e_gap.py

실측(플레이, 55.4·18.5~29.7·-6.0)으로 벽이 막고 있던 구간을 지적받았다.
이 벽은 `Z2_wall_E_lo`(y−0.4~9)·`Z2_wall_E_hi`(y19~32) 두 개로 손수 나뉘어
있었다 — 사이(y9~19)가 원래 개구부다. `world.ts`의 `Z2-E` 충돌
(`wallWithGaps` 개구부 `[9, 19]`)도 정확히 그 폭이었다.

1) `Z2_wall_E_hi`의 남쪽 면을 y19 → y29.7 로 밀어 개구부를 늘린다.
   `world.ts` 쪽 개구부도 같은 y29.7 로 맞췄다(별도 커밋) — 시각·충돌이
   어긋나면 안 보이는데 막히거나, 보이는데 안 막히는 사고가 난다.

2) **벽에 붙어 있던 부속은 벽이 아니다 — 벽을 밀어도 안 따라온다.**
   `Z3-N`을 지울 때 이미 한 번 겪은 실수와 같은 모양이라(그때는 광고판,
   이번엔 초록 띠·조명) 여기서 같이 처리한다.
     · `FX_Z2_56_22` — 천장 조명, x53.2~58.8·y21.75~22.25 로 개구부를
       가로질러 걸려 있었다. 벽이 없는 자리에 뜬 판으로 남으므로 지운다.
     · `Z2_wall_band`·`Z3_wall_band`(LINE2_GRN, 벽띠 초록선) — 존 벽 전체를
       한 메시로 이은 것이라 통째로 못 지운다. x56 언저리·y18.5~29.7 안에
       중심이 있는 면만 bmesh로 골라 지운다 — 나머지 구간(Z2 남·서·북벽,
       Z3 나머지 벽)의 초록선은 그대로 남는다.

단순 상자(정점 8개)라 bisect 없이 남쪽 면 정점 4개만 옮긴다 — 멱등: 이미
29.7 이상이면 손대지 않는다. 면 삭제도 멱등이다 — 그 구간에 남은 면이
없으면 조용히 0개를 지운다.
"""
from __future__ import annotations

import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))
                if "__file__" in dir() else r"C:\Users\User\Documents\HACKERTON\tools")

NEW_Y0 = 29.7
TOL = 0.01

# 초록 벽띠에서 지울 구간 — x56 벽 언저리(여유 0.6m) · 새로 넓힌 개구부(y18.5~29.7)
GAP_X = (55.0, 57.0)
GAP_Y = (18.5, 29.7)


def widen_wall() -> None:
    o = bpy.data.objects.get("Z2_wall_E_hi")
    if o is None:
        print("  ! Z2_wall_E_hi 없음 — 건너뜀")
        return
    mesh = o.data
    moved = 0
    for v in mesh.vertices:
        world_co = o.matrix_world @ v.co
        if world_co.y < NEW_Y0 - TOL:
            local_target = o.matrix_world.inverted() @ type(v.co)((world_co.x, NEW_Y0, world_co.z))
            v.co.y = local_target.y
            moved += 1
    mesh.update()
    print(f"  Z2_wall_E_hi 남쪽 면 y19→{NEW_Y0} (정점 {moved}개 이동)")


def remove_stray_fixture() -> None:
    o = bpy.data.objects.get("FX_Z2_56_22")
    if o is None:
        print("  (FX_Z2_56_22 이미 없음)")
        return
    bpy.data.objects.remove(o, do_unlink=True)
    print("  천장 조명 FX_Z2_56_22 제거 (개구부를 가로질러 걸려 있었다)")


def trim_wall_band(name: str) -> None:
    o = bpy.data.objects.get(name)
    if o is None:
        print(f"  ! {name} 없음 — 건너뜀")
        return
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    doomed = []
    for f in bm.faces:
        center = o.matrix_world @ f.calc_center_median()
        if GAP_X[0] <= center.x <= GAP_X[1] and GAP_Y[0] <= center.y <= GAP_Y[1]:
            doomed.append(f)
    n = len(doomed)
    if doomed:
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bm.to_mesh(o.data)
        o.data.update()
    bm.free()
    print(f"  {name} 개구부 구간 면 {n}개 제거")


def main() -> None:
    widen_wall()
    remove_stray_fixture()
    trim_wall_band("Z2_wall_band")
    trim_wall_band("Z3_wall_band")


main()
