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
import json
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

# ── 라이트맵 UV ────────────────────────────────────────────────────────
# `tools/hq_lightmap.py` 가 구울 때 쓴 UV. 사이드카가 있으면 GLB에 UV를 실어 보내고,
# 없으면 이 파일은 지금까지와 **완전히 똑같이** 동작한다 (UV 미포함, 용량 그대로).
# 라이트맵을 아직 안 구운 상태에서 이 스크립트만 돌려도 안전하다는 뜻이다.
LIGHTMAP_UV = "Lightmap"
LIGHTMAP_SIDECAR = os.path.join(os.path.dirname(bpy.data.filepath), "lightmap_uv.npz")


def exportable(obj: bpy.types.Object) -> bool:
    if obj.name.startswith(RETIRED_PREFIX):
        return False
    if obj.hide_render:
        return False
    return obj.type in {"MESH", "FONT", "CURVE", "SURFACE"}


# ══════════════════════════════════════════════════════════════════════
# 라이트맵 UV pre-pass
#
# 게임 로더(render/station.ts)는 정적 메시를 **머티리얼별로 병합**한다.
# `mergeGeometries` 는 애트리뷰트 구성이 다른 지오메트리를 못 합치고 null 을 반환하는데,
# `mergeBuckets` 가 그걸 조용히 삼켜 **버킷 하나가 통째로 사라진다.**
#
# 그래서 지금 상태로 `export_texcoords=True` 만 켜면 안 된다. 실측하면 uv 있는 메시
# 1,636개 / 없는 메시 593개가 섞여 있고, **같은 존·같은 머티리얼 버킷 안에서 섞이는
# 경우가 53종**이다 (Z2 24 · Z3 11 · Z5 10 · Z1 5 · Z4 3). 그 목록에 ST_WALL ·
# ST_FLOOR · FIXTURE · CEIL_RIB 가 들어 있다 — Z2 대합실의 벽·바닥·천장이 한꺼번에
# 없어진다는 뜻이다.
#
# 해법은 UV 셋을 **하나로 평탄화**하는 것이다. Lightmap 만 남기고 나머지 UV 레이어를
# 전부 지우면 Lightmap 이 index 0 = TEXCOORD_0 이 되고, **모든 지오메트리가 정확히
# TEXCOORD_0 하나씩** 갖게 된다. 애트리뷰트가 균일해지므로 병합이 성립한다.
#
# UV 셋을 두 장(UVMap + Lightmap) 내보내지 않는 이유가 이것이다. 두 장을 내보내면
#   · uv 없는 메시는 Lightmap 이 TEXCOORD_0 이 되고, 있는 메시는 UVMap 이 TEXCOORD_0 이
#     되어 **같은 슬롯의 의미가 메시마다 달라진다** (버킷이 사라지거나 엉뚱한 UV 를 쓴다)
#   · 정점당 UV 가 2벌이라 GLB 가 약 5.2 MB 늘어난다 (한 벌이면 약 2.6 MB)
# 어차피 `IMAGE_FORMAT='NONE'` 이라 원본 UV 를 받을 텍스처가 GLB 에 없다.
# 원본 `UVMap`(1,451) · `UVChannel_1`(54) 은 **blend 에는 그대로 남는다** —
# 이 변형은 전부 인메모리이고, hq_all.py 가 save_mainfile() 을 끝낸 **뒤에** 돈다.
# ══════════════════════════════════════════════════════════════════════
def load_sidecar():
    """구울 때 쓴 UV 를 읽는다. 없으면 None."""
    if not os.path.exists(LIGHTMAP_SIDECAR):
        return None
    import numpy as np

    data = np.load(LIGHTMAP_SIDECAR, allow_pickle=False)
    return json.loads(str(data["meta"])), data["uv"]


def _set_only_uv(mesh, flat) -> None:
    """`Lightmap` 한 장만 남기고 값을 채운다 (→ TEXCOORD_0)."""
    for layer in [uv.name for uv in mesh.uv_layers if uv.name != LIGHTMAP_UV]:
        mesh.uv_layers.remove(mesh.uv_layers[layer])
    uv = mesh.uv_layers.get(LIGHTMAP_UV)
    if uv is None:
        uv = mesh.uv_layers.new(name=LIGHTMAP_UV, do_init=False)
    uv.data.foreach_set("uv", flat)
    uv.active_render = True


def _curve_to_mesh(obj, coll, ru, rv):
    """FONT/CURVE 를 인메모리 MESH 로 바꾸고 예약 텍셀 상수 UV 를 채운다.

    커브 데이터에는 파이썬으로 UV 레이어를 못 만든다. 그런데 평가하면 Blender 가
    `UVMap` 을 자동 생성하는데 그건 글자 바운딩 박스 기준 0..1 이라 아틀라스 전체를
    훑는다 — 그대로 두면 글자에 남의 그림자가 얼룩진다. 그래서 메시로 바꿔 상수로 덮는다.

    blend 에 영구 변환하지 않는 이유: `TEXT_RESOLUTION` 최적화(존 용량의 88%를 좌우했다)와
    텍스트 편집성을 잃는다. 여기서만, 이 세션에서만 바꾼다.
    """
    import numpy as np

    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    if me is None or len(me.polygons) == 0:
        return None
    tmp = bpy.data.objects.new(f"{obj.name}__lm", me)
    tmp.matrix_world = obj.matrix_world.copy()
    coll.objects.link(tmp)

    flat = np.empty(len(me.loops) * 2, dtype=np.float32)
    flat[0::2] = ru
    flat[1::2] = rv
    _set_only_uv(me, flat)

    # 원본은 익스포트에서 빠져야 중복되지 않는다 — 기존 제외 규칙을 그대로 쓴다.
    obj.hide_render = True
    return tmp


def prepare_lightmap_uv() -> bool:
    """익스포트 직전 인메모리 pre-pass. 성공하면 True (= texcoord 를 켠다)."""
    import numpy as np

    loaded = load_sidecar()
    if loaded is None:
        print("[lightmap] 사이드카 없음 → UV 없이 익스포트 (기존 동작)")
        return False
    meta, uv_all = loaded
    index, curves = meta["index"], meta["curves"]

    stale, missing, fonts, meshes = [], [], 0, 0
    for zone in ZONES:
        coll = bpy.data.collections.get(zone)
        if coll is None:
            continue
        ru, rv = meta["reserved"].get(zone, [0.0, 0.0])
        before = sum(1 for o in coll.all_objects if exportable(o))

        for obj in list(coll.all_objects):
            if not exportable(obj):
                continue
            if obj.type != "MESH":
                if _curve_to_mesh(obj, coll, ru, rv) is not None:
                    fonts += 1
                continue

            # 공유 메시를 끊는다. 안 끊으면 인스턴스끼리 UV 를 공유해
            # 서로 다른 자리의 오브젝트가 아틀라스의 같은 칸을 가리킨다.
            if obj.data.users > 1:
                obj.data = obj.data.copy()

            rec = index.get(obj.name)
            n = len(obj.data.loops)
            fp = f"{len(obj.data.vertices)}:{n}:{len(obj.data.polygons)}"
            if rec is None:
                missing.append(obj.name)
                flat = np.empty(n * 2, dtype=np.float32)
                flat[0::2], flat[1::2] = ru, rv
            elif rec["fp"] != fp or rec["count"] != n:
                stale.append(obj.name)
                flat = np.empty(n * 2, dtype=np.float32)
                flat[0::2], flat[1::2] = ru, rv
            else:
                off = rec["offset"]
                flat = uv_all[off:off + n * 2]
            _set_only_uv(obj.data, flat)
            meshes += 1

        after = sum(1 for o in coll.all_objects if exportable(o))
        if before != after:
            raise RuntimeError(f"{zone}: pre-pass 가 대상 수를 바꿨다 {before} → {after}")

    print(f"[lightmap] UV 적용: 메시 {meshes} · FONT→MESH {fonts} "
          f"(사이드카 {len(index)} · 커브 {len(curves)})")
    if missing:
        print(f"[lightmap] ⚠ 사이드카에 없음 {len(missing)}개 → 예약 텍셀: {missing[:5]}")
    if stale:
        print(f"[lightmap] ⚠ 베이크 후 형상이 바뀜 {len(stale)}개 → 예약 텍셀: {stale[:5]}")
        print("[lightmap]   hq_lightmap.py 를 다시 돌려야 한다")
    return True


def export_zone(zone: str, texcoords: bool = False) -> tuple[int, int]:
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
        # 라이트맵을 구웠을 때만 UV를 내보낸다 (Lightmap 한 장 = TEXCOORD_0).
        # 안 구웠으면 로더가 어차피 병합 직전에 버리므로 빼는 쪽이 용량에 이득이다.
        # 탄젠트는 어느 경우에도 쓰지 않는다.
        export_texcoords=texcoords,
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

    # ⚠ 반드시 텍스트 해상도를 낮춘 **뒤에** 돈다. pre-pass 가 FONT 를 메시로
    #   변환하는데, 그 시점의 resolution_u 가 그대로 굳는다.
    texcoords = prepare_lightmap_uv()

    total = 0
    for zone in ZONES:
        count, size = export_zone(zone, texcoords)
        total += size
        print(f"{zone}: {count} objects, {size / 1024:.0f} KB")
    print(f"TOTAL: {total / 1024:.0f} KB")


main()
