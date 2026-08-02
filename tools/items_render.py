"""ITM 소품 4면 렌더 — index.html 카드용.

실행:  blender -b assets/items.blend --python tools/items_render.py -- <outdir>

캐릭터용 lib/rendering.py 를 쓰지 않는 이유
  그쪽은 리그·클립·프롭 가시성 전환을 전제로 한다. 소품은 정지 메시라
  그 기계가 통째로 헛돈다. 여기서 필요한 건 '같은 프레이밍으로 4면' 뿐이다.

프레이밍
  물건마다 크기가 열 배 넘게 차이 난다(카드 0.084 · 펼친 우산 0.47).
  고정 거리를 쓰면 어떤 건 잘리고 어떤 건 점이 된다. 바운딩 박스에서
  화각을 역산해 **화면 점유율을 맞춘다.**
"""
import bpy
import json
import math
import os
import sys

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else None
if not OUT:
    raise RuntimeError("output dir required after --")
os.makedirs(OUT, exist_ok=True)

RX, RY = 460, 460
LENS = 68.0
FILL = 0.76                    # 화면 세로 대비 물체 점유율
VIEWS = (("front", 0.0), ("q34", 38.0), ("side", 90.0), ("back", 180.0))

sc = bpy.context.scene
_eng = sc.render.bl_rna.properties['engine'].enum_items.keys()
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in _eng else 'BLENDER_EEVEE'
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGB'
sc.render.film_transparent = False
sc.view_settings.view_transform = 'Standard'

sc.world = bpy.data.worlds.new("W")
sc.world.use_nodes = True
next(n for n in sc.world.node_tree.nodes
     if n.bl_idname == 'ShaderNodeBackground').inputs[0].default_value = (0.055, 0.055, 0.062, 1)

for rot, energy in (((52, 0, 38), 3.0), ((64, 0, -125), 1.25), ((112, 0, 176), 0.85)):
    L = bpy.data.objects.new("L%.2f" % energy, bpy.data.lights.new("L%.2f" % energy, 'SUN'))
    sc.collection.objects.link(L)
    L.data.energy = energy
    L.rotation_euler = tuple(math.radians(v) for v in rot)

cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.sensor_fit = 'VERTICAL'
cam.data.sensor_height = 24.0
cam.data.lens = LENS

ITEMS = sorted((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: o.name)
if not ITEMS:
    raise RuntimeError("no meshes in %s" % bpy.data.filepath)
for o in ITEMS:
    o.hide_render = True

VH = math.atan(12.0 / LENS)                      # 세로 반화각
HH = math.atan(12.0 * RX / RY / LENS)            # 가로 반화각
meta = {}

for obj in ITEMS:
    for o in ITEMS:
        o.hide_render = (o is not obj)
    dx, dy, dz = obj.dimensions
    lo = min((obj.matrix_world @ v.co).z for v in obj.data.vertices)
    hi = max((obj.matrix_world @ v.co).z for v in obj.data.vertices)
    cz = (lo + hi) / 2.0
    span_w = math.sqrt(dx * dx + dy * dy)
    dist = max(span_w / FILL * 0.5 / math.tan(HH), dz / FILL * 0.5 / math.tan(VH))
    for tag, yaw in VIEWS:
        a = math.radians(yaw)
        cam.location = (dist * math.sin(a), -dist * math.cos(a), cz + dist * 0.16)
        cam.rotation_euler = (math.radians(81), 0.0, a)
        sc.render.resolution_x, sc.render.resolution_y = RX, RY
        sc.render.resolution_percentage = 100
        sc.render.filepath = os.path.join(OUT, "%s_%s.png" % (obj.name, tag))
        bpy.ops.render.render(write_still=True)
    meta[obj.name] = {
        "tris": sum(len(p.vertices) - 2 for p in obj.data.polygons),
        "verts": len(obj.data.vertices),
        "dim_m": [round(v, 4) for v in obj.dimensions],
        "materials": [m.name for m in obj.data.materials if m],
    }

with open(os.path.join(OUT, "items.json"), "w") as fh:
    json.dump(meta, fh, indent=1, ensure_ascii=False)
print("ITEMS_RENDER OK ->", OUT, sorted(meta))
