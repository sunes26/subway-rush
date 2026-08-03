"""진단 — 하강부 머리 여유(headroom) 실측(읽기 전용).

x 를 따라가며 **바닥(계단 윗면)** 과 **소핏 밑면** 을 각각 레이로 읽어 그 차를 낸다.
"천장이 계단이랑 합쳐져 보인다"는 제보를 그림으로 쫓지 않고 수치로 잡기 위한 것.

사람이 지나려면 최소 2.1 m 가 필요하다(눈높이 1.62 + 머리 여유).
"""

from __future__ import annotations

import bpy
from mathutils import Vector

CEIL = "Z4_desc_ceil"
Y = 6.0
MIN_OK = 2.10


def hit_z(name, x, y, z_from, z_to):
    o = bpy.data.objects.get(name)
    if o is None:
        return None
    inv = o.matrix_world.inverted()
    org = inv @ Vector((x, y, z_from))
    tip = inv @ Vector((x, y, z_to))
    d = (tip - org)
    ok, loc, _n, _i = o.ray_cast(org, d.normalized(), distance=d.length)
    return (o.matrix_world @ loc).z if ok else None


def floor_z(x, y):
    """계단 윗면 — 위에서 아래로 쏴 첫 히트. 후보를 모두 훑어 가장 높은 것을 쓴다."""
    best = None
    for ob in bpy.data.objects:
        if ob.type != "MESH" or not ob.visible_get():
            continue
        if not (ob.name.startswith("Z4_st_") or ob.name.startswith("Z4_floor")
                or ob.name.startswith("Z5") and "floor" in ob.name.lower()):
            continue
        z = hit_z(ob.name, x, y, 2.0, -24.0)
        if z is not None and (best is None or z > best):
            best = z
    return best


print(f"{'x':>7} {'바닥z':>8} {'소핏z':>8} {'여유':>7}")
worst = (99.0, None)
for i in range(0, 66):
    x = 94.0 + i * 0.5
    fz = floor_z(x, Y)
    cz = hit_z(CEIL, x, Y, -24.0, 0.0)
    if fz is None or cz is None:
        print(f"{x:7.1f} {fz if fz is None else f'{fz:8.2f}'} "
              f"{cz if cz is None else f'{cz:8.2f}'}      —")
        continue
    gap = cz - fz
    flag = "  ← 낮음" if gap < MIN_OK else ""
    if gap < worst[0]:
        worst = (gap, x)
    print(f"{x:7.1f} {fz:8.2f} {cz:8.2f} {gap:7.2f}{flag}")
print(f"[diag_head] 최소 여유 {worst[0]:.2f} m @ x={worst[1]}")
