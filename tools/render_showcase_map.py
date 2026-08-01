"""
쇼케이스 MAP-01 카드용 도해 9장을 뽑는다.

지난번엔 카메라 값을 애드혹으로 잡아서 재현이 안 됐다. 맵을 고칠 때마다 도해를
다시 뽑아야 하는데 매번 각도가 달라지면 전/후 비교가 안 된다. 여기에 못박는다.

    exec(open(r"C:\\Users\\User\\Documents\\HACKERTON\\tools\\render_showcase_map.py").read())

산출물: render/showcase/00-overview.jpg … 08-flow.jpg
이어서 `python tools/update_showcase_map.py render/showcase` 로 index.html에 박는다.

두 가지를 꼭 한다 (§16.7)
  · **천장을 걷는다.** 위에서 보는 도해에 천장을 남기면 지붕만 찍힌다.
    끈 것은 정확히 그 목록만 되돌린다 — 일괄 복구는 의도적으로 숨겨 둔 중복까지 켠다.
  · Workbench MATERIAL 모드는 `material.diffuse_color`를 읽는다(Principled 아님).
"""

import bpy
import math
import os

ROOT = os.path.dirname(os.path.dirname(bpy.data.filepath))
OUT = os.path.join(ROOT, "render", "showcase")

# 천장·지붕으로 판정할 이름/머티리얼. 도해에서 걷어낸다.
CEIL_NAMES = ("ceil", "roof", "canopy", "soffit", "spandrel", "louver", "_top")
CEIL_MATS = {"ST_CEIL", "CEIL_RIB", "PF_WALL_TOP"}

# (파일명, 위치, 목표점, ortho_scale 또는 None=원근, 해상도)
SHOTS = [
    # 맵이 271 m × 32 m 라 정사각 프레임으로 뽑으면 위아래가 텅 빈다
    ("00-overview", (70, -120, 150), (70, 12, -11), 292, (1500, 560)),
    ("01-z3", (64, -22, 26), (64, 16, -6), 44, (1200, 800)),
    ("02-z2", (26, -26, 30), (26, 15, -6), 62, (1200, 800)),
    ("03-z4", (86, -30, 26), (104, 7, -12), 62, (1200, 800)),
    ("04-z5", (110, -34, 26), (128, 6, -19), 78, (1200, 800)),
    ("05-z1", (-40, -32, 34), (-30, 26, 0), 78, (1200, 800)),
    ("06-exit", (-13, 14, 8.5), (2.0, 27.5, -1.5), None, (1200, 800)),
    ("07-psd", (128, -6, -16.4), (140, 12, -18.6), None, (1200, 800)),
    ("08-flow", (28, 15, 46), (28, 15, -6), 60, (1200, 900)),
]


def hide_ceilings():
    """천장류를 렌더에서 끄고, **끈 것만** 되돌릴 수 있게 목록을 돌려준다."""
    turned = []
    for o in bpy.data.objects:
        if o.type != "MESH" or o.hide_render:
            continue
        low = o.name.lower()
        mats = {m.name for m in o.data.materials if m}
        if any(k in low for k in CEIL_NAMES) or (mats & CEIL_MATS):
            o.hide_render = True
            turned.append(o.name)
    return turned


def restore(names):
    for n in names:
        o = bpy.data.objects.get(n)
        if o:
            o.hide_render = False


def main():
    os.makedirs(OUT, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 86
    sh = sc.display.shading
    sh.light, sh.color_type = "STUDIO", "MATERIAL"
    sh.show_shadows = sh.show_cavity = True
    sh.show_backface_culling = False

    cam = bpy.data.objects.get("SHOWCASE_MAP_CAM")
    if cam is None:
        cam = bpy.data.objects.new("SHOWCASE_MAP_CAM", bpy.data.cameras.new("SHOWCASE_MAP_CAM"))
        bpy.context.scene.collection.objects.link(cam)
    cam.hide_render = True
    sc.camera = cam

    turned = hide_ceilings()
    print(f"[showcase] 천장류 {len(turned)}개 렌더 제외")
    try:
        from mathutils import Vector
        for name, pos, tgt, ortho, (rx, ry) in SHOTS:
            cam.location = Vector(pos)
            d = Vector(tgt) - Vector(pos)
            cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
            if ortho is None:
                cam.data.type = "PERSP"
                cam.data.sensor_fit = "HORIZONTAL"
                cam.data.angle = math.radians(74)
            else:
                cam.data.type = "ORTHO"
                cam.data.ortho_scale = ortho
            cam.data.clip_start, cam.data.clip_end = 0.08, 800
            sc.render.resolution_x, sc.render.resolution_y = rx, ry
            sc.render.filepath = os.path.join(OUT, name)
            bpy.ops.render.render(write_still=True)
            print(f"  {name}.jpg  {os.path.getsize(sc.render.filepath + '.jpg') // 1024} KB")
    finally:
        restore(turned)
        print(f"[showcase] 천장류 {len(turned)}개 복구")


main()
