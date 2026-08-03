"""진단 — 영역 안에 있는 오브젝트를 이름·머티리얼·바운딩으로 나열한다(읽기 전용).

`diag_float` 는 정점 아일랜드로 쪼갰다가 폰트 커브의 획 하나하나가 아일랜드로
잡혀 쓸모가 없었다. 웹 `pick()` 이 알려주는 건 **머티리얼 이름과 히트 좌표**뿐이라,
그 좌표를 감싸는 상자를 주고 "거기 뭐가 있나"를 묻는 쪽이 실제로 쓰인다.

    blender -b assets/station_map.blend -P tools/diag_box.py -- x0,y0,z0,x1,y1,z1 [머티리얼필터]
"""

from __future__ import annotations

import sys

import bpy
from mathutils import Vector

MIN_SPAN = 0.0


def bounds(ob):
    mw = ob.matrix_world
    pts = [mw @ Vector(c) for c in ob.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def overlaps(lo, hi, b):
    return not (hi.x < b[0] or lo.x > b[3] or hi.y < b[1] or lo.y > b[4]
                or hi.z < b[2] or lo.z > b[5])


def run(box, mfilter):
    rows = []
    for ob in bpy.data.objects:
        if ob.type not in {"MESH", "FONT"}:
            continue
        try:
            lo, hi = bounds(ob)
        except Exception:
            continue
        if not overlaps(lo, hi, box):
            continue
        mats = [m.name for m in ob.data.materials if m]
        if mfilter and not any(mfilter in m for m in mats):
            continue
        vis = "" if ob.visible_get() else " (숨김)"
        nfaces = len(ob.data.polygons) if ob.type == "MESH" else 0
        rows.append((ob.name, mats[:2], nfaces, lo, hi, vis))
    rows.sort(key=lambda r: r[0])
    for name, mats, nf, lo, hi, vis in rows:
        print(f"{name:32s}{vis} f={nf:<6d} {mats}  "
              f"x[{lo.x:7.2f},{hi.x:7.2f}] y[{lo.y:6.2f},{hi.y:6.2f}] z[{lo.z:7.2f},{hi.z:7.2f}]")
    print(f"[diag_box] {len(rows)}개")


argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
b = [float(v) for v in argv[0].split(",")]
run(b, argv[1] if len(argv) > 1 else None)
