"""조명 보강 — 하강부 · 통로 · 개찰구.

씬 조명을 세어 보니 대합실 18 · 승강장 23 · 지상 1 인데 **하강부와 통로가 0** 이었다.
그래서 그 두 구간만 순회 렌더에서 캄캄하게 나왔다. 형상이 아니라 조명이 없어서다.

`LIGHTS` 컬렉션의 규약을 그대로 따른다 — AREA 램프, `hide_render = True`
(익스포트 제외). 순회 렌더가 렌더 직전에만 켠다.

하강부는 경사라 높이를 못 박을 수 없다. 소핏에 레이를 쏴서 그 아래 0.5 m 에 건다.
"""

from __future__ import annotations

import math

import bpy
from mathutils import Vector

COLL = "LIGHTS"
SOFFIT = "Z4_desc_ceil"


def _coll():
    c = bpy.data.collections.get(COLL)
    if c is None:
        c = bpy.data.collections.new(COLL)
        bpy.context.scene.collection.children.link(c)
    return c


def lamp(name, loc, energy, size=(2.4, 1.2), rot=(0, 0, 0)):
    o = bpy.data.objects.get(name)
    if o is None or o.type != "LIGHT":
        d = bpy.data.lights.new(name, type="AREA")
        o = bpy.data.objects.new(name, d)
        _coll().objects.link(o)
    d = o.data
    d.type = "AREA"
    d.shape = "RECTANGLE"
    d.size, d.size_y = size
    d.energy = energy
    d.color = (1.0, 0.97, 0.92)
    o.location = loc
    o.rotation_euler = rot
    o.hide_render = True          # 익스포트 제외 규약. 순회 렌더가 잠깐만 켠다
    return o


def soffit_z(x, y):
    o = bpy.data.objects.get(SOFFIT)
    if o is None:
        return None
    inv = o.matrix_world.inverted()
    org = inv @ Vector((x, y, -24.0))
    tip = inv @ Vector((x, y, 0.0))
    ok, loc, _, _ = o.ray_cast(org, (tip - org).normalized(), distance=30.0)
    return (o.matrix_world @ loc).z if ok else None


def build():
    n = 0
    # 하강부 — 경사를 따라. 소핏 높이를 읽어 그 아래 0.5 m.
    for i, x in enumerate([98.0, 102.0, 106.0, 110.0, 114.0, 118.0, 122.0, 126.0]):
        for j, y in enumerate((3.1, 7.4)):
            z = soffit_z(x, y)
            if z is None:
                continue
            lamp(f"FL_Z4d_{i}_{j}", (x, y, z - 0.5), 220.0, (3.0, 1.4),
                 (0.0, math.radians(-16.0), 0.0))
            n += 1
    # 통로 — x 72~96
    for i, x in enumerate([76.0, 82.0, 88.0, 94.0]):
        for j, y in enumerate((4.2, 7.6)):
            lamp(f"FL_Z4c_{i}_{j}", (x, y, -3.05), 200.0, (2.6, 1.2))
            n += 1
    # 개찰구 — 기계 열 바로 위
    for i, y in enumerate([6.0, 11.0, 16.0, 21.0, 26.0]):
        lamp(f"FL_Z3g_{i}", (61.0, y, -3.35), 240.0, (1.0, 4.0))
        n += 1
    # 상가 앞 — 파사드를 씻는다
    for i, x in enumerate([10.9, 15.2, 19.5, 23.8, 28.1]):
        lamp(f"FL_Z2s_{i}", (x, 4.6, -3.15), 170.0, (3.4, 1.2))
        n += 1
    print(f"[hq_fill_lights] 조명 {n}개 (전부 hide_render=True)")


build()
