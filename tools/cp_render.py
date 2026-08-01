"""CP 프리뷰 렌더. 기존 규격(340x460/뷰, 4면도 = 1360x460, 다크 배경, EEVEE/AgX)을 따른다.

blender -b cp_character.blend --python zp_render.py -- <outdir> <mode>
  mode = views | sheets | all
"""
import bpy, sys, os, math, json
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
OUTDIR = args[0]
MODE = args[1] if len(args) > 1 else "all"
FLAT = os.environ.get("CP_FLAT", "0") == "1"     # 무채색 실루엣 검증용
os.makedirs(OUTDIR, exist_ok=True)


def need(name):
    o = bpy.data.objects.get(name)
    if o is None:
        raise RuntimeError("missing object: %s" % name)
    return o


rig = need("CP_Rig")
mesh = need("CP_Character")
cam = need("Camera")
sc = bpy.context.scene
sc.camera = cam
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGB'
sc.render.film_transparent = False

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
piv = bpy.data.objects.new("CP_Pivot", None)
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
    return a


VIEWS = [("front", 0), ("q34", 40), ("side", 90), ("back", 180), ("topq", 40)]

if MODE in ("views", "all"):
    set_action("CP_Idle")
    sc.frame_set(1)
    for name, yaw in VIEWS:
        piv.rotation_euler = (0, 0, math.radians(yaw))
        cam_topq() if name == "topq" else cam_normal()
        bpy.context.view_layer.update()
        render(os.path.join(OUTDIR, "view_%s.png" % name), 340, 460)
    piv.rotation_euler = (0, 0, 0)
    cam_normal()

SHEETS = [("CP_Idle", 61), ("CP_MoveAside", 46), ("CP_AsideIdle", 61),
          ("CP_CarrierTornado", 76)]
NS = 15          # AJ 규격: 액션당 15 샘플

if MODE in ("sheets", "all"):
    piv.rotation_euler = (0, 0, math.radians(28))
    meta = []
    for act, nframes in SHEETS:
        set_action(act)
        loop = act in ("CP_Idle", "CP_AsideIdle")
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

print("CP RENDER OK ->", OUTDIR)
