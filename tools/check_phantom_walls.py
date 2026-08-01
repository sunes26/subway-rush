"""
유령 벽 검사 — 보이는데 막지 않거나, 막는데 안 보이는 곳을 찾는다.

이 프로젝트에서 가장 자주 난 버그가 **보이는 것(Blender)과 막는 것(world.ts)의 어긋남**이다.
지금까지는 사용자가 스크린샷으로 제보한 뒤에야 찾았다. 여기서 자동으로 훑는다.

    exec(open(r"C:\\Users\\User\\Documents\\HACKERTON\\tools\\check_phantom_walls.py").read())

찾는 것 두 가지
  · PHANTOM  통과 가능한데 벽이 보인다 (충돌 개구부에 시각 벽이 남아 있음)
  · INVISIBLE 막히는데 아무것도 안 보인다 (시각을 지웠는데 충돌이 남음)

충돌 데이터는 `cd game && npm run dump:collision` 로 뽑은 game/tools/collision.json 을 읽는다.
사본을 손으로 관리하면 그 사본이 또 어긋난다.
"""

import bpy
import json
import os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(bpy.data.filepath))
COLLISION = os.path.join(ROOT, "game", "tools", "collision.json")

EYE = 1.62
STEP = 0.5          # 격자 간격
PROBE = 0.55        # 이 거리 안에 시각 면이 있으면 "벽이 보인다"로 본다
PLAYER_R = 0.32

# 층별 검사 범위 (x0, y0, x1, y1, 바닥z, 라벨)
AREAS = [
    (-64, 22, 12, 32, 0.0, "Z1 보도"),
    (0, 0, 56, 30, -6.0, "Z2 대합실"),
    (56, 0, 72, 32, -6.0, "Z3 개찰구"),
    (72, 2, 95.8, 12, -6.0, "Z4 통로"),
    (78, 0, 206, 12, -20.0, "Z5 승강장"),
]

# 충돌은 없는 게 정상인 시각물 (난간·유리·장식 — 통과 판정을 일부러 안 준 것)
IGNORE_VISUAL = ("rail", "bal_", "glass", "tact", "joint", "wear", "louver",
                 "light", "duct", "sign", "band", "arrow", "psd_", "hang",
                 "pids", "ad", "skirt", "trim", "nose", "cap", "fascia")


def load_solids():
    data = json.load(open(COLLISION, encoding="utf-8"))
    return data["solids"], data["slabs"]


def blocked(solids, x, y, z, r=PLAYER_R):
    """플레이어 원기둥이 솔리드에 닿는가."""
    for s in solids:
        x0, y0, x1, y1 = s["rect"]
        if s["z0"] > z + EYE or s["z0"] + s["h"] < z + 0.2:
            continue
        if x0 - r < x < x1 + r and y0 - r < y < y1 + r:
            return s["id"]
    return None


def visual_near(solids, x, y, z):
    """눈높이 사방 PROBE 안에 **충돌이 없는** 시각 면이 있으면 그 이름.

    판정은 샘플 지점이 아니라 **맞은 면의 좌표**로 한다. 벽이 0.5m 앞에 있고
    그 벽에 충돌이 제대로 붙어 있으면 정상이다 — 샘플 지점만 보면 전부 유령으로 잡힌다.
    """
    sc = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    o = Vector((x, y, z + EYE))
    for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0)):
        ok, loc, _, _, obj, _ = sc.ray_cast(dg, o, Vector(d), distance=PROBE)
        if not ok:
            continue
        low = obj.name.lower()
        if any(k in low for k in IGNORE_VISUAL):
            continue
        # 맞은 면이 솔리드 안(또는 표면)이면 제대로 막힌 벽이다
        if blocked(solids, loc.x, loc.y, z, r=0.06):
            continue
        return obj.name, round((loc - o).length, 2)
    return None


def main():
    solids, _ = load_solids()
    print(f"충돌 솔리드 {len(solids)}개 · 격자 {STEP}m · 탐침 {PROBE}m\n")
    phantom = {}
    for (x0, y0, x1, y1, z, label) in AREAS:
        hits = 0
        nx = int((x1 - x0) / STEP) + 1
        ny = int((y1 - y0) / STEP) + 1
        for i in range(nx):
            for j in range(ny):
                x, y = x0 + i * STEP, y0 + j * STEP
                if blocked(solids, x, y, z):
                    continue                      # 충돌이 막는다 → 벽이 보여도 정상
                v = visual_near(solids, x, y, z)
                if v is None:
                    continue
                name, dist = v
                key = (label, name)
                phantom.setdefault(key, []).append((round(x, 1), round(y, 1)))
                hits += 1
        print(f"  {label:12s} 격자 {nx*ny:5d} · 유령 후보 {hits}")

    print("\n=== PHANTOM — 통과 가능한데 벽이 보인다 ===")
    if not phantom:
        print("  없음")
    for (label, name), pts in sorted(phantom.items(), key=lambda kv: -len(kv[1])):
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        print(f"  {label:12s} {name:26s} {len(pts):4d}점 "
              f"x[{min(xs):.1f},{max(xs):.1f}] y[{min(ys):.1f},{max(ys):.1f}]")


main()
