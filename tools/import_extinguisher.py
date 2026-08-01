"""
외부 에셋 반입 — 한국형 소화기 (Poly Haven, CC0).

출처: https://polyhaven.com/a/korean_fire_extinguisher_01  (CC0 · 10K 삼각형 · 0.7 m)
받은 파일: assets/ext/korean_fire_extinguisher_01_1k.blend

**한국 소화기**라서 골랐다. 받침대에 「소화기」가 찍혀 있고 라벨도 국내 규격이라
서울 지하철 대합실에 그대로 어울린다. 직접 만들면 이 정도 형상은 안 나온다.

반입 규칙은 `import_toilet.py` 에서 정한 것과 같다.
  1. **스크립트로 못박는다** — 축·스케일·머티리얼·감축이 전부 판단이라
     다시 할 때 값이 달라지면 배치가 어긋난다
  2. 머티리얼은 **씬에 이미 있는 것으로 갈아끼운다** — 새 머티리얼은 곧 드로우 콜이다
  3. 감축한다 — 원본 10K 를 그대로 여러 개 놓으면 삼각형 예산이 날아간다

    exec(open(r"C:\\Users\\User\\Documents\\HACKERTON\\tools\\import_extinguisher.py").read())
"""

import bpy
import os

SRC = r"C:\Users\User\Documents\HACKERTON\assets\ext\korean_fire_extinguisher_01_1k.blend"
MESH_NAME = "EXT_KR"
SRC_OBJ = "EXT_KR_SRC"
TARGET_H = 0.72          # 받침대 포함 실제 높이
DECIMATE = 0.14          # 10K → 약 1.4K

COLL = "Z2_CONCOURSE"
# 몸통은 붉은색, 호스·금구는 어두운색. 둘 다 Z2 에 이미 있는 머티리얼이다.
BODY_MAT, DARK_MAT = "WC_RED", "VM_TRIM"

# 배치 — 대합실 기둥 옆과 벽면. 실제로도 기둥마다 붙어 있다.
SPOTS = [
    (12.9, 9.0), (30.9, 9.0), (48.9, 9.0),
    (12.9, 21.0), (30.9, 21.0), (48.9, 21.0),
]
FLOOR = -6.00


def _append():
    for n in (SRC_OBJ,):
        o = bpy.data.objects.get(n)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)
    if not os.path.exists(SRC):
        raise SystemExit(f"원본이 없다: {SRC}")

    before = set(bpy.data.objects)
    with bpy.data.libraries.load(SRC, link=False) as (src, dst):
        dst.objects = [n for n in src.objects]
    new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if not new:
        raise SystemExit("메시가 안 들어왔다")

    # 여러 조각으로 나뉘어 오면 하나로 합친다
    for o in new:
        bpy.context.scene.collection.objects.link(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in new:
        o.select_set(True)
    bpy.context.view_layer.objects.active = new[0]
    if len(new) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = SRC_OBJ
    return o


def main():
    o = _append()

    # 크기·원점 정리. 바닥이 z=0 에 오게 내린다 — 배치할 때 바닥 높이만 더하면 되도록.
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    zs = [(o.matrix_world @ v.co).z for v in o.data.vertices]
    h = max(zs) - min(zs)
    o.scale = [s * (TARGET_H / h) for s in o.scale]
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(scale=True)
    zs = [(o.matrix_world @ v.co).z for v in o.data.vertices]
    xs = [(o.matrix_world @ v.co).x for v in o.data.vertices]
    ys = [(o.matrix_world @ v.co).y for v in o.data.vertices]
    o.location = (-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, -min(zs))
    bpy.ops.object.transform_apply(location=True)

    # 머티리얼 교체 — 원본 PBR 을 버리고 씬 머티리얼로.
    #
    # ⚠ 처음엔 Base Color 로 빨강을 골라내려 했는데 **전부 어두운색으로 잡혔다**.
    # PBR 에셋은 색이 텍스처에 있고 Base Color 는 흰색으로 두는 게 보통이라
    # 노드 값으로는 무슨 색인지 알 수 없다. 이름으로 고른다 —
    # Poly Haven 은 `<asset>_body` / `_paper` / `_glass` 로 이름을 붙인다.
    old = [m for m in o.data.materials if m]
    pick = []
    for m in old:
        n = m.name.lower()
        pick.append(BODY_MAT if ("body" in n or "paper" in n) else DARK_MAT)
    o.data.materials.clear()
    order = list(dict.fromkeys(pick)) or [BODY_MAT]
    for n in order:
        o.data.materials.append(bpy.data.materials[n])
    for i, p in enumerate(o.data.polygons):
        src_i = min(p.material_index, len(pick) - 1) if pick else 0
        p.material_index = order.index(pick[src_i]) if pick else 0
    for m in old:
        if m.users == 0:
            bpy.data.materials.remove(m)

    tri0 = sum(len(p.vertices) - 2 for p in o.data.polygons)
    d = o.modifiers.new("dec", "DECIMATE")
    d.decimate_type = "COLLAPSE"
    d.ratio = DECIMATE
    bpy.ops.object.modifier_apply(modifier="dec")
    tri1 = sum(len(p.vertices) - 2 for p in o.data.polygons)

    o.data.name = MESH_NAME
    o.hide_render = True            # 원본은 익스포트에서 빠진다

    # 배치 — 메시를 **공유**한다. 6벌을 따로 구우면 glTF 가 6배가 된다.
    for i, (x, y) in enumerate(SPOTS):
        n = f"Z2_OBJ35_ext{i}"
        old_o = bpy.data.objects.get(n)
        if old_o:
            bpy.data.objects.remove(old_o, do_unlink=True)
        inst = bpy.data.objects.new(n, o.data)
        inst.location = (x, y, FLOOR)
        bpy.data.collections[COLL].objects.link(inst)

    print(f"소화기 반입 — {tri0:,} → {tri1:,} 삼각형 · 높이 {TARGET_H} m")
    print(f"  머티리얼 {[m.name for m in o.data.materials]} (전부 기존)")
    print(f"  배치 {len(SPOTS)}개 · 메시 공유 (glTF 에는 1벌만 실린다)")


main()
