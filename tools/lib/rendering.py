"""프리뷰 렌더 드라이버.

규격 — 340x460/뷰, 4면도 = 1360x460, 스프라이트 170x220 x15, 다크 배경.
`FLAT=1` 이면 머티리얼을 무채색으로 치환해 렌더한다. **색 없이 실루엣만으로
구별되는가**를 보는 용도다.
"""
import bpy
import json
import math
import os

from lib.blend import need_obj

NS = 15                  # AJ 규격: 액션당 15 샘플
VIEWS = [("front", 0), ("q34", 40), ("side", 90), ("back", 180), ("topq", 40)]

# 원본 .blend 의 카메라는 AJ 2인 샷(380x512)용이라 1인 340x460 규격과 프레이밍이
# 다르다. 기존 프리뷰의 화면 점유율(캐릭터 높이 ≈ 프레임 85%)에 맞춰 재계산했다.
# 주의: sensor_fit='VERTICAL' 이면 sensor_width 가 아니라 sensor_height(24mm)를 쓴다.
CAM_TILT, CAM_Y, CAM_Z, CAM_LENS = 85.0, -4.0077, 0.843, 89.0


def _flatten_materials():
    for m in bpy.data.materials:
        if not m.node_tree:
            continue
        n = next((x for x in m.node_tree.nodes if x.type == 'BSDF_PRINCIPLED'), None)
        if n is None:
            continue
        n.inputs["Base Color"].default_value = (0.72, 0.72, 0.72, 1.0)
        if "Emission Strength" in n.inputs:
            n.inputs["Emission Strength"].default_value = 0.0


def _prop_setter(spec, variant):
    """클립 이름 → 어느 프롭을 보일지. spec 의 선언만 읽는다.

    엔진도 같은 규칙을 쓰므로 여기 로직이 곧 연동 명세다.
    """
    pv = spec.get("prop_visibility")
    objs = {p["name"]: need_obj(p["name"]) for p in spec["props"]}
    if not pv:
        def noop(_name):
            return
        return noop

    hand = pv["hand"]            # {오브젝트: 그룹키}
    stowed = pv["stowed"]        # {오브젝트: 그룹키}
    groups = {k: pv[k] for k in set(hand.values()) | set(stowed.values())}
    if variant is None:
        variant = pv.get("default")
        if variant is None:
            raise RuntimeError("spec %s: prop_visibility needs a 'default' variant"
                               % spec["code"])
    if variant not in groups:
        raise RuntimeError("unknown variant %r (have %s)" % (variant, sorted(groups)))

    def setter(name):
        # 어느 그룹의 클립인가
        active = next((k for k, s in groups.items() if name in s), None)
        for obj_name, key in hand.items():
            # 이 클립이 그 그룹의 '손에 든' 클립일 때만 보인다.
            show = (active == key)
            # 공유 클립(어느 그룹에도 없음)에서는 선택한 변형의 손 프롭을 쓴다.
            if active is None:
                show = False
            objs[obj_name].hide_render = not show
        for obj_name, key in stowed.items():
            # 손에 안 든 상태에서만, 그리고 그 변형을 볼 때만 보인다.
            show = (active is None) and (key == variant)
            objs[obj_name].hide_render = not show

    return setter


def run(spec, outdir, mode="all", flat=False, variant=None):
    os.makedirs(outdir, exist_ok=True)
    rig = need_obj(spec["rig"])
    cam = need_obj("Camera")
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.film_transparent = False

    set_props = _prop_setter(spec, variant)
    set_props("__rest__")

    if flat:
        _flatten_materials()

    # 캐릭터를 세계 원점 기준으로 회전시키기 위한 부모 엠프티
    piv = bpy.data.objects.new(spec["code"].upper() + "_Pivot", None)
    sc.collection.objects.link(piv)
    piv.location = (0, 0, 0)
    rig.parent = piv
    rig.matrix_parent_inverse = piv.matrix_world.inverted()

    cam.data.sensor_fit = 'VERTICAL'
    cam.data.sensor_width = 36.0
    cam.data.sensor_height = 24.0
    cam.data.type = 'PERSP'

    def cam_normal():
        cam.location = (0.0, CAM_Y, CAM_Z)
        cam.rotation_euler = (math.radians(CAM_TILT), 0.0, 0.0)
        cam.data.lens = CAM_LENS

    def cam_topq():
        cam.location = (0.0, -2.26, 2.75)
        cam.rotation_euler = (math.radians(45.0), 0.0, 0.0)
        cam.data.lens = 72.0

    cam_normal()

    def render(path, w, h):
        sc.render.resolution_x = w
        sc.render.resolution_y = h
        sc.render.resolution_percentage = 100
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)

    def set_action(name):
        a = bpy.data.actions.get(name)
        if a is None:
            raise RuntimeError("missing action: %s" % name)
        ad = rig.animation_data or rig.animation_data_create()
        ad.action = a
        set_props(name)
        return a

    # 4면도는 대표 정지 클립에서 뽑는다
    rest = spec.get("rest_clip")
    if rest not in spec["clips"]:
        raise RuntimeError("spec %s: rest_clip %r not in clips" % (spec["code"], rest))
    if mode in ("views", "all"):
        set_action(rest)
        sc.frame_set(1)
        for name, yaw in VIEWS:
            piv.rotation_euler = (0, 0, math.radians(yaw))
            cam_topq() if name == "topq" else cam_normal()
            bpy.context.view_layer.update()
            render(os.path.join(outdir, "view_%s.png" % name), 340, 460)
        piv.rotation_euler = (0, 0, 0)
        cam_normal()

    if mode in ("sheets", "all"):
        piv.rotation_euler = (0, 0, math.radians(28))
        meta = []
        # 씬에 실제로 있는 액션과 선언이 어긋나면 즉시 실패한다.
        in_file = {a.name for a in bpy.data.actions}
        if in_file != set(spec["clips"]):
            raise RuntimeError("action set mismatch\n  file: %s\n  spec: %s"
                               % (sorted(in_file), sorted(spec["clips"])))
        # 순서는 선언을 따른다 — 정렬하면 sheets.json 이 기존과 어긋난다.
        # sheet_order 가 있으면 그쪽이 우선이다(ZP 는 익스포트 순서와 다르다).
        order = spec.get("sheet_order") or list(spec["clips"])
        if sorted(order) != sorted(spec["clips"]):
            raise RuntimeError("sheet_order != clips for %s" % spec["code"])
        for act in order:
            nframes, loop = spec["clips"][act]
            set_action(act)
            span = nframes - 1
            frames = [int(1 + round(span * i / float(NS if loop else NS - 1)))
                      for i in range(NS)]
            for i, f in enumerate(frames):
                sc.frame_set(f)
                bpy.context.view_layer.update()
                render(os.path.join(outdir, "sheet_%s_%02d.png" % (act, i)), 170, 220)
            meta.append({"action": act, "nframes": nframes, "loop": loop,
                         "samples": frames, "dur": round((nframes - 1) / 30.0, 2)})
        with open(os.path.join(outdir, "sheets.json"), "w") as fh:
            json.dump(meta, fh, indent=1)

    print("%s RENDER OK -> %s" % (spec["code"].upper(), outdir))
