"""
station_map.blend → 게임용 존별 GLB.

Blender 안에서 실행한다 (MCP `execute_blender_code` 또는 `blender -b ... -P`).
이전까지 익스포트는 애드혹으로 돌려서 재현이 안 됐다 — 어떤 오브젝트가 왜 빠졌는지
추적할 수 없으면 "출입구가 사라진" 종류의 사고를 또 낸다. 규칙을 코드로 못박는다.

제외 규칙
  1. 게임 로직용/작업용 컬렉션 (CROWD·DEBUG·LIGHTS·ANNOT·CHARACTERS)
  2. `hide_render` 가 켜진 오브젝트 — 블렌더에서 의도적으로 끈 것
  3. 이름이 `xx_` 로 시작 — 폐기했지만 크래시 위험 때문에 지우지 않고 남겨둔 것
     (오브젝트 삭제 후 전체 순회는 Blender를 죽인다. 삭제 대신 개명해서 격리한다.)
"""

import bpy
import os

ZONES = ["Z1_GROUND", "Z2_CONCOURSE", "Z3_GATES", "Z4_DESCENT", "Z5_PLATFORM", "Z5_TRAIN"]

OUT_DIR = os.path.join(
    os.path.dirname(bpy.data.filepath), "..", "game", "public", "models", "map"
)

RETIRED_PREFIX = "xx_"

# 텍스트 곡선 분할 수. 글리프 하나가 곧 폴리곤 덩어리라 여기가 용량을 지배한다.
#
# 계측: Z5_PLATFORM(FONT 45개) 기준
#   resolution_u=12(기본) → 4,378 KB · =2 → 1,485 KB · =1 → 아래 값
#   같은 존을 FONT 없이 뽑으면 510 KB다. 즉 12에서는 **용량의 88%가 글자**였다.
# 게임은 텍스처를 쓰지 않아 글자는 실루엣으로만 읽힌다 — 곡선을 세밀하게 쪼갤 이유가 없다.
TEXT_RESOLUTION = 1

# 임포트 에셋(버스 등)이 물고 온 텍스처를 GLB에 넣지 않는다.
# 로더가 어차피 벗겨내고 MATERIAL_TINT로 색을 다시 준다 (render/station.ts).
IMAGE_FORMAT = "NONE"


def exportable(obj: bpy.types.Object) -> bool:
    if obj.name.startswith(RETIRED_PREFIX):
        return False
    if obj.hide_render:
        return False
    return obj.type in {"MESH", "FONT", "CURVE", "SURFACE"}


def export_zone(zone: str) -> tuple[int, int]:
    coll = bpy.data.collections.get(zone)
    if coll is None:
        raise RuntimeError(f"collection missing: {zone}")

    bpy.ops.object.select_all(action="DESELECT")
    n = 0
    for obj in coll.all_objects:
        if exportable(obj):
            obj.select_set(True)
            n += 1
    if n == 0:
        raise RuntimeError(f"nothing to export in {zone}")
    bpy.context.view_layer.objects.active = next(
        o for o in coll.all_objects if o.select_get()
    )

    path = os.path.normpath(os.path.join(OUT_DIR, f"{zone}.glb"))
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_normals=True,
        # UV·탄젠트는 게임 로더가 병합 직전에 버린다. 여기서 안 내보내면 용량이 준다.
        export_texcoords=False,
        export_tangents=False,
        export_animations=False,
        export_image_format=IMAGE_FORMAT,
    )
    return n, os.path.getsize(path)


def main() -> None:
    # 숨겨진 오브젝트도 select_set 하려면 뷰레이어에서 보여야 한다
    for obj in bpy.data.objects:
        obj.hide_set(False)

    for curve in bpy.data.curves:
        if isinstance(curve, bpy.types.TextCurve):
            curve.resolution_u = TEXT_RESOLUTION
            curve.render_resolution_u = 0

    total = 0
    for zone in ZONES:
        count, size = export_zone(zone)
        total += size
        print(f"{zone}: {count} objects, {size / 1024:.0f} KB")
    print(f"TOTAL: {total / 1024:.0f} KB")


main()
