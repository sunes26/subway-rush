"""SS 프리뷰 렌더. 기존 규격(340x460/뷰, 4면도 = 1360x460, 다크 배경, EEVEE/AgX)을 따른다.

blender -b ss_character.blend --python ss_render.py -- <outdir> <mode>
  mode = views | sheets | all
"""
import bpy, sys, os, math, json
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
OUTDIR = args[0]
MODE = args[1] if len(args) > 1 else "all"
FLAT = os.environ.get("SS_FLAT", "0") == "1"     # 무채색 실루엣 검증용
os.makedirs(OUTDIR, exist_ok=True)


def need(name):
    o = bpy.data.objects.get(name)
    if o is None:
        raise RuntimeError("missing object: %s" % name)
    return o


BATON = os.environ.get("SS_BATON", "0") == "1"   # 봉 버전 프리뷰
rig = need("SS_Rig")
mesh = need("SS_Character")
cam = need("Camera")
sc = bpy.context.scene
sc.camera = cam
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGB'
sc.render.film_transparent = False

# 기본은 테이저. SS_BATON=1 이면 봉을 보이고 총을 숨긴다.
_taser = bpy.data.objects.get("PR_Taser")
_baton = bpy.data.objects.get("PR_Baton")
if _taser is None or _baton is None:
    raise RuntimeError("props missing: PR_Taser / PR_Baton")
_stow = bpy.data.objects.get("PR_TaserStowed")
_bstow = bpy.data.objects.get("PR_BatonStowed")
if _stow is None or _bstow is None:
    raise RuntimeError("stowed props missing")


# 총을 손에 드는 클립은 Taser 계열과 추격·보고뿐이다.
# 나머지에서는 벨트 파우치에 꽂혀 있어야 한다.
# 손에 드는 클립. 뽑기·집어넣기는 중간에 바뀌지만 프리뷰는 '든' 쪽으로 본다.
TASER_HAND = {"SS_TaserDraw", "SS_TaserAim", "SS_TaserWarn", "SS_TaserFire",
              "SS_TaserHolster", "SS_Chase", "SS_RadioAlert"}
BATON_HAND = {"SS_BatonDraw", "SS_BatonReady", "SS_BatonSwing", "SS_BatonHolster"}
LOOPS = {"SS_Idle", "SS_Walk", "SS_TaserAim", "SS_Chase", "SS_BatonReady"}


def set_props(action_name):
    """클립 이름으로 어느 프롭을 보일지 정한다.

    Baton* 클립은 봉 버전 전용이라 SS_BATON 과 무관하게 봉을 든다.
    """
    baton_clip = action_name in BATON_HAND
    taser_clip = action_name in TASER_HAND
    _taser.hide_render = not taser_clip or BATON
    _baton.hide_render = not baton_clip and not (BATON and taser_clip)
    _stow.hide_render = taser_clip or BATON or baton_clip
    _bstow.hide_render = not (baton_clip is False and BATON) or taser_clip


set_props("SS_Idle")

if FLAT:
    for m in bpy.data.materials:
        if not m.node_tree:
            continue
        n = next((x for x in m.node_tree.nodes if x.type == 'BSDF_PRINCIPLED'), None)
        if n is None:
            continue
        n.inputs["Base Color"].default_value = (0.72, 0.72, 0.72, 1.0)
        if "Emission Strength" in n.inputs:
            n.inputs["Emission Strength"].default_value = 0.0

# 캐릭터를 세계 원점 기준으로 회전시키기 위한 부모 엠프티
piv = bpy.data.objects.new("SS_Pivot", None)
sc.collection.objects.link(piv)
piv.location = (0, 0, 0)
rig.parent = piv
rig.matrix_parent_inverse = piv.matrix_world.inverted()

# 원본 .blend 의 카메라는 AJ 2인 샷(380x512)용이라 1인 340x460 규격과 프레이밍이 다르다.
# 기존 프리뷰의 화면 점유율(캐릭터 높이 ≈ 프레임 85%)에 맞춰 재계산한다.
# 주의: sensor_fit='VERTICAL' 이면 Blender 는 sensor_width 가 아니라 sensor_height(24mm)를 쓴다.
# 틸트 85°, 거리 4.0m 유지 → 세로 커버리지 1.09m(기존 MC 프리뷰 점유율) → f = 24*4.024/1.09
CAM_TILT = 85.0
CAM_Y = -4.0077
CAM_Z = 0.843          # (0,0,0.4925) 가 화면 중앙에 오도록 역산
CAM_LENS = 89.0
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


VIEWS = [("front", 0), ("q34", 40), ("side", 90), ("back", 180), ("topq", 40)]

if MODE in ("views", "all"):
    set_action("SS_Idle")
    sc.frame_set(1)
    for name, yaw in VIEWS:
        piv.rotation_euler = (0, 0, math.radians(yaw))
        cam_topq() if name == "topq" else cam_normal()
        bpy.context.view_layer.update()
        render(os.path.join(OUTDIR, "view_%s.png" % name), 340, 460)
    piv.rotation_euler = (0, 0, 0)
    cam_normal()

# 액션 목록을 손으로 적으면 또 어긋난다 — 씬에 실제로 있는 것에서 채운다.
# LOOPS 는 위 set_props 옆에서 한 번만 정의한다.
SHEETS = [(a.name, int(round(a.frame_range[1] - a.frame_range[0])) + 1)
          for a in sorted(bpy.data.actions, key=lambda x: x.name)]
NS = 15          # AJ 규격: 액션당 15 샘플

if MODE in ("sheets", "all"):
    piv.rotation_euler = (0, 0, math.radians(28))
    meta = []
    for act, nframes in SHEETS:
        set_action(act)
        loop = act in LOOPS
        span = (nframes - 1) if loop else (nframes - 1)
        frames = []
        for i in range(NS):
            f = 1 + round(span * i / float(NS)) if loop else 1 + round(span * i / float(NS - 1))
            frames.append(int(f))
        for i, f in enumerate(frames):
            sc.frame_set(f)
            bpy.context.view_layer.update()
            render(os.path.join(OUTDIR, "sheet_%s_%02d.png" % (act, i)), 170, 220)
        meta.append({"action": act, "nframes": nframes, "loop": loop,
                     "samples": frames, "dur": round((nframes - 1) / 30.0, 2)})
    with open(os.path.join(OUTDIR, "sheets.json"), "w") as fh:
        json.dump(meta, fh, indent=1)

print("SS RENDER OK ->", OUTDIR)
