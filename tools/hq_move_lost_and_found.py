"""유실물센터(OBJ-13) 재배치 — 다목적 화장실 정문 앞 → 옆, 뒷면을 벽에 붙인다.

    "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe" -b ^
        assets\\station_map.blend -P tools\\hq_move_lost_and_found.py

디렉터 지시 두 번에 걸쳐 확정된 자리다.

1차: 다목적 화장실(x48.5~51) 정문 앞에 서 있어 문을 가렸다 — `WC-E` 벽(x51.0)
동쪽으로 +3.5m(원래 남향 유지, 옆으로만 이동).

2차: "뒤에 벽에 딱 붙여줘." 1차 위치는 옆으로는 왔지만 남향 그대로라 뒤(북쪽)엔
벽이 없었다(콘코스 허공) — 실측(콜리전 데이터 대조)으로 확인했다. **남향을
동향으로 90도 돌려** 뒷면이 `WC-E` 벽의 y 구간(25~30)에 겹치게 하고, x 를
벽면(51.0)에 정확히 맞춘다 — 그래야 진짜로 맞닿는다(같은 x 라도 y 가
안 겹치면 허공에 떠 있는 것과 같다).

회전은 피벗(원본 자리 중심, 53.5·23.3625) 기준 90도 반시계 —
(dx,dy) → (-dy,dx). 이 부호가 남향(-y)을 동향(+x)으로 보낸다(검산:
(0,-1)→(1,0)). `Z2_OBJ13_txt`(라벨)는 메시가 아니라 커브라 `.location`을
따로 돌린다 — 메시용 정점 이동 코드를 그대로 태웠다가 `hq_all.py` 저장
직전에 죽인 적 있다(`hq_train.py`의 `__file__` 사고와 같은 급).

인터랙터블(`OBJ-13-BAG`·`OBJ-13-RETURN`)은 지오메트리와 같은 강체 회전을
그대로 태우지 않는다 — 그러면 각각 남·북 구석으로 흩어져 새 정면(동쪽
유리창)에서 멀어진다. 대신 새 정면(x52.7 동쪽) 앞에 서게 다시 배치하고,
원래 간격(1.8m, 조준이 둘 사이에서 안 흔들리게)만 유지한다. `world.ts`·
`interactables.ts`도 같은 좌표로 별도 커밋 — 시각·판정이 어긋나면 안 보이는데
막히거나 보이는데 안 막힌다.

멱등: 이미 옮겨져 있으면(기준 정점 x가 51~53 사이 — 회전 후엔 폭이 좁아
1차 이동 때 쓰던 x>=52 판정이 안 맞는다) 다시 안 돌린다.
"""
from __future__ import annotations

import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))
                if "__file__" in dir() else r"C:\Users\User\Documents\HACKERTON\tools")

DELTA_X_1 = 3.5           # 1차: 옆으로
PIVOT = (53.5, 23.3625)   # 1차 이동 후 자리의 중심 (회전 기준)
DELTA_X_2 = 51.0 - 52.6625  # 2차: 회전 후 뒷면(서쪽 끝)을 x51.0(WC-E 벽면)에
DELTA_Y_2 = 27.5 - 23.3625  # 2차: WC-E 벽 y구간(25~30) 중심으로

# 회전·이동을 마친 뒤 최종 범위 — 멱등 판정 기준
DONE_X_RANGE = (50.9, 53.0)
DONE_Y_RANGE = (26.0, 29.0)

MESH_NAMES = (
    "Z2_OBJ13_body", "Z2_OBJ13_counter", "Z2_OBJ13_ctr", "Z2_OBJ13_frame",
    "Z2_OBJ13_glass", "Z2_OBJ13_inlight", "Z2_OBJ13_sign",
)
CURVE_NAMES = ("Z2_OBJ13_txt",)


def _rotate_and_snap(x: float, y: float) -> tuple[float, float]:
    dx, dy = x - PIVOT[0], y - PIVOT[1]
    nx, ny = PIVOT[0] + (-dy), PIVOT[1] + dx
    return nx + DELTA_X_2, ny + DELTA_Y_2


def main() -> None:
    ref = bpy.data.objects.get("Z2_OBJ13_body")
    if ref is None:
        print("  ! Z2_OBJ13_body 없음 — 건너뜀")
        return
    ref_x = min((ref.matrix_world @ v.co).x for v in ref.data.vertices)
    ref_y = min((ref.matrix_world @ v.co).y for v in ref.data.vertices)
    if DONE_X_RANGE[0] <= ref_x <= DONE_X_RANGE[1] and DONE_Y_RANGE[0] <= ref_y <= DONE_Y_RANGE[1]:
        print(f"  (이미 자리 잡음 — 기준 x={ref_x:.2f} y={ref_y:.2f})")
        return

    moved = 0
    for name in MESH_NAMES:
        o = bpy.data.objects.get(name)
        if o is None:
            print(f"  ! {name} 없음 — 건너뜀")
            continue
        for v in o.data.vertices:
            world_co = o.matrix_world @ v.co
            nx, ny = _rotate_and_snap(world_co.x + DELTA_X_1, world_co.y)
            local = o.matrix_world.inverted() @ type(v.co)((nx, ny, world_co.z))
            v.co.x, v.co.y = local.x, local.y
        o.data.update()
        moved += 1
    for name in CURVE_NAMES:
        o = bpy.data.objects.get(name)
        if o is None:
            print(f"  ! {name} 없음 — 건너뜀")
            continue
        nx, ny = _rotate_and_snap(o.location.x + DELTA_X_1, o.location.y)
        o.location.x, o.location.y = nx, ny
        o.rotation_euler.z += math.radians(90)
        moved += 1

    print(f"  유실물센터 {moved}개 오브젝트 옆으로 이동 + 90도 회전 + 벽(x51.0)에 밀착")


main()
