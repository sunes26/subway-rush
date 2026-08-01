"""
Blender 안에서 게임을 확인하는 도구.

웹으로 왕복하지 않고 **Blender 뷰포트에서 바로** 세 가지를 본다.
  1. 게임과 같은 눈높이·화각의 1인칭 시점
  2. 충돌 형상(`world.ts`)을 실제 지오메트리 위에 겹쳐 보기
  3. 점자 유도선 경로

이 프로젝트에서 반복해서 물린 버그가 전부 **보이는 것과 막는 것의 어긋남**이었다 —
계단이 0.30m 뜬 것, 유령 기둥, 문틀보다 1.35m 앞에서 막던 화장실,
유도선이 정류장 기둥과 차단벽을 관통하던 것.
그 어긋남은 Blender에서 겹쳐 보면 1초에 보인다.

──────────────────────────────────────────────────────────────────────
사용법 — Blender의 Scripting 탭에서

    exec(open(r"C:\\Users\\User\\Documents\\HACKERTON\\tools\\blender_preview.py").read())

    look("stair-top")     # 이름난 지점에서 1인칭으로 본다 (목록은 spots())
    look(7.5, 28)         # 좌표로 직접
    collision(True)       # 충돌 박스 겹쳐 켜기 (빨강=벽 · 파랑=바닥 · 초록=경사)
    collision(False)
    spots()               # 지점 목록
    debug(False)          # 판정 영역(주황 박스·원뿔) 숨기기 — 기본 숨김
    game_view(True)       # 게임과 같은 백페이스 컬링 (뒷면 안 보이게)

충돌 데이터는 미리 뽑아 둬야 한다:

    cd game && npx tsx tools/dump-collision.ts
──────────────────────────────────────────────────────────────────────
"""

import json
import math
import os

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) \
    if "__file__" in dir() else r"C:\Users\User\Documents\HACKERTON"
COLLISION_JSON = os.path.join(ROOT, "game", "tools", "collision.json")

# 게임과 같은 값 (game/src/data/tuning.ts FPV)
EYE_HEIGHT = 1.62
FOV_DEG = 74.0

CAM_NAME = "PREVIEW_CAM"
COLL_NAME = "_COLLISION_OVERLAY"

# 순회 촬영(tests/e2e/tour.spec.ts)과 같은 지점 — 웹에서 본 그림과 곧바로 대조된다
SPOTS = {
    "spawn":        (-58, 24, 0.0, 0.0),
    "street":       (-36, 26.5, 0.0, 0.0),
    "entrance":     (-8, 26.5, 0.0, 0.0),
    "stair-top":    (1.0, 28, 0.0, -0.42),
    "stair-mid":    (7.5, 28, -2.90, -0.30),
    "stair-bottom": (16, 28, -6.0, math.pi, 0.28),
    "concourse":    (20, 15, -6.0, 0.0),
    "columns":      (30, 15, -6.0, 0.5),
    "wc":           (44, 24.5, -6.0, math.pi / 2),
    # 화장실은 안이 본체다 — 바깥 지점만 있으면 사인판만 보고 "안 바뀌었다"가 된다.
    "wc-men":       (38.6, 27.4, -6.0, math.pi / 2),
    "wc-women":     (45.0, 27.4, -6.0, math.pi / 2),
    "gates":        (56.5, 16, -6.0, 0.0),
    "gate-close":   (59.2, 14, -6.0, 0.0),
    "corridor":     (80, 7, -6.0, 0.0),
    "descent":      (94.5, 6.7, -6.0, 0.0, -0.35),
    "platform":     (128, 6, -20.0, 0.0),
    "psd":          (130, 9, -20.0, math.pi / 2),
    "platform-far": (150, 4, -20.0, 0.35),
    # 기둥 역명판(x 92·108·124·156·172·188, 양면). 북쪽이 주 통행 구역이다.
    "stsign":       (124, 5.35, -20.0, -math.pi / 2, 0.22),
    "stsign-s":     (124, 2.65, -20.0, math.pi / 2, 0.22),
}


def _cam():
    cam = bpy.data.objects.get(CAM_NAME)
    if cam is None:
        data = bpy.data.cameras.new(CAM_NAME)
        cam = bpy.data.objects.new(CAM_NAME, data)
        bpy.context.scene.collection.objects.link(cam)
    # 화각을 게임과 맞춘다. 안 맞추면 "웹에선 보이는데 여기선 안 보인다"가 생긴다.
    cam.data.sensor_fit = "HORIZONTAL"
    cam.data.angle = math.radians(FOV_DEG)
    cam.data.clip_start = 0.08
    cam.data.clip_end = 400
    cam.hide_render = True
    return cam


def look(where="entrance", y=None, z=None, yaw=0.0, pitch=0.0):
    """이름난 지점 또는 (x, y[, z])에서 게임과 같은 시점으로 본다."""
    if isinstance(where, str):
        spot = SPOTS.get(where)
        if spot is None:
            raise ValueError(f"모르는 지점: {where}. spots() 참고")
        x, sy, sz, syaw = spot[0], spot[1], spot[2], spot[3]
        spitch = spot[4] if len(spot) > 4 else 0.0
    else:
        x, sy, sz, syaw, spitch = where, y, (0.0 if z is None else z), yaw, pitch

    cam = _cam()
    # 월드 규약: +x 동 · +y 북 · +z 상. Blender와 같으므로 변환이 필요 없다.
    cam.location = Vector((x, sy, sz + EYE_HEIGHT))
    target = Vector((
        x + math.cos(syaw) * 10.0,
        sy + math.sin(syaw) * 10.0,
        sz + EYE_HEIGHT + math.tan(spitch) * 10.0,
    ))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()

    bpy.context.scene.camera = cam
    for area in bpy.context.screen.areas:
        if area.type == "VIEW_3D":
            area.spaces[0].region_3d.view_perspective = "CAMERA"
    print(f"[preview] {where} @ ({x}, {sy}, {sz}) eye {sz + EYE_HEIGHT:.2f}")


def spots():
    print("사용 가능한 지점:")
    for k, v in SPOTS.items():
        print(f"  {k:14s} ({v[0]}, {v[1]}, {v[2]})")


def debug(on=False):
    """판정 영역(스폰·순찰·배회·시야콘)을 보이거나 숨긴다.

    전부 `hide_render = True` 라 glTF로 안 나가고 게임에도 없다.
    Blender 뷰포트에만 뜨는 주황 박스·원뿔이 실제 결함처럼 보여서 기본은 숨김이다.
    """
    coll = bpy.data.collections.get("DEBUG")
    if coll is None:
        print("[preview] DEBUG 컬렉션이 없다")
        return
    coll.hide_viewport = not on
    # 뷰 레이어 쪽에서도 제외해야 아웃라이너 클릭으로 되살아나지 않는다
    def find(layer):
        if layer.collection is coll:
            return layer
        for ch in layer.children:
            got = find(ch)
            if got:
                return got
        return None
    lc = find(bpy.context.view_layer.layer_collection)
    if lc:
        lc.exclude = not on
    print(f"[preview] 판정 영역 {'표시' if on else '숨김'} ({len(coll.objects)}개)")


def game_view(on=True):
    """게임과 같은 백페이스 컬링을 뷰포트에 건다.

    게임 셰이더(`render/toon.ts`)는 three 기본값 FrontSide라 뒷면을 안 그린다.
    Blender는 기본이 양면이라, **게임에 없는 벽이 여기서는 보인다.**
    글씨가 좌우로 뒤집혀 보이면 뒷면을 보고 있다는 신호다 — 이걸 켜고 다시 볼 것.
    """
    n = 0
    for area in bpy.context.screen.areas:
        if area.type == "VIEW_3D":
            area.spaces[0].shading.show_backface_culling = on
            n += 1
    print(f"[preview] 백페이스 컬링 {'ON — 게임과 같음' if on else 'OFF'} (뷰포트 {n})")


def _mat(name, rgba):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    m.use_nodes = False
    m.diffuse_color = rgba
    m.blend_method = "BLEND"
    return m


def collision(on=True):
    """충돌 형상을 실제 지오메트리 위에 겹친다. 빨강=벽 · 파랑=바닥 · 초록=경사 · 노랑=유도선."""
    existing = bpy.data.collections.get(COLL_NAME)
    if not on:
        if existing:
            existing.hide_viewport = True
        print("[preview] 충돌 오버레이 OFF")
        return

    if existing is not None:
        existing.hide_viewport = False
        print("[preview] 충돌 오버레이 ON (기존)")
        return

    if not os.path.exists(COLLISION_JSON):
        raise SystemExit(
            f"{COLLISION_JSON} 가 없다.\n"
            "  cd game && npx tsx tools/dump-collision.ts 를 먼저 돌릴 것."
        )
    data = json.load(open(COLLISION_JSON, encoding="utf-8"))

    coll = bpy.data.collections.new(COLL_NAME)
    bpy.context.scene.collection.children.link(coll)

    m_wall = _mat("_COL_WALL", (0.90, 0.15, 0.15, 0.25))
    m_slab = _mat("_COL_SLAB", (0.15, 0.45, 0.95, 0.20))
    m_ramp = _mat("_COL_RAMP", (0.20, 0.85, 0.35, 0.30))
    m_path = _mat("_COL_PATH", (1.00, 0.85, 0.10, 0.60))

    verts, faces, mats = [], [], []

    def box(x0, y0, z0, x1, y1, z1, mi):
        n = len(verts)
        verts.extend([(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                      (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)])
        faces.extend([(n, n + 1, n + 2, n + 3), (n + 7, n + 6, n + 5, n + 4),
                      (n, n + 4, n + 5, n + 1), (n + 1, n + 5, n + 6, n + 2),
                      (n + 2, n + 6, n + 7, n + 3), (n + 3, n + 7, n + 4, n)])
        mats.extend([mi] * 6)

    for s in data["solids"]:
        x0, y0, x1, y1 = s["rect"]
        box(x0, y0, s["z0"], x1, y1, s["z0"] + s["h"], 0)
    for s in data["slabs"]:
        x0, y0, x1, y1 = s["rect"]
        box(x0, y0, s["z"] - 0.04, x1, y1, s["z"], 1)
    for r in data["ramps"]:
        # 경사면은 상자로 못 그린다 — 프리즘으로 실제 기울기를 보여야 계단 뜸이 보인다
        x0, y0, x1, y1 = r["rect"]
        n = len(verts)
        if r["axis"] == "x":
            za, zb = r["zAtMin"], r["zAtMax"]
            verts.extend([(x0, y0, za), (x1, y0, zb), (x1, y1, zb), (x0, y1, za),
                          (x0, y0, za - 0.06), (x1, y0, zb - 0.06),
                          (x1, y1, zb - 0.06), (x0, y1, za - 0.06)])
        else:
            za, zb = r["zAtMin"], r["zAtMax"]
            verts.extend([(x0, y0, za), (x1, y0, za), (x1, y1, zb), (x0, y1, zb),
                          (x0, y0, za - 0.06), (x1, y0, za - 0.06),
                          (x1, y1, zb - 0.06), (x0, y1, zb - 0.06)])
        faces.extend([(n, n + 1, n + 2, n + 3), (n + 7, n + 6, n + 5, n + 4),
                      (n, n + 4, n + 5, n + 1), (n + 1, n + 5, n + 6, n + 2),
                      (n + 2, n + 6, n + 7, n + 3), (n + 3, n + 7, n + 4, n)])
        mats.extend([2] * 6)

    for p in data["guidePaths"]:
        pts = p["points"]
        for i in range(len(pts) - 1):
            (ax, ay), (bx, by) = pts[i], pts[i + 1]
            box(min(ax, bx) - 0.06, min(ay, by) - 0.06, p["z"] + 0.05,
                max(ax, bx) + 0.06, max(ay, by) + 0.06, p["z"] + 0.09, 3)

    me = bpy.data.meshes.new(COLL_NAME)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    for mat in (m_wall, m_slab, m_ramp, m_path):
        me.materials.append(mat)
    for i, poly in enumerate(me.polygons):
        poly.material_index = mats[i]
        poly.use_smooth = False

    ob = bpy.data.objects.new(COLL_NAME, me)
    ob.display_type = "WIRE"          # 실물을 가리지 않게 와이어로. 필요하면 SOLID로 바꿔서 본다
    ob.hide_render = True
    ob.show_in_front = True
    coll.objects.link(ob)
    print(
        f"[preview] 충돌 오버레이 ON — 벽 {len(data['solids'])} · 바닥 {len(data['slabs'])}"
        f" · 경사 {len(data['ramps'])} · 유도선 {len(data['guidePaths'])}"
    )
    print("          와이어로 보인다. 면으로 보려면 오브젝트 Display As를 Solid로.")


print(__doc__.split("──")[0].strip())

# 기본 상태를 게임과 맞춰 둔다 — 이 두 줄이 없으면 게임에 없는 것들이 결함처럼 보인다
debug(False)
game_view(True)
print("look('entrance') · collision(True) · debug(True) · game_view(False) · spots()")
