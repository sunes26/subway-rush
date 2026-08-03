"""품질 검토용 순회 렌더.

게임과 같은 눈높이(1.62 m)·화각(74°)으로 정해진 지점을 돌며 EEVEE 로 굽는다.
한 장씩 뷰포트로 보면 판단이 흔들린다 — 같은 노출·같은 화각으로 한 번에 뽑아
실사·레퍼런스와 나란히 놓고 봐야 어디가 모자란지 보인다.

양면 지점을 반드시 함께 넣는다. 한 면만 찍으면 반대 면이 뒤집혀도 통과한다.

    exec(open(r"...\\tools\\hq_tour.py").read())
"""

from __future__ import annotations

import math
import os

import bpy
from mathutils import Vector

OUT = r"C:\Users\User\Documents\HACKERTON\render\hq"
EYE = 1.62
FOV = 74.0
RES = (1024, 576)
SAMPLES = 48

# (파일명, x, y, 바닥 z, yaw, pitch)
SHOTS = [
    ("01-concourse-east", 12.0, 15.0, -6.0, 0.05, -0.05),
    ("02-shop-arcade", 17.0, 9.5, -6.0, -0.62, -0.10),
    ("03-shop-front", 24.0, 7.6, -6.0, -1.35, -0.05),
    ("04-concourse-west", 46.0, 15.0, -6.0, math.pi, 0.0),
    ("05-gates-approach", 54.0, 16.0, -6.0, 0.0, 0.02),
    ("06-gate-close", 59.4, 12.6, -6.0, 0.0, -0.12),
    ("07-corridor", 76.0, 6.0, -6.0, 0.0, 0.02),
    ("08-corridor-back", 92.0, 6.0, -6.0, math.pi, 0.02),
    ("09-descent", 97.0, 6.4, -8.0, 0.0, -0.42),
    ("10-platform", 122.0, 6.0, -20.0, 0.0, 0.0),
    ("11-platform-psd", 128.0, 8.6, -20.0, 1.32, -0.06),
    ("12-platform-wall", 128.0, 4.0, -20.0, -1.30, -0.02),
    ("13-platform-far", 168.0, 5.0, -20.0, math.pi, 0.02),
    ("14-column-n", 124.0, 5.6, -20.0, -math.pi / 2, 0.20),
    ("15-column-s", 124.0, 2.4, -20.0, math.pi / 2, 0.20),
    ("16-platform-up", 140.0, 6.0, -20.0, 0.0, 0.42),
]


def _cam():
    cam = bpy.data.objects.get("PREVIEW_CAM")
    if cam is None:
        data = bpy.data.cameras.new("PREVIEW_CAM")
        cam = bpy.data.objects.new("PREVIEW_CAM", data)
        bpy.context.scene.collection.objects.link(cam)
    cam.data.type = "PERSP"
    cam.data.sensor_fit = "HORIZONTAL"
    cam.data.angle = math.radians(FOV)
    cam.data.clip_start = 0.08
    cam.data.clip_end = 400
    cam.hide_render = True
    return cam


def _lights(on):
    """씬 조명을 렌더 동안만 켠다.

    `LIGHTS` 컬렉션 42개는 전부 `hide_render = True` 다 — 그게 익스포트 제외 규약이라
    그렇다. 그대로 두고 렌더하면 월드(0.22)와 발광면만 남아 전부 캄캄하게 나오고,
    **모델이 어두운 것으로 오진하게 된다.** 실제로 한 번 그렇게 헛돌았다.
    반드시 렌더 뒤에 되돌린다 — 안 되돌리면 익스포트에 조명이 섞여 나간다.
    """
    n = 0
    for o in bpy.data.objects:
        if o.type == "LIGHT":
            o.hide_render = not on
            n += 1
    return n


def run(only=None):
    os.makedirs(OUT, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x, sc.render.resolution_y = RES
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    try:
        sc.eevee.taa_render_samples = SAMPLES
    except Exception:
        pass
    cam = _cam()
    sc.camera = cam
    lit = _lights(True)

    done = []
    for name, x, y, z, yaw, pitch in SHOTS:
        if only and name not in only:
            continue
        cam.location = Vector((x, y, z + EYE))
        target = Vector((x + math.cos(yaw) * 10.0,
                         y + math.sin(yaw) * 10.0,
                         z + EYE + math.tan(pitch) * 10.0))
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(OUT, name + ".png")
        bpy.ops.render.render(write_still=True)
        done.append(name)
    _lights(False)
    print(f"[hq_tour] {len(done)}장 → {OUT} (조명 {lit}개 켰다 되돌림)")
    return done


run()
