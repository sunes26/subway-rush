"""존별 라이트맵 아틀라스를 굽는다 (헤드리스 전용).

    "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe" -b ^
        assets\\station_map.blend -P tools\\hq_lightmap.py -- --zones Z3_GATES

게임에는 Blender 조명이 하나도 안 나간다 (조명 76개가 전부 `hide_render=True`).
밝기는 툰 셰이더의 법선 단계값 + 자체발광뿐이라 **바닥·벽에 그림자가 전혀 없다.**
그 정보를 텍스처로 구워서 넘기는 것이 이 스크립트다.

산출물 두 가지
  1. `game/public/models/map/lightmap/LM_<ZONE>.png` — 존당 한 장. 게임이 로드한다.
  2. `assets/lightmap_uv.npz` — 구울 때 쓴 UV. `export_station.py` 가 이걸 읽어
     GLB 에 같은 UV 를 실어 보낸다.

**왜 UV 를 blend 에 저장하지 않고 사이드카로 빼는가.**
`station_map.blend` 를 덮어쓰지 않는 것이 이 작업의 제약이다. 그런데 라이트맵은
UV 와 픽셀이 한 쌍으로만 의미가 있다 — 둘이 어긋나면 엉뚱한 곳의 그림자가 찍힌다.
blend 를 따로 하나 더 떠서 보관하면 지오메트리 원본이 둘로 갈라져 반드시 드리프트한다.
그래서 지오메트리 진실은 `station_map.blend` 하나로 두고, UV 는 픽셀과 같은 시점에
같이 떨어지는 **파생 데이터**로 취급한다. 사이드카에 오브젝트별 지오메트리 지문을
같이 적어 두므로, 나중에 형상이 바뀌면 익스포트가 그 사실을 알아채고 경고한다.

──────────────────────────────────────────────────────────────────────────
실측으로 확정한 것들 (추측 아님)

* `smart_project` 는 헤드리스에서 정상 동작한다. 오브젝트당 약 30 ms →
  전체 2,229개에 66초. 존 전체를 다중 편집 모드에 넣고 `pack_islands` 를 한 번에
  돌리는 방식은 쓰지 않았다 — Z5 679개에서 죽을 위험이 있고, 무엇보다
  **결과가 재현되지 않으면 사이드카 UV 와 구운 픽셀이 어긋난다.**
  대신 오브젝트별로 언랩해 0..1 에 담고, 그 정사각형들을 파이썬 셸프 패커로
  아틀라스에 배치한다. 순서를 이름으로 고정해 몇 번을 돌려도 같은 자리에 놓인다.

* **공유 메시 280개** (Z3 121 · Z5 127 · Z2 27). 이게 조사 단계에서 안 나온 지뢰다.
  메시 데이터를 공유하면 UV 도 공유되므로, 서로 다른 자리에 놓인 개찰구 두 대가
  아틀라스의 **같은 텍셀**을 가리킨다. 한쪽 그림자가 다른 쪽에 찍힌다.
  그래서 베이크 전에 존 대상 메시를 전부 single-user 로 끊는다 (1,986 → 2,229).

* `Lightmap` UV 는 BEVEL 모디파이어(359개)를 통과한다. 베벨이 UV 를 보간해 주므로
  base 24 loops → eval 96 loops 가 되어도 섬 안에 그대로 머문다. 확인함.
  ⚠ 단 **depsgraph 를 UV 추가 *뒤에* 새로 받아야** 보인다. 먼저 받아 둔 depsgraph 로
  `to_mesh()` 하면 UV 가 없다고 나온다 — 이 저장소에서 이미 여러 번 물린 평가 캐시다.

* FONT/CURVE 106개는 UV 레이어를 가질 수 없다 (커브 데이터라 파이썬으로 못 쓴다).
  평가하면 Blender 가 `UVMap` 을 자동으로 만들어 주는데, 그건 글자 바운딩 박스
  기준 0..1 이라 아틀라스 전체를 훑는다 — 그대로 두면 글자에 남의 그림자가 얼룩진다.
  그래서 예약 텍셀(중립값) 한 칸을 비워 두고 익스포트 pre-pass 가 그 좌표를 상수로 채운다.
  FONT 머티리얼 실측: TXT_WHITE 48 · TXT_DARK 37 · LINE2_GRN 8 · LED_AMBER 8 ·
  PSD_GREEN 3 · EXIT_TXT 2.

* 실패한 시도: 처음엔 면의 지배 축으로 큐브 투영하는 파이썬 폴백을 짜려 했다.
  이 프로젝트 지오메트리가 대부분 축 정렬 상자라 잘 맞을 줄 알았는데, 상자의 윗면과
  그 바로 아래 선반의 윗면이 같은 XY 로 투영돼 **섬이 겹친다.** 겹침을 풀려면 결국
  면 연결성 그래프를 돌려야 하고, 그건 `smart_project` 가 이미 하는 일이다.
  헤드리스에서 잘 돌고 충분히 빠른 것을 확인한 이상 직접 짤 이유가 없다.

* `COMBINED` 이 아니라 `DIFFUSE`(direct+indirect, **color 끔**) 로 굽는다.
  COMBINED 는 알베도와 발광이 텍스처에 섞여 들어가고, 게임에서 베이스 컬러에 또
  곱해져 이중 곱이 된다. color 패스를 끄면 순수한 조도만 남는다.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time

import bpy
import numpy as np

# ── 대상 ────────────────────────────────────────────────────────────────
ZONES = ["Z1_GROUND", "Z2_CONCOURSE", "Z3_GATES", "Z4_DESCENT", "Z5_PLATFORM", "Z5_TRAIN"]

RETIRED_PREFIX = "xx_"          # export_station.py 와 같은 규칙
UV_NAME = "Lightmap"

# 베이크에서 빼야 하는 컬렉션.
# CROWD(69) · CHARACTERS(12) 는 `exclude=False`, `hide_render=False` 다 —
# 그대로 두면 **NPC 그림자가 바닥에 영구히 박제된다.** 움직이는 것은 정적 라이트맵에
# 들어가면 안 된다. (DEBUG 는 이미 exclude=True, _COLLISION_OVERLAY 는
# hide_render=True 라 건드릴 필요 없다.)
DYNAMIC_COLLECTIONS = ["CROWD", "CHARACTERS"]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(bpy.data.filepath or ".")))
OUT_DIR = os.path.join(ROOT, "game", "public", "models", "map", "lightmap")
SIDECAR = os.path.join(ROOT, "assets", "lightmap_uv.npz")

# ── 패킹 상수 ───────────────────────────────────────────────────────────
# 오브젝트 하나 = 아틀라스의 정사각형 한 칸. 칸 크기는 표면적의 제곱근에 비례한다
# (면적이 4배면 한 변이 2배 → 텍셀 밀도가 일정하게 유지된다).
PAD = 2                 # 칸 사이 여백(텍셀). 베이크 margin 과 같은 값으로 맞춘다
MIN_SIDE = 4            # 아무리 작아도 4×4 는 준다. 2×2 는 margin 이 다 먹어 버린다
FIT_SHRINK = 0.93       # 한 번에 안 들어가면 밀도를 이만큼씩 줄여 재시도
FIT_TRIES = 80
RESERVED = 8            # 좌하단 8×8 은 예약 텍셀. FONT 가 여기를 상수로 가리킨다

# ── 픽셀 후처리 ─────────────────────────────────────────────────────────
# 이 게임은 180초 안에 지하철을 타는 게임이고 **안내 사인 판독이 최우선**이다.
# Blender 렌더처럼 구석을 까맣게 두면 그림은 좋아도 게임으로는 손해다.
# 그래서 구운 값을 그대로 쓰지 않고 바닥을 들어올린다: out = FLOOR + (1-FLOOR)*bake.
# 완전한 암부도 FLOOR 이하로는 안 내려간다.
FLOOR = 0.35
EXPOSURE = 1.0          # 조명기구 바로 아래는 1을 넘는다. 8비트에서 잘리므로 여기서 조절
NEUTRAL = 1.0           # 예약 텍셀 값. 1.0 = 라이트맵 없는 것과 같은 밝기(사인 가독 우선)

# 섬 사이의 빈 텍셀을 이웃 값으로 메우는 횟수.
# 실측: 2048² Z3 에서 값이 찍힌 텍셀이 아틀라스의 30% 뿐이었다 (칸 충전율은 67%).
# 즉 **칸 안쪽 절반이 구멍**이다 — 언랩된 섬이 정사각형 칸을 다 채우지 못한다.
# 그대로 두면 구멍이 0 → FLOOR 로 남아, 바이리니어/밉맵이 그 어두운 값을 표면으로
# 끌고 들어와 얼룩진다. 칸 **안에서만** 팽창시켜 옆 오브젝트로는 절대 안 번지게 한다.
DILATE = 8


# ══════════════════════════════════════════════════════════════════════
# 인자
# ══════════════════════════════════════════════════════════════════════
def parse_args() -> dict:
    """`blender -b ... -P this.py -- --res 1024` 형태로 받는다."""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    cfg = {
        "zones": list(ZONES),
        "res": 1024,
        "samples": 64,
        "bounces": 4,
        "device": "AUTO",       # AUTO | OPTIX | CUDA | CPU
        "bake": True,           # --uv-only 면 False
        "exposure": EXPOSURE,
        "floor": FLOOR,
        "format": "WEBP",       # WEBP | PNG
        "quality": 90,
    }
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--zones":
            i += 1
            cfg["zones"] = [z for z in argv[i].split(",") if z]
        elif a == "--res":
            i += 1
            cfg["res"] = int(argv[i])
        elif a == "--samples":
            i += 1
            cfg["samples"] = int(argv[i])
        elif a == "--bounces":
            i += 1
            cfg["bounces"] = int(argv[i])
        elif a == "--device":
            i += 1
            cfg["device"] = argv[i].upper()
        elif a == "--exposure":
            i += 1
            cfg["exposure"] = float(argv[i])
        elif a == "--floor":
            i += 1
            cfg["floor"] = float(argv[i])
        elif a == "--format":
            i += 1
            cfg["format"] = argv[i].upper()
        elif a == "--quality":
            i += 1
            cfg["quality"] = int(argv[i])
        elif a == "--uv-only":
            cfg["bake"] = False
        else:
            raise SystemExit(f"알 수 없는 인자: {a}")
        i += 1
    unknown = [z for z in cfg["zones"] if z not in ZONES]
    if unknown:
        raise SystemExit(f"알 수 없는 존: {unknown}")
    return cfg


# ══════════════════════════════════════════════════════════════════════
# 상태 저장/복원
#   이 스크립트는 렌더 엔진·조명·컬렉션 exclude 를 전부 흔든다.
#   복원하지 않으면 blender_preview.py · hq_tour.py · cp_render.py 의 렌더 결과가
#   같이 바뀐다. blend 를 저장하지 않더라도 같은 세션에서 이어 돌릴 수 있으므로
#   **끝나면 반드시 되돌린다.** (조명을 켠 채 익스포트로 넘어가 사고가 난 적이 있다.)
# ══════════════════════════════════════════════════════════════════════
def snapshot() -> dict:
    sc = bpy.context.scene
    return {
        "engine": sc.render.engine,
        "device": sc.cycles.device,
        "samples": sc.cycles.samples,
        "bounces": sc.cycles.max_bounces,
        "denoise": sc.cycles.use_denoising,
        "seed": sc.cycles.seed,
        "bake_type": sc.cycles.bake_type,
        "margin": sc.render.bake.margin,
        "use_direct": sc.render.bake.use_pass_direct,
        "use_indirect": sc.render.bake.use_pass_indirect,
        "use_color": sc.render.bake.use_pass_color,
        "sel_to_act": sc.render.bake.use_selected_to_active,
        "view_transform": sc.view_settings.view_transform,
        "compute": _compute_device_type(),
        "lights": {o.name: o.hide_render for o in bpy.data.objects if o.type == "LIGHT"},
        "excludes": _exclude_state(),
    }


def restore(s: dict) -> None:
    sc = bpy.context.scene
    sc.render.engine = s["engine"]
    sc.cycles.device = s["device"]
    sc.cycles.samples = s["samples"]
    sc.cycles.max_bounces = s["bounces"]
    sc.cycles.use_denoising = s["denoise"]
    sc.cycles.seed = s["seed"]
    sc.cycles.bake_type = s["bake_type"]
    sc.render.bake.margin = s["margin"]
    sc.render.bake.use_pass_direct = s["use_direct"]
    sc.render.bake.use_pass_indirect = s["use_indirect"]
    sc.render.bake.use_pass_color = s["use_color"]
    sc.render.bake.use_selected_to_active = s["sel_to_act"]
    sc.view_settings.view_transform = s["view_transform"]
    try:
        bpy.context.preferences.addons["cycles"].preferences.compute_device_type = s["compute"]
    except Exception:
        pass
    for name, hidden in s["lights"].items():
        o = bpy.data.objects.get(name)
        if o is not None:
            o.hide_render = hidden
    _set_exclude_state(s["excludes"])
    print("[hq_lightmap] 렌더 설정 · 조명 · 컬렉션 원복 완료")


def _compute_device_type() -> str:
    try:
        return bpy.context.preferences.addons["cycles"].preferences.compute_device_type
    except Exception:
        return "NONE"


def _walk_layer_colls(lc=None):
    lc = lc or bpy.context.view_layer.layer_collection
    yield lc
    for ch in lc.children:
        yield from _walk_layer_colls(ch)


def _exclude_state() -> dict:
    return {lc.name: lc.exclude for lc in _walk_layer_colls()}


def _set_exclude_state(state: dict) -> None:
    for lc in _walk_layer_colls():
        if lc.name in state:
            lc.exclude = state[lc.name]


# ══════════════════════════════════════════════════════════════════════
# 씬 준비
# ══════════════════════════════════════════════════════════════════════
def setup_cycles(cfg: dict) -> str:
    """엔진을 Cycles 로 바꾸고 GPU 를 붙인다.

    blend 의 현재 설정은 `BLENDER_EEVEE_NEXT` · `compute_device_type=NONE` ·
    `device=CPU` · `samples=4096` · `max_bounces=12` 다.
    EEVEE Next 는 텍스처 베이크를 아예 못 하고, 저 샘플/바운스로 CPU 에서 돌리면
    존당 몇 시간이다. 여기서 전부 갈아 끼운다.
    """
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"

    chosen = "CPU"
    want = cfg["device"]
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        order = ["OPTIX", "CUDA"] if want == "AUTO" else [want]
        for kind in order:
            if kind == "CPU":
                break
            try:
                prefs.compute_device_type = kind
            except TypeError:
                continue                      # 이 빌드가 지원 안 하는 백엔드
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == kind]
            if not gpus:
                continue
            for d in prefs.devices:
                d.use = (d.type == kind)
            chosen = kind
            break
    except Exception as exc:                  # 애드온이 없거나 드라이버가 죽은 경우
        print(f"[hq_lightmap] GPU 설정 실패({exc}) — CPU 로 간다")

    sc.cycles.device = "GPU" if chosen != "CPU" else "CPU"
    sc.cycles.samples = cfg["samples"]
    sc.cycles.use_denoising = True            # 샘플을 낮게 쓰므로 디노이즈가 필수
    sc.cycles.max_bounces = cfg["bounces"]
    sc.cycles.diffuse_bounces = cfg["bounces"]
    sc.cycles.glossy_bounces = min(2, cfg["bounces"])
    sc.cycles.transmission_bounces = min(2, cfg["bounces"])
    sc.cycles.seed = 0                        # 재현성. 애니메이션 시드 금지
    sc.cycles.use_animated_seed = False

    sc.cycles.bake_type = "DIFFUSE"
    sc.render.bake.use_pass_direct = True
    sc.render.bake.use_pass_indirect = True
    sc.render.bake.use_pass_color = False     # ← 알베도를 빼는 것이 핵심
    sc.render.bake.use_selected_to_active = False
    sc.render.bake.margin = PAD               # 칸 여백보다 크면 옆 칸으로 번진다
    try:
        sc.render.bake.margin_type = "ADJACENT_FACES"
    except Exception:
        pass
    sc.view_settings.view_transform = "Standard"   # AgX 가 저장에 끼지 않게

    print(f"[hq_lightmap] Cycles / {chosen} / samples={cfg['samples']} bounces={cfg['bounces']}")
    return chosen


def lights_on() -> int:
    """씬 조명 76개를 켠다.

    LIGHTS 컬렉션 규약이 `hide_render=True` 다 (익스포트에 조명이 섞여 나가지 않게).
    베이크는 당연히 조명이 있어야 하므로 여기서 켜고, `restore()` 가 되돌린다.
    안 되돌리면 익스포트에 조명이 딸려 나간다 — 이 저장소에서 실제로 난 사고다.
    """
    n = 0
    energy = 0.0
    for o in bpy.data.objects:
        if o.type == "LIGHT":
            o.hide_render = False
            n += 1
            energy += o.data.energy
    print(f"[hq_lightmap] 조명 {n}개 켬 (총 에너지 {energy:,.0f})")
    return n


def exclude_dynamic() -> None:
    hit = []
    for lc in _walk_layer_colls():
        if lc.name in DYNAMIC_COLLECTIONS:
            lc.exclude = True
            hit.append(lc.name)
    print(f"[hq_lightmap] 렌더에서 제외: {hit}")


# ══════════════════════════════════════════════════════════════════════
# 존 대상
# ══════════════════════════════════════════════════════════════════════
def zone_meshes(zone: str) -> list:
    """export_station.exportable() 과 **같은 규칙**의 MESH 만.

    규칙이 갈리면 라이트맵이 있는 오브젝트와 익스포트되는 오브젝트가 어긋난다.
    이름순으로 정렬해 패킹 순서를 고정한다 — 재현성의 근거가 여기다.
    """
    coll = bpy.data.collections.get(zone)
    if coll is None:
        raise RuntimeError(f"collection missing: {zone}")
    objs = [
        o for o in coll.all_objects
        if o.type == "MESH"
        and not o.name.startswith(RETIRED_PREFIX)
        and not o.hide_render
    ]
    return sorted(objs, key=lambda o: o.name)


def zone_curves(zone: str) -> list:
    """UV 레이어를 가질 수 없는 것들 — 예약 텍셀로 넘긴다."""
    coll = bpy.data.collections.get(zone)
    return sorted(
        [o for o in coll.all_objects
         if o.type in {"FONT", "CURVE", "SURFACE"}
         and not o.name.startswith(RETIRED_PREFIX)
         and not o.hide_render],
        key=lambda o: o.name,
    )


def make_single_user(objs: list) -> int:
    """공유 메시를 끊는다.

    실측 280개(Z3 121 · Z5 127 · Z2 27)가 메시 데이터를 공유한다. 공유하면 UV 도
    공유되므로 서로 다른 자리의 인스턴스가 아틀라스의 같은 칸을 가리킨다 —
    한쪽 그림자가 다른 쪽에 그대로 찍힌다. 라이트맵은 인스턴싱과 양립할 수 없다.
    """
    n = 0
    for o in objs:
        if o.data.users > 1:
            o.data = o.data.copy()
            n += 1
    if n:
        print(f"    공유 메시 {n}개 분리")
    return n


def surface_area(obj) -> float:
    """월드 스케일을 반영한 표면적(m²). 칸 크기를 정하는 근거."""
    sx, sy, sz = obj.matrix_world.to_scale()
    k = (abs(sx) * abs(sy) * abs(sz)) ** (2.0 / 3.0)
    return sum(p.area for p in obj.data.polygons) * k


# ══════════════════════════════════════════════════════════════════════
# UV — 오브젝트별 언랩 + 아틀라스 패킹
# ══════════════════════════════════════════════════════════════════════
def unwrap_objects(objs: list) -> None:
    """오브젝트마다 `Lightmap` 레이어를 만들고 0..1 에 언랩한다.

    기존 `UVMap`(1,451) · `UVChannel_1`(54) 은 **건드리지 않는다** — Blender 렌더와
    임포트 소품 텍스처가 그걸 쓴다. 새 레이어를 뒤에 붙일 뿐이다.
    """
    for o in objs:
        me = o.data
        uv = me.uv_layers.get(UV_NAME)
        if uv is None:
            uv = me.uv_layers.new(name=UV_NAME, do_init=False)
        me.uv_layers.active = uv
        uv.active_render = True               # 베이크가 쓰는 레이어

    for o in objs:
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        try:
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.smart_project(
                angle_limit=math.radians(66.0),
                island_margin=0.02,
                correct_aspect=False,
                scale_to_bounds=False,
            )
            bpy.ops.object.mode_set(mode="OBJECT")
        except Exception as exc:
            try:
                bpy.ops.object.mode_set(mode="OBJECT")
            except Exception:
                pass
            print(f"    ! 언랩 실패 {o.name}: {exc} → 예약 텍셀로 넘김")
            _fill_constant(o)


def _fill_constant(obj) -> None:
    """예약 텍셀 한 점으로 UV 를 채운다 (언랩 실패분·FONT 대체)."""
    uv = obj.data.uv_layers.get(UV_NAME)
    if uv is None:
        uv = obj.data.uv_layers.new(name=UV_NAME, do_init=False)
    n = len(uv.data)
    if n:
        flat = np.zeros(n * 2, dtype=np.float32)
        flat[:] = -1.0            # 표식. pack 단계에서 예약 좌표로 바꾼다
        uv.data.foreach_set("uv", flat)


def pack_atlas(objs: list, res: int) -> dict:
    """오브젝트별 0..1 UV 를 아틀라스의 정사각형 칸으로 옮긴다.

    칸 한 변 = sqrt(표면적) × 밀도. 면적이 4배면 한 변이 2배가 되어
    **텍셀 밀도가 오브젝트 사이에서 일정해진다.** 큰 바닥에 많은 텍셀이 간다.

    셸프(선반) 패킹을 쓴다. 칸이 전부 정사각형이라 선반 낭비가 거의 없고,
    무엇보다 정렬 순서만 고정하면 결과가 완전히 결정적이다.
    """
    areas = {o.name: max(surface_area(o), 1e-6) for o in objs}
    total = sum(areas.values())
    # 첫 밀도 추정: 아틀라스의 65% 를 채운다고 보고 역산
    usable = float(res * res) * 0.65
    density = math.sqrt(usable / total)
    max_side = max(MIN_SIDE + PAD, res // 2)

    for attempt in range(FIT_TRIES):
        sides = []
        for o in objs:
            s = int(math.ceil(math.sqrt(areas[o.name]) * density))
            s = max(MIN_SIDE, min(s, max_side - PAD)) + PAD
            sides.append((o.name, s))
        placed = _shelf_pack(sides, res)
        if placed is not None:
            used = sum(s * s for _, s in sides)
            print(f"    패킹 성공 (시도 {attempt + 1}, 밀도 {density:.2f} px/m, "
                  f"충전율 {used / (res * res) * 100:.0f}%)")
            return placed
        density *= FIT_SHRINK

    raise RuntimeError(f"아틀라스 {res}² 에 패킹 실패 — --res 를 올려라")


def _shelf_pack(sides: list, res: int):
    """큰 칸부터 선반에 올린다. 좌하단 RESERVED 칸은 비워 둔다."""
    order = sorted(sides, key=lambda kv: (-kv[1], kv[0]))
    x, y, shelf_h = 0, RESERVED, 0
    out = {}
    for name, s in order:
        if s > res:
            return None
        if x + s > res:
            x, y, shelf_h = 0, y + shelf_h, 0
        if y + s > res:
            return None
        out[name] = (x, y, s)
        x += s
        shelf_h = max(shelf_h, s)
    return out


def apply_atlas_uv(objs: list, placed: dict, res: int) -> None:
    """0..1 UV 를 각자의 칸 안으로 접어 넣는다.

    칸 안쪽으로 PAD/2 만큼 물러난다 — 베이크 margin 이 칸 밖으로 번지면
    옆 오브젝트의 조도가 섞인다.
    """
    ru, rv = reserved_uv(res)
    for o in objs:
        x, y, s = placed[o.name]
        uv = o.data.uv_layers[UV_NAME]
        n = len(uv.data)
        if n == 0:
            continue
        flat = np.empty(n * 2, dtype=np.float32)
        uv.data.foreach_get("uv", flat)

        inner = s - PAD
        if np.all(flat < -0.5):               # 언랩 실패 표식 → 예약 텍셀
            flat[0::2] = ru
            flat[1::2] = rv
        else:
            uu = np.clip(flat[0::2], 0.0, 1.0)
            vv = np.clip(flat[1::2], 0.0, 1.0)
            flat[0::2] = (x + PAD * 0.5 + uu * inner) / res
            flat[1::2] = (y + PAD * 0.5 + vv * inner) / res
        uv.data.foreach_set("uv", flat)


def reserved_uv(res: int) -> tuple:
    """예약 텍셀의 중심 UV. FONT 와 언랩 실패분이 여기를 가리킨다."""
    c = RESERVED * 0.5
    return (c / res, c / res)


# ══════════════════════════════════════════════════════════════════════
# 베이크
# ══════════════════════════════════════════════════════════════════════
def new_atlas(zone: str, res: int):
    """존 아틀라스 이미지. float 버퍼 + Non-Color.

    Non-Color 로 두는 이유: 픽셀에 담기는 건 색이 아니라 조도다. 저장 직전에
    sRGB 인코딩을 직접 해서 넣는다 (아래 `save_png` 주석 참조).
    """
    name = f"LM_{zone}"
    img = bpy.data.images.get(name)
    if img is not None and (img.size[0] != res or img.size[1] != res):
        bpy.data.images.remove(img)
        img = None
    if img is None:
        img = bpy.data.images.new(name, width=res, height=res,
                                  alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    img.generated_color = (0.0, 0.0, 0.0, 1.0)
    # 매 존마다 깨끗하게 시작 (재실행 시 이전 존 픽셀이 남으면 안 된다)
    px = np.zeros(res * res * 4, dtype=np.float32)
    px[3::4] = 1.0
    img.pixels.foreach_set(px)
    return img


MARK = "__LM_BAKE__"


def attach_bake_nodes(objs: list, img) -> list:
    """대상 머티리얼마다 임시 Image Texture 노드를 달고 active 로 만든다.

    Cycles 는 '활성 이미지 텍스처 노드'에 굽는다. 연결할 필요는 없다 —
    연결하면 오히려 셰이딩이 바뀌어 바운스 조도가 틀어진다.
    """
    mats = []
    seen = set()
    for o in objs:
        for m in o.data.materials:
            if m is None or m.name in seen:
                continue
            seen.add(m.name)
            mats.append(m)

    touched = []
    for m in mats:
        if not m.use_nodes:
            m.use_nodes = True
        nt = m.node_tree
        node = nt.nodes.new("ShaderNodeTexImage")
        node.name = node.label = MARK
        node.image = img
        node.select = True
        nt.nodes.active = node
        touched.append(m)
    print(f"    임시 베이크 노드 {len(touched)}개 머티리얼에 부착")
    return touched


def detach_bake_nodes(mats: list) -> None:
    """임시 노드 제거. 하나라도 남으면 다음 존 베이크가 엉뚱한 이미지에 쓴다."""
    n = 0
    for m in mats:
        if not m.use_nodes:
            continue
        for node in [x for x in m.node_tree.nodes if x.name.startswith(MARK)]:
            m.node_tree.nodes.remove(node)
            n += 1
    print(f"    임시 베이크 노드 {n}개 제거")


def flatten_for_bake(objs: list):
    """모디파이어를 적용하고 존을 **한 오브젝트로 합친다.** 순전히 속도 때문이다.

    Cycles 베이크는 선택된 오브젝트마다 씬을 통째로 다시 동기화한다.
    Z3(280개)를 그대로 구웠더니 512²/16샘플에 **335초**가 걸렸다 — 경로 추적은
    1초도 안 되고 나머지가 전부 오브젝트당 동기화 오버헤드였다(280 × 약 1.2초).
    하나로 합치면 동기화가 한 번이다.

    합쳐도 잃는 것이 없다. 이 시점에 UV 는 이미 사이드카에 담겨 있고, 베이크 결과는
    지오메트리와 UV 에만 의존한다. 원본 오브젝트는 이 세션에서 다시 쓰지 않는다
    (blend 를 저장하지 않으므로 파일에는 영향이 없다).

    `convert` 로 모디파이어를 먼저 적용하는 이유: `export_station.py` 가
    `export_apply=True` 라 **게임에 나가는 형상은 모디파이어가 적용된 쪽**이다.
    베이크도 같은 형상 위에서 해야 베벨(359개) 모서리가 어긋나지 않는다.
    """
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.hide_set(False)
        o.hide_viewport = False
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.convert(target="MESH")        # BEVEL 등 적용 (UV 는 보간되어 살아남는다)
    if len(objs) > 1:
        bpy.ops.object.join()
    merged = bpy.context.view_layer.objects.active
    uv = merged.data.uv_layers.get(UV_NAME)
    if uv is None:
        raise RuntimeError(f"합친 메시에 {UV_NAME} 이 없다")
    merged.data.uv_layers.active = uv
    uv.active_render = True
    print(f"    베이크용 병합: 1 오브젝트 · {len(merged.data.polygons)} 폴리곤 · "
          f"{len(merged.data.materials)} 머티리얼")
    return merged


def bake_zone(merged) -> float:
    bpy.ops.object.select_all(action="DESELECT")
    merged.select_set(True)
    bpy.context.view_layer.objects.active = merged
    t0 = time.time()
    bpy.ops.object.bake(type="DIFFUSE")
    return time.time() - t0


# ══════════════════════════════════════════════════════════════════════
# 후처리 · 저장
# ══════════════════════════════════════════════════════════════════════
def _srgb_encode(x: np.ndarray) -> np.ndarray:
    """선형 → sRGB. 8비트 PNG 의 어두운 쪽 계조를 살리기 위해 직접 인코딩한다.

    게임은 이 텍스처를 `SRGBColorSpace` 로 읽어 다시 선형으로 되돌린다.
    (Blender 의 컬러 매니지먼트에 맡기면 백그라운드 모드에서 뷰 트랜스폼이
     끼어드는지 아닌지가 버전마다 달라 예측이 안 된다. 직접 하면 명시적이다.)
    """
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1.0 / 2.4) - 0.055)


def _dilate_square(tile: np.ndarray, iters: int) -> np.ndarray:
    """정사각형 칸 하나 안에서만 빈 텍셀을 4-이웃 평균으로 메운다.

    `np.roll` 을 쓰면 아틀라스 반대편 끝이 감겨 들어온다 (셸프 패커가 x=0 부터
    깔기 때문에 섬이 실제로 가장자리에 닿는다). 그래서 칸 단위로 잘라
    슬라이스 시프트로만 처리한다 — 칸 밖으로는 원리적으로 못 새어 나간다.
    """
    h, w = tile.shape[:2]
    if h < 2 or w < 2:
        return tile
    empty = tile.max(axis=2) <= 1e-6
    for _ in range(iters):
        if not empty.any():
            break
        acc = np.zeros_like(tile)
        cnt = np.zeros((h, w), dtype=np.float32)
        filled = (~empty).astype(np.float32)
        # 위·아래·좌·우 (제로 패딩 시프트)
        acc[1:, :] += tile[:-1, :] * filled[:-1, :, None]
        cnt[1:, :] += filled[:-1, :]
        acc[:-1, :] += tile[1:, :] * filled[1:, :, None]
        cnt[:-1, :] += filled[1:, :]
        acc[:, 1:] += tile[:, :-1] * filled[:, :-1, None]
        cnt[:, 1:] += filled[:, :-1]
        acc[:, :-1] += tile[:, 1:] * filled[:, 1:, None]
        cnt[:, :-1] += filled[:, 1:]
        new = empty & (cnt > 0)
        if not new.any():
            break
        tile[new] = acc[new] / cnt[new][:, None]
        empty = empty & ~new
    return tile


def dilate_islands(rgb: np.ndarray, placed: dict, res: int) -> np.ndarray:
    grid = rgb.reshape(res, res, 3)
    for x, y, s in placed.values():
        grid[y:y + s, x:x + s] = _dilate_square(grid[y:y + s, x:x + s], DILATE)
    return grid.reshape(-1, 3)


def postprocess(img, res: int, placed: dict, exposure: float, floor: float) -> dict:
    """구멍 메우기 → 노출 → 바닥값 리프트 → 예약 텍셀 스탬프 → sRGB 인코딩.

    ⚠ `exposure` 와 `floor` 는 **모든 존에 같은 값**이어야 한다. 존마다 자동 노출을
    걸면 각 존은 예쁘게 나오지만 플레이어가 Z2 → Z3 으로 넘어갈 때 밝기가 튄다.
    한 번의 실행에서 전 존에 같은 값이 적용되고, 그 값을 사이드카에 기록해 둔다.
    """
    px = np.empty(res * res * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    rgb = px.reshape(-1, 4)[:, :3]

    raw_max = float(rgb.max()) if rgb.size else 0.0
    raw_mean = float(rgb.mean()) if rgb.size else 0.0

    # 진단 — 아틀라스에서 실제로 값이 찍힌 텍셀의 비율과 분포.
    # 커버리지가 낮으면 섬이 지오메트리에 비해 작다는 뜻이다(해상도를 올려야 한다).
    lum = rgb.max(axis=1)
    cov = float((lum > 1e-6).mean())
    hit = lum[lum > 1e-6]
    pct = (np.percentile(hit, [5, 50, 95]).tolist() if hit.size else [0, 0, 0])

    rgb = dilate_islands(np.ascontiguousarray(rgb), placed, res)
    cov2 = float((rgb.max(axis=1) > 1e-6).mean())

    lin = np.clip(rgb * exposure, 0.0, 1.0)
    lin = floor + (1.0 - floor) * lin          # 구석이 까매지지 않게 (사인 가독)

    out = _srgb_encode(lin)

    # 예약 텍셀 — FONT 와 언랩 실패분이 가리키는 중립 회색
    grid = out.reshape(res, res, 3)
    grid[0:RESERVED, 0:RESERVED, :] = _srgb_encode(np.float32(NEUTRAL))

    flat = px.reshape(-1, 4)
    flat[:, :3] = out
    flat[:, 3] = 1.0
    img.pixels.foreach_set(flat.reshape(-1))
    return {"raw_max": raw_max, "raw_mean": raw_mean, "out_mean": float(out.mean()),
            "coverage": cov, "filled": cov2, "p05": pct[0], "p50": pct[1], "p95": pct[2]}


def save_image(img, zone: str, fmt: str, quality: int) -> str:
    """아틀라스를 파일로 낸다.

    기본을 WebP 로 둔 이유는 실측이다 — 2048² 6장을 PNG 로 뽑으면 **34 MB** 다.
    베이크에는 디노이저가 없어(Cycles 는 `bpy.ops.object.bake()` 에 렌더 디노이저를
    적용하지 않는다) 잔노이즈가 남고, 무손실 압축은 그 노이즈를 그대로 짊어진다.
    180초짜리 웹 게임에 34 MB 를 더 얹을 수는 없다. WebP 로 가면 같은 그림이
    수십 분의 1 이 된다. 눈으로 확인할 때만 `--format PNG` 를 쓴다.
    """
    os.makedirs(OUT_DIR, exist_ok=True)
    ext = "webp" if fmt == "WEBP" else "png"
    path = os.path.normpath(os.path.join(OUT_DIR, f"LM_{zone}.{ext}"))
    img.file_format = fmt
    img.filepath_raw = path
    # ⚠ 품질은 `Image.save(quality=...)` 로 직접 넘겨야 한다.
    #   `scene.render.image_settings.quality` 를 세팅해 봐야 이 경로는 그걸 안 읽는다
    #   (q=90 과 q=100 의 결과 파일 크기가 212 KB 로 완전히 같아서 알아챘다).
    #   WebP 는 quality=100 이 무손실이다.
    img.save(quality=quality)
    return path


# ══════════════════════════════════════════════════════════════════════
# 사이드카 (익스포트가 읽는다)
# ══════════════════════════════════════════════════════════════════════
def geometry_fingerprint(obj) -> str:
    """형상이 바뀌면 값이 바뀌는 싸구려 지문.

    베이크 뒤에 지오메트리를 고치면 라이트맵이 어긋나는데, 그건 **화면에서
    바로 안 보이는 종류의 어긋남**이라 오래 못 잡는다. 익스포트가 이 값을 비교해
    경고를 띄운다.
    """
    me = obj.data
    return f"{len(me.vertices)}:{len(me.loops)}:{len(me.polygons)}"


def collect_uv(objs: list, curves: list, zone: str, res: int, store: dict) -> None:
    ru, rv = reserved_uv(res)
    for o in objs:
        uv = o.data.uv_layers.get(UV_NAME)
        if uv is None:
            continue
        n = len(uv.data)
        flat = np.empty(n * 2, dtype=np.float32)
        uv.data.foreach_get("uv", flat)
        store["arrays"].append(flat)
        store["index"][o.name] = {
            "zone": zone,
            "count": n,
            "fp": geometry_fingerprint(o),
            "offset": store["cursor"],
        }
        store["cursor"] += n * 2
    # FONT/CURVE 는 UV 를 못 가진다 → 좌표만 기록, 익스포트가 상수로 채운다
    for o in curves:
        store["curves"][o.name] = {"zone": zone}
    store["reserved"][zone] = [ru, rv]


def write_sidecar(store: dict, cfg: dict) -> str:
    """사이드카를 쓴다. **이번에 구운 존만 갈아 끼우고 나머지는 보존한다.**

    존 하나만 다시 굽는 것이 정상적인 작업 방식이다(전체는 몇 분씩 걸린다).
    그런데 그냥 덮어쓰면 나머지 다섯 존의 UV 가 사라지고, 익스포트는 그것들을
    조용히 예약 텍셀로 밀어 버린다 — 화면에서는 '라이트맵이 안 먹네' 로만 보여서
    원인을 찾는 데 오래 걸린다. 실제로 Z3 만 다시 굽고 익스포트했다가 사이드카
    항목이 2,229 → 280 으로 줄어든 것을 보고 잡았다.
    """
    os.makedirs(os.path.dirname(SIDECAR), exist_ok=True)
    baked = set(store["zones"])
    arrays = list(store["arrays"])
    index = dict(store["index"])
    curves = dict(store["curves"])
    reserved = dict(store["reserved"])
    zone_res = {z: cfg["res"] for z in store["zones"]}
    cursor = store["cursor"]
    zones = list(store["zones"])

    if os.path.exists(SIDECAR):
        try:
            old = np.load(SIDECAR, allow_pickle=False)
            ometa = json.loads(str(old["meta"]))
            ouv = old["uv"]
            kept = 0
            for name, rec in ometa.get("index", {}).items():
                if rec["zone"] in baked:
                    continue
                n = rec["count"]
                arrays.append(ouv[rec["offset"]:rec["offset"] + n * 2])
                index[name] = dict(rec, offset=cursor)
                cursor += n * 2
                kept += 1
            for name, rec in ometa.get("curves", {}).items():
                if rec["zone"] not in baked:
                    curves[name] = rec
            for z, v in ometa.get("reserved", {}).items():
                if z not in baked:
                    reserved[z] = v
                    zones.append(z)
            zone_res.update({z: r for z, r in ometa.get("zone_res", {}).items()
                             if z not in baked})
            if kept:
                print(f"[hq_lightmap] 기존 사이드카에서 {kept}개 유지 "
                      f"(안 구운 존: {sorted(set(zones) - baked)})")
        except Exception as exc:
            print(f"[hq_lightmap] ⚠ 기존 사이드카를 못 읽음({exc}) — 새로 쓴다")

    uv = np.concatenate(arrays) if arrays else np.zeros(0, dtype=np.float32)
    meta = {
        "version": 1,
        "uv_name": UV_NAME,
        "res": cfg["res"],
        "zone_res": zone_res,          # 존마다 해상도가 달라도 된다 (UV 는 0..1 정규화)
        "samples": cfg["samples"],
        "exposure": cfg["exposure"],
        "floor": cfg["floor"],
        "zones": sorted(set(zones)),
        "index": index,
        "curves": curves,
        "reserved": reserved,
    }
    np.savez_compressed(SIDECAR, uv=uv, meta=np.array(json.dumps(meta)))
    return SIDECAR


# ══════════════════════════════════════════════════════════════════════
def main() -> None:
    if not bpy.data.filepath:
        raise SystemExit("blend 파일을 열고 실행해라 (blender -b <blend> -P ...)")

    cfg = parse_args()
    print(f"[hq_lightmap] 존={cfg['zones']} res={cfg['res']} samples={cfg['samples']}")

    # 숨겨진 것도 선택할 수 있어야 베이크 대상이 된다 (export_station.py 와 같은 처리)
    for o in bpy.data.objects:
        o.hide_set(False)

    saved = snapshot()
    store = {"arrays": [], "index": {}, "curves": {}, "reserved": {},
             "zones": [], "cursor": 0}
    report = []
    t_all = time.time()
    try:
        device = setup_cycles(cfg)
        lights_on()
        exclude_dynamic()

        for zone in cfg["zones"]:
            print(f"\n─── {zone} ───")
            t0 = time.time()
            objs = zone_meshes(zone)
            curves = zone_curves(zone)
            if not objs:
                print("  대상 없음 — 건너뜀")
                continue
            print(f"  메시 {len(objs)}개 · FONT/CURVE {len(curves)}개")

            make_single_user(objs)
            unwrap_objects(objs)
            placed = pack_atlas(objs, cfg["res"])
            apply_atlas_uv(objs, placed, cfg["res"])
            t_uv = time.time() - t0

            # ⚠ 사이드카를 **병합 전에** 담는다. 병합하면 원본 오브젝트가 사라지고,
            #    익스포트가 필요로 하는 것은 base 메시(모디파이어 적용 전) UV 다.
            collect_uv(objs, curves, zone, cfg["res"], store)
            store["zones"].append(zone)
            n_mesh, n_curve = len(objs), len(curves)

            stats = {}
            path = None
            if cfg["bake"]:
                img = new_atlas(zone, cfg["res"])
                merged = flatten_for_bake(objs)
                mats = attach_bake_nodes([merged], img)
                try:
                    t_bake = bake_zone(merged)
                finally:
                    detach_bake_nodes(mats)
                stats = postprocess(img, cfg["res"], placed,
                                    cfg["exposure"], cfg["floor"])
                path = save_image(img, zone, cfg["format"], cfg["quality"])
                print(f"    베이크 {t_bake:.1f}s · 커버리지 {stats['coverage'] * 100:.0f}% "
                      f"→ 팽창 후 {stats['filled'] * 100:.0f}% · "
                      f"raw p05/p50/p95 = {stats['p05']:.2f}/{stats['p50']:.2f}/{stats['p95']:.2f} "
                      f"max={stats['raw_max']:.1f}")
                print(f"    저장: {path} ({os.path.getsize(path) / 1024:.0f} KB)")
                if stats["raw_max"] < 1e-4:
                    print("    ⚠ 아틀라스가 전부 검다 — 조명이 안 켜졌거나 대상이 안 잡혔다")
            else:
                t_bake = 0.0

            report.append((zone, n_mesh, n_curve, t_uv, t_bake, path, stats))

        sc = write_sidecar(store, cfg)
        print(f"\n[hq_lightmap] 사이드카: {sc} ({os.path.getsize(sc) / 1024:.0f} KB)")
    finally:
        restore(saved)

    print(f"\n=== 요약 (총 {time.time() - t_all:.0f}s, {device}) ===")
    for zone, nm, nc, tu, tb, path, st in report:
        print(f"  {zone}: mesh={nm} font={nc} uv={tu:.0f}s bake={tb:.0f}s "
              f"mean={st.get('out_mean', 0):.3f}")


# ⚠ `__main__` 일 때만 돈다.
# `hq_all.py` 의 `run()` 은 `__name__="__hq__"` 로 exec 하므로, 실수로 ORDER 에
# 넣어도 여기서 막힌다. 막아야 하는 이유는 이 스크립트가 속도를 위해 존 오브젝트를
# 하나로 join 하기 때문이다 — 같은 세션에서 export_station.py 가 이어 돌면
# 존이 이름 없는 덩어리 하나로 익스포트된다. 반드시 별도 프로세스로 돌려라.
if __name__ == "__main__":
    main()
else:
    print("[hq_lightmap] 건너뜀 — 이 스크립트는 별도 프로세스에서만 돈다.\n"
          "              blender -b <blend> -P tools/hq_lightmap.py -- --zones <ZONE>")
