"""열차 개문 + 객실 실내 마감 패스.

    "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe" -b ^
        assets\\station_map.blend -P tools\\hq_train.py

두 가지를 고친다.

── 1. 문이 안 열린다 (형상 결함)

`TR_door_*` · `Z5_psd_door_*` 가 개구 전체를 덮는 **한 짝짜리 슬래브**였고
오브젝트 원점이 개구 중심에 있었다. 게임 로더(`render/station.ts`)는

    const side = worldX(m) >= nearestDoor(worldX(m)) ? 'right' : 'left'

로 좌/우 뱅크를 가르는데, 원점이 정확히 문 중심이면 `x >= x` 가 **항상 참**이라
32 짝이 전부 'right' 로 몰린다. 결과는 두 가지가 겹친다.

  · 왼쪽 뱅크가 비어(`bank()` 이 null 을 돌려준다) 한쪽으로만 밀린다.
  · 슬라이드 폭은 0.78 m 인데 개구는 1.4(차문)~1.6 m(안전문)다.

그래서 `doorProgress === 1` 이어도 개구의 절반 이상이 막힌 채였다. 실제로
승강장에서 보면 "도착했는데 문이 안 열린다"로 보인다.

여기서는 **문짝을 두 장으로 쪼갠다.** 각 짝의 원점을 자기 쪽으로 옮겨 로더의
분류가 자연히 맞아떨어지게 하고, 0.78 m 슬라이드로 개구가 완전히 비게 폭을 맞춘다.

  · 차문   개구 1.40 → 짝 0.70 씩. 0.78 밀면 0.08 여유
  · 안전문 개구 1.60 → 짝 0.80 씩. 0.78 밀면 0.02 남는다(문틀 고무로 읽힌다)

**밀린 문짝이 어디로 가는지**를 y 로 반드시 피해 준다. 열린 차문은 옆 기둥벽
(`TR_side` y 12.42~12.52)과 그 창(`TR_win` y 12.40~12.54) 위를 지나가므로
문짝을 y 12.30~12.38 로 **승강장 쪽 4 cm 앞에** 세웠다. 같은 이유로 안전문 짝은
고정 유리(12.09~12.21)와 멀리언(12.05~12.25) 앞인 11.98~12.04 로 나온다.
이걸 안 하면 열린 문이 벽 안에 박혀 Z-파이팅으로 점멸한다.

── 2. 실내가 통짜 상자다

`TR_interior` 는 78~206 m 를 관통하는 **삼각형 12개짜리 상자** 하나였다.
문이 열려도 그 상자의 바깥면(어두운 판)이 보일 뿐이라 "탈 수 있는 칸"으로
안 읽힌다. 상자를 걷어내고 실제 객실을 짓는다 — 바닥·천장·조명 라인·
롱시트·등받이·유리 칸막이·수직봉·손잡이 레일·손잡이·칸막이벽.

객차 8량 × 두 편성(본편 · 반대 방면 `B_` 접두사)을 같은 코드로 만든다.

── 멱등성

`hq_lib.Batch.build()` 는 같은 이름이 있으면 **메시만 갈아 끼운다.** 문짝도 같은
규칙(`_leaf`)으로 만든다. 몇 번을 돌려도 결과가 같다. 쪼개기 전의 옛 한 짝짜리
문과 옛 `TR_interior` 는 지운다(이름이 새 것과 겹치지 않으므로 남으면 유령이 된다).
"""

from __future__ import annotations

import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from hq_lib import Batch, mat, zone_collection  # noqa: E402

# ── 편성 치수 (MAP 부록 A · 기존 GLB 실측) ──────────────────────────────
CARS = 8
X0 = 78.0
CAR_LEN = 16.0
DOOR_OFF = (2.0, 6.0, 10.0, 14.0)

#: 차문 개구 반폭. `data/tuning.ts TRAIN.doorHalfWidth` (0.8) 는 **판정** 반폭이고
#: 여기 0.70 은 형상 반폭이다 — 판정이 형상보다 관대한 건 GDD §11 그대로다.
DOOR_HW = 0.70
PSD_HW = 0.80
#: 로더가 문짝에 주는 슬라이드(`render/station.ts` 의 `doorProgress * 0.78`)
SLIDE = 0.78

# y — 편성 진행 방향에 수직인 축. 승강장이 작은 쪽에 있다.
Y_NEAR_OUT, Y_NEAR_IN = 12.42, 12.52
Y_FAR_IN, Y_FAR_OUT = 15.48, 15.58
#: 승강장 쪽 문짝이 앉는 자리 — **열리면 옆 기둥벽 위를 지나가므로** 차체(12.42)보다
#: 4 cm 앞, 그 창(12.40)보다 2 cm 앞으로 빼 둔다. 안 그러면 열린 문이 벽에 박힌다.
Y_DOOR_NEAR = (12.30, 12.38)
#: 반대쪽 문짝은 안 움직인다 → **객실 안쪽 면에 붙여** 넣는다.
#:
#: 처음엔 밖(15.62~15.70)에 뒀더니 벽면과 문짝 사이 14 cm 홈이 생겼고, 그 홈을 지나는
#: 노선 띠(`TR_stripe` y 15.50~15.60)가 승강장에서 **열린 문 너머 초록 막대**로 보였다.
#: 벽 두께에 딱 맞추면(15.48~15.58) 이번엔 띠와 부피가 겹쳐 Z-파이팅으로 비친다.
#: 안쪽 면(15.38~15.48)에 붙이면 띠가 문짝 **뒤**로 완전히 들어간다.
Y_DOOR_FAR = (15.38, 15.48)
#: 안전문 짝 — 고정 유리(12.09)·멀리언(12.05) 보다 앞
Y_PSD = (11.98, 12.04)
Y_OPP = 40.0

# z — 높이
FLOOR_Z = -20.00
DOOR_TOP = -17.70
BODY_TOP = -17.55
ROOF_BOT = -16.70
CEIL_Z = -17.60          # 실내 천장 아랫면
SEAT_TOP = -19.55
RAIL_Z = -18.12

WIN_Z = (-18.80, -17.75)


def _mats() -> dict:
    """머티리얼 — **새로 만드는 건 두 개뿐**이다.

    `hq_merge_materials.py` 의 교훈: 새 머티리얼은 존당 드로우 콜을 하나씩 늘리면서
    로더의 이름 목록(`SELF_LIT_MATERIALS`·`GLASS_MATERIALS`·`DECAL_MATERIALS`)에서
    빠져 **품질까지 떨어뜨린다.** 그래서 실내 부재는 기존 TR 팔레트에 얹는다 —
    바닥은 `TR_SKIRT`(짙은 회색), 봉·레일·손잡이는 `TR_BODY`(스테인리스 톤),
    문턱·좌석 밑판은 `TR_JOINT`(어두운 회색), 칸막이는 `TR_WINDOW`(유리).

    새로 만드는 둘:
      · `TR_SEAT`  팔레트에 좌석 원단 색(청록)이 없다
      · `TR_LIGHT` 형광 라인. **`render/station.ts` 의 `SELF_LIT_MATERIALS` 와
        `GLOW_EXCLUDE` 양쪽에 반드시 올린다.** 앞을 빠뜨리면 툰에 눌려 꺼진 등이 되고
        (같은 함정이 이 프로젝트에서 다섯 번 나왔다), 뒤를 빠뜨리면 글로우 판이
        월드 좌표로 구워져 **열차가 떠난 자리에 빛만 남는다.**
    """
    def have(name: str):
        m = bpy.data.materials.get(name)
        if m is None:
            raise RuntimeError(f"머티리얼 {name} 이 없다 — 열차 GLB 가 바뀌었는지 확인할 것")
        return m

    return {
        "floor": have("TR_SKIRT"),
        "trim": have("TR_BODY"),
        "dark": have("TR_JOINT"),
        "inner": have("TR_INNER"),
        "body": have("TR_BODY"),
        "glass": have("TR_WINDOW"),
        "door": have("TR_DOOR"),
        "stripe": have("TR_STRIPE"),
        "psd": have("PSD_GLASS"),
        "seat": mat("TR_SEAT", (0.09, 0.31, 0.38), roughness=0.75),
        # 광천장은 면적이 넓다 — 순백(1.0)으로 두면 화면이 날아간다. 승강장에서
        # "안이 켜져 있다"가 읽히는 선(0.80)까지만. 발광은 음영을 안 받으므로
        # 여기 적은 값이 **그대로 화면 밝기**다.
        "light": mat("TR_LIGHT", (0.80, 0.79, 0.74), emit=(0.80, 0.79, 0.74), strength=3.0),
    }


def _tune_inner() -> None:
    """`TR_INNER` — 통짜 상자 시절의 값(0.92 + 발광 1.6)을 천장판 값으로 되돌린다.

    발광으로 두면 음영을 안 받아 객실 위쪽 절반이 흰 공백으로 날아갔다(실측).
    게임 쪽에서 `SELF_LIT_MATERIALS` 에서 뺐으므로 여기서는 툰이 받을 밝은 회색이면 된다.
    """
    m = bpy.data.materials.get("TR_INNER")
    if m is None:
        return
    rgb = (0.86, 0.87, 0.84)
    m.diffuse_color = (*rgb, 1.0)
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Emission Color"].default_value = (*rgb, 1.0)


def _leaf(name, material, coll, x0, y0, z0, x1, y1, z1):
    """원점을 x 중앙에 둔 상자 하나. 문짝 전용.

    로더가 `worldX`(= 오브젝트 원점)로 좌/우를 가르므로 **원점 위치가 곧 의미**다.
    `Batch` 는 원점이 (0,0,0) 이라 문짝에는 못 쓴다.
    """
    cx = (x0 + x1) / 2
    b = Batch(name, material)
    b.box(x0 - cx, y0, z0, x1 - cx, y1, z1)
    ob = b.build(coll)
    ob.location = (cx, 0.0, 0.0)
    return ob


def _retire(prefixes: tuple[str, ...], keep: set[str]) -> int:
    """쪼개기 전의 옛 오브젝트를 지운다. 순회 중 삭제는 금물이라 목록을 먼저 굳힌다."""
    doomed = [
        ob for ob in bpy.data.objects
        if ob.name not in keep and any(ob.name.startswith(p) for p in prefixes)
    ]
    for ob in doomed:
        me = ob.data if ob.type == "MESH" else None
        bpy.data.objects.remove(ob, do_unlink=True)
        if me is not None and me.users == 0:
            bpy.data.meshes.remove(me)
    return len(doomed)


# ══════════════════════════════════════════════════════════════════════
# 1. 문 — 한 짝 → 두 짝
# ══════════════════════════════════════════════════════════════════════

def build_doors(M) -> set[str]:
    train = zone_collection("Z5_TRAIN")
    plat = zone_collection("Z5_PLATFORM")
    made: set[str] = set()

    for opp in (False, True):
        dy = Y_OPP if opp else 0.0
        pre = "B_" if opp else ""

        # ── 차문 · 문창
        #
        # **반대쪽(선로 쪽) 문은 열리지 않는다.** 승강장이 없는 쪽이니 실제로도 안 열리고,
        # 열어 두면 승강장에서 열차를 관통해 터널이 보여 객실이 "통짜 구멍"으로 읽힌다
        # (실측 스크린샷에서 검은 사각 두 개가 그것이었다). 로더의 동적 판정은
        # 이름(`TR_door_`/`TR_dwin_`)으로만 걸리므로, 반대쪽은 `TR_sdoor_`·`TR_swin_`
        # 으로 불러 **정적 병합**으로 보낸다 — 코드에 예외를 안 만들고 이름으로 가른다.
        for car in range(CARS):
            for di, off in enumerate(DOOR_OFF):
                cx = X0 + car * CAR_LEN + off
                for tag, (y0, y1), slid in (
                    ("12.4", Y_DOOR_NEAR, True), ("15.5", Y_DOOR_FAR, False),
                ):
                    dn, wn = ("TR_door_", "TR_dwin_") if slid else ("TR_sdoor_", "TR_swin_")
                    for side, sgn in (("L", -1), ("R", 1)):
                        a, b = (cx - DOOR_HW, cx) if sgn < 0 else (cx, cx + DOOR_HW)
                        n = f"{pre}{dn}{car}_{di}{side}_{tag}"
                        _leaf(n, M["door"], train, a, y0 + dy, FLOOR_Z, b, y1 + dy, DOOR_TOP)
                        made.add(n)
                        # 문창 — 짝 안쪽에 앉히고 양면으로 1 cm 씩 튀어나오게 한다.
                        # 밖에서도 안에서도 유리로 읽혀야 "탈 수 있다"가 전달된다.
                        wa, wb = (a + 0.08, b - 0.06) if sgn < 0 else (a + 0.06, b - 0.08)
                        nw = f"{pre}{wn}{car}_{di}{side}_{tag}"
                        _leaf(nw, M["glass"], train,
                              wa, y0 - 0.01 + dy, WIN_Z[0], wb, y1 + 0.01 + dy, WIN_Z[1])
                        made.add(nw)

        # ── 안전문(PSD) — 승강장 쪽에만 있다
        for i in range(CARS * len(DOOR_OFF)):
            car, di = divmod(i, len(DOOR_OFF))
            cx = X0 + car * CAR_LEN + DOOR_OFF[di]
            for side, sgn in (("L", -1), ("R", 1)):
                a, b = (cx - PSD_HW, cx) if sgn < 0 else (cx, cx + PSD_HW)
                n = f"{pre}Z5_psd_door_{i}{side}"
                _leaf(n, M["psd"], plat,
                      a, Y_PSD[0] + dy, -19.90, b, Y_PSD[1] + dy, -17.80)
                made.add(n)

    return made


# ══════════════════════════════════════════════════════════════════════
# 2. 객실 실내
# ══════════════════════════════════════════════════════════════════════

def _wall_bays() -> list[tuple[float, float, bool, bool]]:
    """한 량의 측벽 구간 (a, b, 왼끝이 출입구인가, 오른끝이 출입구인가)."""
    edges = [0.12]
    for off in DOOR_OFF:
        edges += [off - DOOR_HW, off + DOOR_HW]
    edges.append(CAR_LEN - 0.12)
    bays = []
    for i in range(0, len(edges) - 1, 2):
        a, b = edges[i], edges[i + 1]
        bays.append((a, b, i > 0, i + 2 < len(edges)))
    return bays


BAYS = _wall_bays()


def build_interior(M, opp: bool) -> None:
    dy = Y_OPP if opp else 0.0
    pre = "B_" if opp else ""
    coll = zone_collection("Z5_TRAIN")

    #: 이름에 `ceil` 을 넣지 말 것 — 로더의 `OVERHEAD_NAME = /ceil/i` 가 잡아
    #: 쿼터뷰에서 객실 천장만 사라진다. (`in_soffit` 으로 부른다)
    stripe = Batch(f"{pre}TR_in_stripe", M["stripe"])
    floor = Batch(f"{pre}TR_in_floor", M["floor"])
    soffit = Batch(f"{pre}TR_in_soffit", M["inner"])
    light = Batch(f"{pre}TR_in_light", M["light"])
    seat = Batch(f"{pre}TR_in_seat", M["seat"])
    metal = Batch(f"{pre}TR_in_metal", M["trim"])
    dark = Batch(f"{pre}TR_in_dark", M["dark"])
    glass = Batch(f"{pre}TR_in_glass", M["glass"])
    body = Batch(f"{pre}TR_in_body", M["body"])

    y_near_in = Y_NEAR_IN + dy
    y_far_in = Y_FAR_IN + dy

    for car in range(CARS):
        x0 = X0 + car * CAR_LEN
        xa, xb = x0 + 0.12, x0 + CAR_LEN - 0.12

        # ── 바닥 · 천장
        #
        # 천장은 **가운데를 통으로 발광판**으로 둔다. 처음엔 천장판 전체를 발광으로
        # 돌렸다가 위쪽 절반이 흰 공백이 됐고(음영이 사라진다), 반대로 전부 툰으로
        # 두니 아래를 향한 면이 램프 최저 단계로 떨어져 **천장이 새까맣게** 나왔다.
        # 실사 2호선 객실이 그렇듯 가운데 광천장 + 양옆 코브로 가른다 — 빛은 기구가
        # 내고(발광), 코브는 그 빛을 받는 면(툰)이라 깊이가 산다.
        floor.box(xa, y_near_in, FLOOR_Z, xb, y_far_in, FLOOR_Z + 0.045)
        for ya, yb in ((y_near_in, 13.10 + dy), (14.90 + dy, y_far_in)):
            soffit.box(xa, ya, CEIL_Z - 0.07, xb, yb, CEIL_Z)
        light.box(x0 + 0.25, 13.10 + dy, CEIL_Z - 0.08,
                  x0 + CAR_LEN - 0.25, 14.90 + dy, CEIL_Z - 0.02)

        # ── 노선 띠 — **출입구에서 끊는다.**
        #
        # 원래는 한 량 전장을 관통하는 막대 하나였다. 문이 닫혀 있을 땐 문짝이 앞에서
        # 가려 주니 티가 안 났는데, 문이 제대로 열리기 시작하자 **열린 개구를 초록 막대가
        # 가로지르는** 그림이 됐다(승강장 실측). 실물도 띠는 문짝 위에 따로 붙는다 —
        # 벽에 붙은 띠가 개구를 건너갈 수는 없다.
        for a, b, _, _ in BAYS:
            for sy in (12.40, 15.50):
                stripe.box(x0 + a, sy + dy, -19.05, x0 + b, sy + 0.10 + dy, -18.85)

        # ── 어깨판 — 차체 옆판 윗단(-17.55)과 지붕(-16.70) 사이가 뚫려 있었다.
        #    통짜 `TR_interior` 가 가리고 있던 구멍이라 실내를 넣으면 드러난다.
        for ya, yb in ((Y_NEAR_OUT, Y_NEAR_IN), (Y_FAR_IN, Y_FAR_OUT)):
            body.box(x0 + 0.05, ya + dy, BODY_TOP, x0 + CAR_LEN - 0.05, yb + dy, ROOF_BOT)

        # ── 칸막이벽 — 량 끝. 가운데를 비워 다음 칸이 보이게 한다(깊이감)
        for bx in (x0 + 0.12, x0 + CAR_LEN - 0.20):
            for ya, yb in ((y_near_in, 13.58 + dy), (14.42 + dy, y_far_in)):
                soffit.box(bx, ya, FLOOR_Z, bx + 0.08, yb, CEIL_Z - 0.07)

        # ── 출입구 발판 — 바닥과 벽 두께 사이의 어두운 띠. 문선이 읽힌다.
        for off in DOOR_OFF:
            cx = x0 + off
            for ya, yb in ((Y_NEAR_OUT - 0.02, Y_NEAR_IN), (Y_FAR_IN, Y_FAR_OUT + 0.02)):
                dark.box(cx - DOOR_HW - 0.02, ya + dy, FLOOR_Z,
                         cx + DOOR_HW + 0.02, yb + dy, FLOOR_Z + 0.05)

        # ── 롱시트 · 등받이 · 좌석 밑판 · 유리 칸막이 · 수직봉
        for wall_y, sgn in ((y_near_in, 1.0), (y_far_in, -1.0)):
            for a, b, door_a, door_b in BAYS:
                sx0, sx1 = x0 + a + 0.05, x0 + b - 0.05
                if sx1 - sx0 < 0.5:
                    continue
                y_c0 = wall_y + 0.02 * sgn
                y_c1 = wall_y + 0.47 * sgn
                seat.box(sx0, y_c0, SEAT_TOP - 0.09, sx1, y_c1, SEAT_TOP)
                seat.box(sx0, wall_y + 0.01 * sgn, SEAT_TOP,
                         sx1, wall_y + 0.11 * sgn, SEAT_TOP + 0.57)
                dark.box(sx0 + 0.04, wall_y + 0.07 * sgn, FLOOR_Z + 0.045,
                         sx1 - 0.04, wall_y + 0.42 * sgn, SEAT_TOP - 0.09)

                # 좌석 끝 강화유리 칸막이 + 수직봉 — 출입구에 면한 끝에만 세운다
                for at_x, is_door in ((sx0, door_a), (sx1, door_b)):
                    if not is_door:
                        continue
                    glass.box(at_x - 0.03, wall_y, FLOOR_Z,
                              at_x + 0.03, wall_y + 0.52 * sgn, SEAT_TOP + 1.00)
                    metal.tube("z", FLOOR_Z, CEIL_Z - 0.07,
                               at_x, wall_y + 0.50 * sgn, 0.028, seg=8)

            # ── 손잡이 레일 + 손잡이
            ry = wall_y + 0.50 * sgn
            metal.tube("x", x0 + 0.16, x0 + CAR_LEN - 0.16, ry, RAIL_Z, 0.022, seg=8)
            n_strap = int((CAR_LEN - 1.2) / 0.7)
            for i in range(n_strap):
                sx = x0 + 0.6 + i * 0.7
                metal.box(sx - 0.012, ry - 0.012, RAIL_Z - 0.28,
                          sx + 0.012, ry + 0.012, RAIL_Z)
                metal.box(sx - 0.032, ry - 0.035, RAIL_Z - 0.38,
                          sx + 0.032, ry + 0.035, RAIL_Z - 0.28)

    for b in (stripe, floor, soffit, light, seat, metal, dark, glass, body):
        b.build(coll)


# ══════════════════════════════════════════════════════════════════════

def run() -> None:
    M = _mats()
    _tune_inner()
    made = build_doors(M)
    # 옛 한 짝짜리 문 · 통짜 실내 상자를 걷어낸다
    n = _retire(
        ("TR_door_", "TR_dwin_", "TR_sdoor_", "TR_swin_",
         "B_TR_door_", "B_TR_dwin_", "B_TR_sdoor_", "B_TR_swin_",
         "Z5_psd_door_", "B_Z5_psd_door_", "TR_interior", "B_TR_interior",
         "TR_stripe_", "B_TR_stripe_"),
        made,
    )
    build_interior(M, opp=False)
    build_interior(M, opp=True)
    print(f"[hq_train] 문짝 {len(made)}개 재조립 · 옛 오브젝트 {n}개 정리 · 실내 2편성")


run()

if __name__ == "__main__":
    bpy.ops.wm.save_mainfile()
    print("[hq_train] saved")
