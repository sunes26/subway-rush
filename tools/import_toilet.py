"""
외부 양변기 모델(toilet_bowl.obj)을 게임에 쓸 수 있는 상태로 들여온다.

처음엔 MCP 일회성 명령으로 처리했다가 Blender가 파일을 다시 읽으면서 통째로 날아갔다.
외부 에셋 반입은 **스크립트로 못박는다** — 축·스케일·머티리얼·감축이 전부 판단이라
다시 할 때 같은 값이 안 나오면 배치가 어긋난다.

    exec(open(r"C:\\Users\\User\\Documents\\HACKERTON\\tools\\import_toilet.py").read())

결과: `WC_TOILET` 메시를 가진 `WC_TOILET_SRC` (렌더 제외).
배치는 `build_wc.py`의 `place_toilets()` 가 이 메시를 찾아 쓴다.
"""

import bpy
import math
import os

SRC = r"C:\Users\User\Downloads\obj\toilet_bowl.obj"
OBJ_NAME = "WC_TOILET_SRC"
MESH_NAME = "WC_TOILET"

TARGET_HEIGHT = 0.78     # 실제 양변기(물탱크 포함) 높이
DECIMATE = 0.10          # 10만 → 1만 삼각형

# 원본 머티리얼 → 씬에 이미 있는 것. 새 머티리얼을 만들면 Z2 드로우 콜이 는다.
MAT_MAP = {"porcelain": "WC_FIX", "chrome": "DUCT"}


def main() -> None:
    if not os.path.exists(SRC):
        raise SystemExit(f"원본이 없다: {SRC}")

    for n in (OBJ_NAME, "toilet_bowl"):
        o = bpy.data.objects.get(n)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)

    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=SRC)
    new = [o for o in bpy.data.objects if o not in before]
    if len(new) != 1:
        raise SystemExit(f"오브젝트가 1개가 아니다: {[o.name for o in new]}")
    o = new[0]
    o.name = OBJ_NAME

    # 임포터가 Y-up→Z-up 회전을 걸어 준다. 그걸 지우면 모델이 눕는다 —
    # 실제로 한 번 지웠다가 깊이/높이가 뒤바뀌었다. 회전은 유지한 채 굽기만 한다.
    src_h = max((o.matrix_world @ v.co).z for v in o.data.vertices) \
        - min((o.matrix_world @ v.co).z for v in o.data.vertices)
    o.scale = [s * (TARGET_HEIGHT / src_h) for s in o.scale]
    o.location = (0, 0, 0)
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    # 머티리얼 재지정 (원본 mtl 은 같이 오지 않는다)
    idx = {m.name: i for i, m in enumerate(o.data.materials)}
    remap = {}
    for i, m in enumerate(list(o.data.materials)):
        remap[i] = MAT_MAP.get(m.name, "WC_FIX")
    o.data.materials.clear()
    order = []
    for name in dict.fromkeys(remap.values()):
        o.data.materials.append(bpy.data.materials[name])
        order.append(name)
    for p in o.data.polygons:
        p.material_index = order.index(remap[p.material_index])
    for name in idx:
        m = bpy.data.materials.get(name)
        if m and m.users == 0:
            bpy.data.materials.remove(m)

    # 감축 — 원본 10만 삼각형을 6개 넣으면 프레임 시간이 2배가 된다 (§ feel.spec)
    tri0 = sum(len(p.vertices) - 2 for p in o.data.polygons)
    d = o.modifiers.new("dec", "DECIMATE")
    d.decimate_type = "COLLAPSE"
    d.ratio = DECIMATE
    bpy.ops.object.modifier_apply(modifier="dec")
    tri1 = sum(len(p.vertices) - 2 for p in o.data.polygons)

    old = bpy.data.meshes.get(MESH_NAME)
    if old and old is not o.data:
        old.name = MESH_NAME + "_old"
    o.data.name = MESH_NAME
    o.hide_render = True          # 원본은 익스포트에서 빠진다. 배치된 인스턴스만 나간다

    v = [o.matrix_world @ vv.co for vv in o.data.vertices]
    print(f"{MESH_NAME}: {tri0:,} → {tri1:,} 삼각형")
    print(f"  치수 {max(p.x for p in v)-min(p.x for p in v):.3f}"
          f" × {max(p.y for p in v)-min(p.y for p in v):.3f}"
          f" × {max(p.z for p in v)-min(p.z for p in v):.3f} m")
    print(f"  머티리얼 {[m.name for m in o.data.materials]}")


main()
