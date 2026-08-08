"""인벤 슬롯용 아이템 아이콘 — 물체 하나당 정사각 1장, 투명 배경.

실행:  blender -b assets/items.blend --python tools/items_icon_render.py -- <outdir>

`items_render.py`(4면 쇼케이스 카드)와 다른 이유
  카드는 index.html 갤러리용이라 4각도 + 불투명 배경이 필요하다. 슬롯 아이콘은
  54px 칸 하나에 얹히는 용도라 **한 각도 + 알파 채널**이면 된다. 파라미터를
  공유하려 하면 두 용도 다 어중간해진다.

대상
  `items.ts` 의 슬롯 아이템 중 `items.blend` 에 실제 메시가 있는 10종만.
  커피(I-07)·신문지(I-08)·캐리어(I-10)·지갑(I-11)·EMP(I-14) 는
  이 파일에 모델이 없다(맵 잡동사니뿐) — 아이콘 없이 이모지 글리프로 남는다.
  이어폰(I-05)은 `items_build.py ITM05_Earbuds` 로 메시가 생겨 여기 합류했다.
"""
import bpy
import math
import os
import sys

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else None
if not OUT:
    raise RuntimeError("output dir required after --")
os.makedirs(OUT, exist_ok=True)

# items.ts 의 `node` 필드와 정확히 같아야 한다 — HUD가 이 이름으로 PNG를 찾는다
ICONS = (
    "ITM01_Backscratcher", "ITM05_Earbuds", "ITM06_Mask", "ITM09_Umbrella", "ITM12_Yanggaeng",
    "ITM12_BananaMilk", "ITM12_Chocolate", "ITM12_Soda", "ITM12_SnackBag",
    "ITM13_RouteMap",
)

RES = 160
LENS = 68.0
FILL = 0.90                    # 카드(0.76)보다 크게 — 작은 칸 안에서 물체가 도드라져야 한다
YAW = 32.0                     # 정면과 q34 사이 — 아이콘 하나로 형태가 읽혀야 한다

sc = bpy.context.scene
_eng = sc.render.bl_rna.properties['engine'].enum_items.keys()
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in _eng else 'BLENDER_EEVEE'
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.render.film_transparent = True
sc.view_settings.view_transform = 'Standard'
sc.render.resolution_x = sc.render.resolution_y = RES
sc.render.resolution_percentage = 100

sc.world = bpy.data.worlds.new("W")
sc.world.use_nodes = True

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

MESHES = [o for o in bpy.data.objects if o.type == 'MESH']
GROUPS = {}
for _o in MESHES:
    GROUPS.setdefault(_o.name.split("__")[0], []).append(_o)
for o in MESHES:
    o.hide_render = True

missing = [name for name in ICONS if name not in GROUPS]
if missing:
    raise RuntimeError("items.blend 에 없는 그룹: %s" % missing)

VH = math.atan(12.0 / LENS)
HH = math.atan(12.0 * 1.0 / LENS)          # 정사각이라 가로·세로 반화각이 같다
a = math.radians(YAW)

done = []
for gname in ICONS:
    group = GROUPS[gname]
    for o in MESHES:
        o.hide_render = (o not in group)
    wv = [o.matrix_world @ v.co for o in group for v in o.data.vertices]
    lo, hi = min(p.z for p in wv), max(p.z for p in wv)
    cz = (lo + hi) / 2.0
    dx = max(p.x for p in wv) - min(p.x for p in wv)
    dy = max(p.y for p in wv) - min(p.y for p in wv)
    dz = hi - lo
    span_w = math.sqrt(dx * dx + dy * dy)
    dist = max(span_w / FILL * 0.5 / math.tan(HH), dz / FILL * 0.5 / math.tan(VH))
    cam.location = (dist * math.sin(a), -dist * math.cos(a), cz + dist * 0.16)
    cam.rotation_euler = (math.radians(81), 0.0, a)
    sc.render.filepath = os.path.join(OUT, "%s.png" % gname)
    bpy.ops.render.render(write_still=True)
    done.append(gname)

print("ITEMS_ICON_RENDER OK ->", OUT, done)
