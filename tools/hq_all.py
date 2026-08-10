"""마감 패스 전체를 정해진 순서로 한 번에 돌린다.

    "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe" -b ^
        assets\\station_map.blend -P tools\\hq_all.py

**MCP 로 여러 패스를 한 호출에 몰아넣지 말 것.** 실제로 그렇게 했다가 Blender 가 죽었다
(이 프로젝트에서 세 번째다 — 규칙은 "한 호출 = 한 가지 일"). 헤드리스는 그 제약이 없고
애드온 연결에도 의존하지 않는다.

순서가 의미를 갖는다.

  1. 마감 패스 — 면적이 큰 순서(천장 → 벽 → 바닥 → 기둥/집기)
  2. 외부 소품 반입
  3. **머티리얼 통합** — 반드시 마지막. 게임 로더가 머티리얼별로 병합하므로
     존당 드로우 콜 ≈ 머티리얼 종류 수다. 먼저 돌리면 뒤 패스가 다시 늘린다.
  4. 감김 수정 — 새로 만든 것까지 포함해 부호 있는 부피로 검사
  5. 익스포트

──────────────────────────────────────────────────────────────────────────
라이트맵(`hq_lightmap.py`)은 **`ORDER` 에 넣지 않는다.** 두 가지 이유가 있다.

  1. 비싸다. 6존 2048²/1024샘플에 4분 40초다(OptiX). 마감 패스는 렌더를 보며
     몇 번씩 다시 돌리는 것이라 여기에 5분이 상시로 붙으면 안 된다.

  2. **같은 프로세스에서 돌리면 익스포트가 망가진다.** 베이크는 속도 때문에
     존 오브젝트를 하나로 join 한다 (오브젝트당 씬 재동기화가 335초 → 1.2초).
     그 뒤에 `export_station.py` 가 돌면 존이 이름 없는 덩어리 하나로 나간다.
     그래서 `run()` 이 `__name__="__hq__"` 로 exec 하는 것을 이용해
     `hq_lightmap.py` 는 `__main__` 일 때만 동작하도록 막아 두었다 —
     실수로 ORDER 에 넣어도 조용히 아무 일도 안 하고 경고만 찍는다.

올바른 순서는 **별도 프로세스 두 번**이다. 사이드카(`assets/lightmap_uv.npz`)가
두 프로세스를 잇는다.

    # 1) 형상 마감 + 저장 + 익스포트
    blender -b assets/station_map.blend -P tools/hq_all.py

    # 2) 지오메트리가 바뀐 존만 다시 굽는다 (사이드카는 나머지 존을 보존한다)
    blender -b assets/station_map.blend -P tools/hq_lightmap.py -- --zones Z2_CONCOURSE

    # 3) 라이트맵 UV 를 실어 다시 익스포트
    blender -b assets/station_map.blend -P tools/export_station.py

`export_station.py` 는 사이드카가 없으면 지금까지와 똑같이(UV 없이) 동작하므로,
라이트맵을 안 쓰는 빌드에서도 1) 만 돌리면 된다. 베이크 뒤에 형상을 바꾸면
지오메트리 지문이 어긋나 익스포트가 경고를 찍고 그 오브젝트만 중립 텍셀로 뺀다.
"""

from __future__ import annotations

import os
import sys

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
sys.path.insert(0, TOOLS)

ORDER = [
    "hq_ceiling.py",
    "hq_walls.py",
    "hq_platform.py",
    "hq_floor.py",
    "hq_gates.py",
    "hq_shops.py",
    "hq_signs.py",
    "hq_descent.py",
    "hq_cove.py",
    "hq_punch_openings.py",
    "hq_punch_z2e_gap.py",       # ← Z2-E 벽(x56) 개구부 확장 — 개구부 패스끼리 붙여 둔다
    # 버스 북측 문 개구부 — 개구부 패스끼리 붙여 둔다
    "hq_punch_bus_door.py",      # ← 천장 층을 다 얹은 뒤 계단 개구부를 뚫는다
    "hq_entrance.py",            # ← 지상 출입구 계단통 내부 마감
    "hq_street.py",              # ← 지상 가로 — 도로 양쪽 건물군 · 횡단보도 신호등
    "hq_fixups.py",              # ← 플레이 중 눈으로 잡힌 결함 (개구부 뒤에 와야 한다)
    "hq_opp_direction.py",       # ← 반대 방면(B_ 복제) 행선 문안 — 문안 패스 뒤에 온다
    "hq_move_lost_and_found.py", # ← 유실물센터, 다목적 화장실 정문 앞 → 옆
    "hq_train.py",               # ← 차문/안전문 두 짝 분리 + 객실 실내
    "hq_ad_placeholder.py",      # ← 광고판 원색을 플레이스홀더 카드로 (재질 패스 — merge 앞)
    "hq_fill_lights.py",
    "import_props.py",
    "hq_merge_materials.py",     # ← 반드시 소품 반입 뒤
    "fix_winding.py",
    "fix_transparency.py",       # ← 알파 1.0 인데 반투명으로 잡힌 것 되돌리기
    # hq_lightmap.py 는 여기에 넣지 말 것 — 위 주석 참조 (비싸고, join 이 익스포트를 깬다)
]

# ──────────────────────────────────────────────────────────────────────────
# ORDER 에 **없는** 스크립트 — 손으로 한 번만 돌리는 것들.
#
#   build_details.py · build_ceiling.py · build_shops.py · build_station_signs.py
#   build_wc.py · import_toilet.py · import_extinguisher.py · bevel_pass.py
#
# 전부 `exec(open(...).read())` 로 대화형에서 돌리게 만든 초기 빌더다. 머티리얼별
# 누산기(`Acc`)가 오브젝트를 **새로 만들기 때문에** 두 번 돌리면 `.001` 중복이 생긴다.
# `hq_lib.Batch` 처럼 메시 데이터를 제자리 교체하지 않는다.
#
# **결과: 이 파일들을 고쳐도 blend 에 반영되지 않는다.** 이미 두 번 물렸다 —
#   · `ST_CEIL` 투명도 수동 수정이 사라져 `fix_transparency.py` 를 만들었고
#   · `build_details._col_centers` 의 유령 기둥 띠(x 24·26 이 한 군집으로 뭉쳐
#     4×3=12개가 생겼다. 실제 기둥은 9개)를 `hq_fixups.column_bands()` 에서
#     다시 잡아야 했다.
#
# 규칙: 일회성 빌더의 결함은 **원본도 고치되**, 실제 수정은 ORDER 안의 멱등 패스에
# 넣는다. 원본만 고치면 다음 리빌드 때 조용히 없던 일이 된다.
# ──────────────────────────────────────────────────────────────────────────


def run(name: str) -> None:
    path = os.path.join(TOOLS, name)
    print(f"\n─── {name} ───")
    with open(path, encoding="utf-8") as fh:
        exec(compile(fh.read(), path, "exec"), {"__name__": "__hq__"})


def main() -> None:
    for name in ORDER:
        run(name)
    bpy.ops.wm.save_mainfile()
    print(f"\n저장: {bpy.data.filepath}")
    run("export_station.py")


main()
