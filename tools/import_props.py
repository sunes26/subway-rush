"""외부 에셋 반입 — 역 소품 7종 (Poly Haven, 전부 CC0).

역을 실사처럼 보이게 하는 것의 상당 부분은 건축이 아니라 **잡동사니**다.
쓰레기통 · 공중전화 · 화분 · 청소 표지 · 화재경보기 · CCTV · 맨홀.
직접 만들면 상자 대여섯 개짜리가 되고, 그게 모여 "그레이박스 티"가 된다.
받아 쓰는 편이 형상도 좋고 빠르다.

반입 규칙은 `assets/ext/README.md` 에 정한 것을 그대로 따른다.

  1. 스크립트로 못박는다 — 축·스케일·머티리얼·감축이 전부 판단이다
  2. 머티리얼은 **씬에 이미 있는 것으로** 갈아끼운다 (새 머티리얼 = 드로우 콜)
  3. 감축한다
  4. 여러 벌은 **메시를 공유**한다

⚠ PBR 에셋의 머티리얼은 **이름으로** 고른다. 색은 텍스처에 있고 Base Color 는
보통 흰색이라 노드 값으로는 무슨 색인지 알 수 없다.

⚠ 오브젝트 삭제 직후 `bpy.data.objects` 전체 순회는 Blender 를 죽인다.
정리는 `xx_` 개명 + `hide_render` 로 한다.
"""

from __future__ import annotations

import os

import bpy

EXT = r"C:\Users\User\Documents\HACKERTON\assets\ext"
FLOOR_Z2 = -6.00
FLOOR_Z5 = -20.00
CEIL_Z2 = -2.80
CEIL_Z5 = -15.50

# 이름 → (파일, 목표 높이 m, 감축률, 머티리얼 규칙, 배치)
#   머티리얼 규칙: (키워드 → 씬 머티리얼) 목록 · 마지막이 기본값
PROPS = {
    # ⚠ 이 에셋은 **통 두 개가 나란히 들어 있는 한 덩어리**다. 정규화 뒤 실측하면
    # 로컬 x −0.904…+0.898 (폭 1.80 m) 이고 통 몸통이 x −0.72…−0.16 과 +0.11…+0.30
    # 두 군데다. 즉 한 배치 = 통 두 개다. 배치 좌표를 잡을 때 폭을 0.5 m 로
    # 생각하면 반드시 옆에 있는 것과 겹친다 — 실제로 소화기와 겹쳤다.
    "TRASH": dict(
        # 0.92 → 1.10 (약 20 %). 디렉터 요청. 폭도 같이 1.80 → 2.16 m 로 커지므로
        # 아래 배치 간격을 그만큼 벌려 두었다.
        src="metal_trash_can_1k.blend", height=1.10, dec=0.06,
        # 원본 머티리얼은 `metal_trash_can` 과 `metal_trash_can_rust` 둘뿐이다.
        # `lid` 를 키워드로 뒀더니 **하나도 안 맞아** 전부 기본값(거의 검정)으로 가서
        # 게임에서 검은 덩어리 두 개가 됐다. 기본값을 스테인리스로 돌린다.
        mats=[("rust", "VM_TRIM"), ("", "HQ_STEEL")],
        # 소화기(`import_extinguisher.py` SPOTS)는 x 12.9 · 30.9 · 48.9, y 9 · 21 이다.
        # 쓰레기통이 13.6 / 31.6 / 49.6 에 있었으니 중심 간격이 0.7 m — 통 반폭
        # (1.08 m, 20 % 키운 뒤) 보다 좁아 셋 다 소화기를 물고 있었다.
        # 기둥(x 12 · 24 · 26 · 36 · 48, 반지름 0.55)도 피해서 x 를 옮긴다.
        #   16.0 → 통 x 14.92…17.08 (기둥 12 와 1.4 m · 소화기 12.9 와 2.0 m)
        #   34.0 → 통 x 32.92…35.08 (기둥 36 과 0.37 m · 소화기 30.9 와 1.9 m)
        #   52.0 → 통 x 50.92…53.08 (기둥 48 과 2.4 m · 벽 56 과 2.9 m)
        spots=[("Z2_CONCOURSE", 16.0, 9.0, FLOOR_Z2, 0.0),
               ("Z2_CONCOURSE", 34.0, 21.0, FLOOR_Z2, 0.0),
               ("Z2_CONCOURSE", 52.0, 9.0, FLOOR_Z2, 0.0),
               # **Z3(개찰구 존)에는 쓰레기통을 두지 않는다.** 자리 두 곳을 차례로 뺐다 —
               # (57.2, 20.0) 다음에 (57.2, 12.0). 디렉터 지시이고, 실제 역사에서도
               # 개찰구 앞은 통행이 몰리는 구간이라 집기를 안 놓는다.
               # 한 배치가 통 두 개이므로 자리 하나 = 통 두 개다. 자리를 빼면 뒤 인덱스가
               # 당겨지는데, 아래 유령 정리가 남는 옛 이름을 `xx_` + `hide_render` 로
               # 격리하고 `export_station.exportable()` 이 둘 다 거부한다.
               ("Z5_PLATFORM", 100.6, 1.1, FLOOR_Z5, 0.0),
               ("Z5_PLATFORM", 132.6, 1.1, FLOOR_Z5, 0.0),
               ("Z5_PLATFORM", 164.6, 1.1, FLOOR_Z5, 0.0),
               ("Z5_PLATFORM", 188.6, 1.1, FLOOR_Z5, 0.0)],
    ),
    "PHONE": dict(
        src="korean_public_payphone_01_1k.blend", height=1.55, dec=0.03,
        mats=[("glass", "ST_GLASS"), ("body", "WC_BLUE"), ("", "VM_TRIM")],
        spots=[("Z2_CONCOURSE", 6.0, 0.55, FLOOR_Z2, 0.0),
               ("Z2_CONCOURSE", 7.6, 0.55, FLOOR_Z2, 0.0)],
    ),
    # 감축률 0.34 로 뽑았더니 한 벌이 31,405 삼각형이었다. 다섯 벌이면 157k —
    # Z2 삼각형 예산을 이것 하나가 절반 넘게 먹었다. 잎이 실루엣으로 읽히는
    # 하한이 0.14 근처다. 개수도 5 → 3.
    "PLANT": dict(
        src="potted_plant_01_1k.blend", height=1.35, dec=0.055,
        # 잎에 `GB_PATH`(0.1, 0.85, 0.45)를 썼다가 형광 초록 덩어리가 됐다.
        # 그 색은 유도선 판정용이지 식물색이 아니다.
        #
        # 그리고 이 에셋은 **머티리얼이 하나뿐**이다(`potted_plant_01_pot`).
        # 색이 전부 텍스처에 있어서 이름으로는 화분과 잎을 못 가른다 —
        # 이름 규칙만 믿었더니 잎까지 흙색이 되어 마른 가지 뭉치가 됐다.
        # 그래서 이 종만 **높이로** 가른다 (`split_z`).
        mats=[("pot", "HQ_PLANT_POT"), ("", "HQ_PLANT_POT")],
        split_z=(0.34, "HQ_PLANT_POT", "HQ_FOLIAGE"),
        # y 15 는 바닥 안내 데칼이 흐르는 축이다 — 화분이 그 위에 올라섰다.
        # 통행 축에서 비켜 기둥 사이에 놓는다.
        spots=[("Z2_CONCOURSE", 10.6, 12.2, FLOOR_Z2, 0.0)],
    ),
    "WETSIGN": dict(
        src="WetFloorSign_01_1k.blend", height=0.62, dec=0.45,
        mats=[("", "CART_SIGN")],
        spots=[("Z2_CONCOURSE", 27.0, 24.0, FLOOR_Z2, 0.6),
               ("Z5_PLATFORM", 152.0, 2.4, FLOOR_Z5, -0.5)],
    ),
    "ALARM": dict(
        src="fire_alarm_1k.blend", height=0.24, dec=0.50,
        mats=[("", "WC_RED")],
        spots=[("Z2_CONCOURSE", 12.0, 9.42, FLOOR_Z2 + 2.15, 0.0),
               ("Z2_CONCOURSE", 36.0, 9.42, FLOOR_Z2 + 2.15, 0.0),
               ("Z3_GATES", 56.15, 14.0, FLOOR_Z2 + 2.15, 1.5708),
               ("Z5_PLATFORM", 108.0, 0.14, FLOOR_Z5 + 2.15, 0.0),
               ("Z5_PLATFORM", 172.0, 0.14, FLOOR_Z5 + 2.15, 0.0)],
    ),
    # 천장에 매달린 30 cm 짜리다 — 눈높이에서 실루엣으로만 읽힌다. 크게 깎아도 된다.
    "CCTV": dict(
        src="security_camera_01_1k.blend", height=0.30, dec=0.03,
        mats=[("", "HQ_CEIL_DEVICE")],
        spots=[("Z2_CONCOURSE", 18.0, 15.0, CEIL_Z2 - 0.34, 2.4),
               ("Z2_CONCOURSE", 42.0, 15.0, CEIL_Z2 - 0.34, 3.9),
               ("Z3_GATES", 62.0, 16.0, CEIL_Z2 - 0.34, 3.1),
               ("Z5_PLATFORM", 116.0, 1.0, CEIL_Z5 - 0.34, 1.0),
               ("Z5_PLATFORM", 180.0, 1.0, CEIL_Z5 - 0.34, 1.0)],
    ),
    "MANHOLE": dict(
        src="water_manhole_cover_1k.blend", height=0.06, dec=0.08,
        mats=[("", "HQ_FLOOR_HATCH")],
        spots=[("Z1_GROUND", -30.0, 24.0, 0.01, 0.0),
               ("Z1_GROUND", -12.0, 26.0, 0.01, 0.7)],
    ),
}


def _append(path, tmp_name):
    before = set(bpy.data.objects)
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = list(src.objects)
    new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if not new:
        raise SystemExit(f"메시가 안 들어왔다: {path}")
    for o in new:
        bpy.context.scene.collection.objects.link(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in new:
        o.select_set(True)
    bpy.context.view_layer.objects.active = new[0]
    if len(new) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = tmp_name
    return o


def _normalize(o, target_h):
    """바닥이 z=0, 중심이 원점에 오게 맞추고 목표 높이로 스케일."""
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    co = [o.matrix_world @ v.co for v in o.data.vertices]
    h = max(c.z for c in co) - min(c.z for c in co)
    if h > 1e-6:
        o.scale = [s * (target_h / h) for s in o.scale]
    bpy.ops.object.transform_apply(scale=True)
    co = [o.matrix_world @ v.co for v in o.data.vertices]
    o.location = (-(min(c.x for c in co) + max(c.x for c in co)) / 2,
                  -(min(c.y for c in co) + max(c.y for c in co)) / 2,
                  -min(c.z for c in co))
    bpy.ops.object.transform_apply(location=True)


def _reskin(o, rules):
    """원본 PBR 머티리얼을 씬 머티리얼로 갈아끼운다. **이름으로** 고른다."""
    old = [m for m in o.data.materials if m]
    pick = []
    for m in old:
        low = m.name.lower()
        target = rules[-1][1]
        for key, name in rules[:-1]:
            if key and key in low:
                target = name
                break
        pick.append(target)
    if not pick:
        pick = [rules[-1][1]]
    order = list(dict.fromkeys(pick))
    o.data.materials.clear()
    for name in order:
        m = bpy.data.materials.get(name)
        if m is None:
            raise SystemExit(f"씬에 없는 머티리얼: {name}")
        o.data.materials.append(m)
    for p in o.data.polygons:
        src_i = min(p.material_index, len(pick) - 1)
        p.material_index = order.index(pick[src_i])
    for m in old:
        if m.users == 0:
            bpy.data.materials.remove(m)


def _split_by_height(o, cut, below, above):
    """면의 높이로 머티리얼을 가른다.

    PBR 에셋이 머티리얼 하나로 화분과 잎을 다 덮는 경우가 있다. 색이 전부 텍스처에
    있어서 이름으로는 못 가르므로, 감축 **뒤에** 면 중심의 z 로 나눈다.
    (감축 전에 나누면 콜랩스가 경계를 뭉갠다.)
    """
    names = [below, above]
    o.data.materials.clear()
    for n in names:
        m = bpy.data.materials.get(n)
        if m is None:
            raise SystemExit(f"씬에 없는 머티리얼: {n}")
        o.data.materials.append(m)
    lo = min(v.co.z for v in o.data.vertices)
    for p in o.data.polygons:
        p.material_index = 1 if (p.center.z - lo) > cut else 0


def _decimate(o, ratio):
    tri0 = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if ratio < 1.0:
        d = o.modifiers.new("dec", "DECIMATE")
        d.decimate_type = "COLLAPSE"
        d.ratio = ratio
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier="dec")
    return tri0, sum(len(p.vertices) - 2 for p in o.data.polygons)


def one(tag, spec):
    path = os.path.join(EXT, spec["src"])
    if not os.path.exists(path):
        print(f"  [{tag}] 원본 없음 — 건너뜀 ({spec['src']})")
        return 0
    src_name = f"EXTSRC_{tag}"
    stale = bpy.data.objects.get(src_name)
    if stale is not None:                    # 삭제 대신 개명 — 삭제는 씬을 죽인다
        stale.name = "xx_" + src_name
        stale.hide_render = True
        stale.hide_viewport = True

    try:
        o = _append(path, src_name)
    except Exception as err:
        # 원본 하나가 안 읽힌다고 나머지 여섯 종의 반입을 통째로 버릴 이유가 없다.
        print(f"  [{tag}] 원본을 못 읽었다 — 건너뜀 ({err})")
        return 0
    _normalize(o, spec["height"])
    _reskin(o, spec["mats"])
    tri0, tri1 = _decimate(o, spec["dec"])
    if spec.get("split_z"):
        _split_by_height(o, *spec["split_z"])
    o.data.name = f"EXT_{tag}"
    o.hide_render = True
    o.hide_viewport = True                   # 원본은 익스포트·뷰포트 양쪽에서 뺀다

    for i, (coll, x, y, z, rot) in enumerate(spec["spots"]):
        name = f"{coll.split('_')[0]}_EXT_{tag}{i}"
        inst = bpy.data.objects.get(name)
        if inst is None:
            inst = bpy.data.objects.new(name, o.data)
            bpy.data.collections[coll].objects.link(inst)
        else:
            inst.data = o.data
        inst.location = (x, y, z)
        inst.rotation_euler = (0, 0, rot)
        inst.hide_render = False
        inst.hide_viewport = False

    # 인스턴스 이름이 **인덱스에 묶여 있다.** 배치 개수를 5 → 3 으로 줄였더니
    # `..._PLANT4` 가 옛 고해상도 메시(31,405면)를 든 채 유령으로 남아 렌더에 들어갔다.
    # 지금 목록에 없는 번호는 폐기한다 (삭제는 씬을 죽이므로 `xx_` 개명).
    live = {f"{c.split('_')[0]}_EXT_{tag}{i}" for i, (c, *_) in enumerate(spec["spots"])}
    orphans = [o for o in bpy.data.objects
               if f"_EXT_{tag}" in o.name and not o.name.startswith("xx_")
               and o.name not in live]
    for o in orphans:
        o.name = "xx_" + o.name
        o.hide_render = True
        o.hide_viewport = True
    tail = f" · 유령 {len(orphans)}개 폐기" if orphans else ""
    print(f"  [{tag}] {tri0:,}→{tri1:,} 삼각형 · {len(spec['spots'])}벌 (메시 공유){tail}")
    return len(spec["spots"])


def _ensure_materials():
    """이 스크립트가 필요로 하는데 씬에 없던 머티리얼."""
    import hq_lib
    hq_lib.mat("HQ_FOLIAGE", (0.16, 0.40, 0.19), roughness=0.75)
    hq_lib.mat("HQ_PLANT_POT", (0.42, 0.38, 0.34), roughness=0.65)


def main():
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))
                    if "__file__" in dir() else r"C:\Users\User\Documents\HACKERTON\tools")
    _ensure_materials()
    total = 0
    for tag, spec in PROPS.items():
        total += one(tag, spec)
    print(f"[import_props] 소품 {total}개 배치")


main()
