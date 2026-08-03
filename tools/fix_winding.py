"""안팎이 뒤집힌 메시를 찾아 바로잡는다.

게임 셰이더는 three 기본값 `FrontSide`라 뒷면을 안 그린다. 그래서 상자의 감김이
뒤집히면 **바깥 면이 잘리고 반대편 안쪽 면이 대신 그려진다.** 얇은 판이면 색이 비슷해
몇 시간을 모르고 지나가지만, 두꺼운 것에서는 대상이 제 두께만큼 밀려 보이고
모서리에서 속이 비친다. 이 프로젝트에서 같은 뿌리의 결함이 여덟 번 나왔고
이번이 아홉 번째다.

판정은 눈이 아니라 **부호 있는 부피**로 한다. 닫힌 메시의 signed volume 은
법선이 바깥을 향할 때 양수다. 음수면 통째로 뒤집힌 것이다.
열린(판형) 메시는 이 방법으로 판정할 수 없으므로 건드리지 않는다 —
한 면짜리 데칼·사인은 자리마다 향해야 할 쪽이 다르다.
"""

from __future__ import annotations

import bmesh
import bpy

SKIP = ("xx_", "_COL")


def survey():
    """(뒤집힘, 판형) 목록."""
    inverted, open_meshes = [], []
    for o in bpy.data.objects:
        if o.type != "MESH" or not o.data.polygons or o.name.startswith(SKIP):
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        closed = bool(bm.edges) and all(len(e.link_faces) == 2 for e in bm.edges)
        vol = bm.calc_volume(signed=True) if closed else 0.0
        bm.free()
        if not closed:
            open_meshes.append(o.name)
        elif vol < -1e-9:
            inverted.append((o.name, vol))
    return inverted, open_meshes


def repair(dry_run=False):
    inverted, open_meshes = survey()
    inverted.sort(key=lambda r: r[1])
    print(f"뒤집힌 닫힌 메시 {len(inverted)}개 · 판정 불가(판형) {len(open_meshes)}개")
    for name, vol in inverted:
        print(f"  {name:28s} {vol:12.3f} m³")
    if dry_run:
        return inverted

    for name, _ in inverted:
        o = bpy.data.objects[name]
        bm = bmesh.new()
        bm.from_mesh(o.data)
        for f in bm.faces:
            f.normal_flip()
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()

    left, _ = survey()
    print(f"수정 후 남은 뒤집힘: {len(left)}개")
    for name, vol in left:
        print(f"  남음 {name} {vol:.3f}")
    return left


if __name__ != "__main__" or True:
    repair()
