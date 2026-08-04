"""패스 N — 지상 가로 경관: 도로 양쪽 건물군과 횡단보도 신호등.

지상은 두 가지가 결정적으로 비어 있었다.

  1. **건물이 도로 북쪽 한 줄뿐**이고, 그것도 33 m 짜리 상자 하나(`Z1_bld_mass_W/E`,
     면 6개)에 창 띠와 차양을 붙인 것이 전부였다. 남쪽을 보면 하늘과 빈 땅이다.
  2. **신호등이 한 기**뿐이고 횡단보도 북단(y 31.1)에는 머리 없는 기둥만 서 있었다.
     7.2 m 를 건너는 동안 신호를 볼 수 없다.

실사 대조(서울 대로변 사진 다수)에서 가로가 가로로 읽히게 하는 것은 넷이다.

    개별 동으로 끊긴 스카이라인 · 층마다 도는 슬래브 띠 · 다른 성격의 저층부 ·
    옥탑과 파라펫

한 덩어리 상자에 창만 뚫으면 아무리 커도 배경 판으로 보인다. 그래서 여기서는
**동(棟) 단위로 매스를 쪼개고** 층·저층부·옥탑을 각각 만든다.

보행신호등은 실사 규격을 따른다 — 등면 300 mm, 세로 2등(위 녹 · 아래 적),
등마다 차양, 케이스 아래 잔여시간 막대, 등 하단 2.5 m.

⚠ 등 재질 이름은 반드시 `TL_RED` · `TL_GRN` · `TL_COUNT` 다. 게임이 **머티리얼
   이름으로** 찾아 매 프레임 색을 바꾼다(`render/station.ts`). 이름이 다르면
   불이 안 들어오고, 병합에서도 안 빠져 정적 지오메트리에 섞인다.
"""

from __future__ import annotations

import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))
                if "__file__" in dir() else r"C:\Users\User\Documents\HACKERTON\tools")
import hq_lib                                    # noqa: E402
import importlib                                 # noqa: E402
importlib.reload(hq_lib)
from hq_lib import Batch, mat, zone_collection   # noqa: E402

# ── 가로 치수 (충돌 `world.ts` 와 같은 값) ──────────────────────
ROAD = (16.0, 22.0)          # 차도 y 범위
WALK_N = (22.0, 34.0)        # 북측 인도 (플레이어가 걷는 곳)
WALK_S = (12.6, 16.0)        # 남측 인도 — 배경이라 충돌은 없다
BLD_N_Y = 34.0               # 북측 건물 앞면
BLD_S_Y = 12.6               # 남측 건물 앞면
DEPTH = 11.0                 # 건물 안길이
X0, X1 = -66.0, 12.0

FLOOR_H = 3.30               # 층고
BASE_H = 4.20                # 저층부(상가) 높이
SLAB_T = 0.22                # 층 슬래브 띠 두께
PARAPET_H = 0.75

# 출입구 건물(x −1.3~14.6)과 겹치지 않게 북측은 x 0 에서 끊는다
GAP_N = (-1.6, 12.0)
# 이면도로 — 횡단보도(x −31~−23)가 건너는 **차도**다. 남북으로 흐르므로
# 양쪽 건물 모두 이 구간을 비워야 한다. 처음에 건물을 채워 두었더니
# 횡단보도 바로 옆이 건물 벽이라 "도로인데 건물이 있다"가 됐다.
SIDE_ROAD = (-31.4, -22.6)


def rng(seed):
    """시드 고정 LCG. `random` 을 쓰면 Blender 세션마다 결과가 달라져
    리빌드할 때마다 스카이라인이 바뀐다 — 그러면 회귀 촬영이 무의미해진다."""
    s = seed

    def nxt(lo, hi):
        nonlocal s
        s = (s * 1103515245 + 12345) & 0x7FFFFFFF
        return lo + (s / 0x7FFFFFFF) * (hi - lo)
    return nxt


def blocks(x0, x1, seed, skip=None):
    """가로를 동 단위로 쪼갠다. (x0, x1, 층수, 색인)

    `skip` 과 `SIDE_ROAD` 구간은 비운다. 겹치는 동은 **잘라서** 남은 쪽만 쓴다 —
    중심만 보고 버리면 이면도로 위로 건물이 걸쳐 남는다.
    """
    r = rng(seed)
    out, x = [], x0
    i = 0
    while x < x1 - 5.0:
        w = r(7.0, 13.5)
        if x + w > x1:
            w = x1 - x
        nx = x + w
        floors = int(r(2.6, 6.4))
        for a, b in _cut(_cut([(x, nx)], SIDE_ROAD), skip):
            if b - a >= 4.0:
                out.append((a + 0.18, b - 0.18, floors, i))
        x = nx
        i += 1
    return out


def _cut(spans, gap):
    """구간 목록에서 `gap` 을 도려낸다."""
    if gap is None:
        return spans
    out = []
    for a, b in spans:
        if b <= gap[0] or a >= gap[1]:
            out.append((a, b))
            continue
        if a < gap[0]:
            out.append((a, gap[0]))
        if b > gap[1]:
            out.append((gap[1], b))
    return out


def build():
    m_wall = mat("BLD_WALL_A", (0.815, 0.800, 0.770), roughness=0.75)
    m_wall2 = mat("BLD_WALL_B", (0.660, 0.665, 0.670), roughness=0.75)
    m_wall3 = mat("BLD_WALL_C", (0.610, 0.560, 0.510), roughness=0.8)
    m_slab = mat("BLD_SLAB", (0.905, 0.898, 0.875), roughness=0.55)
    m_glass = mat("BLD_GLASS_HQ", (0.47, 0.55, 0.60), roughness=0.14, metallic=0.25)
    m_base = mat("BLD_BASE", (0.505, 0.500, 0.485), roughness=0.55)
    m_para = mat("BLD_PARAPET", (0.70, 0.69, 0.67), roughness=0.7)
    m_roof = mat("BLD_ROOF", (0.40, 0.41, 0.42), roughness=0.85)
    m_ac = mat("BLD_AC", (0.62, 0.63, 0.64), metallic=0.4, roughness=0.5)
    signs = [mat(f"BLD_SIGN_{i}", c, emit=c, strength=1.05) for i, c in enumerate(
        ((0.72, 0.16, 0.18), (0.14, 0.34, 0.68), (0.90, 0.66, 0.10),
         (0.12, 0.48, 0.30), (0.55, 0.20, 0.55)))]

    coll = zone_collection("Z1_GROUND")
    B = lambda n, m: Batch(f"Z1_hq_{n}", m)
    wall = [B("bldwallA", m_wall), B("bldwallB", m_wall2), B("bldwallC", m_wall3)]
    slab, glass = B("bldslab", m_slab), B("bldglass", m_glass)
    base, para = B("bldbase", m_base), B("bldpara", m_para)
    roof, ac = B("bldroof", m_roof), B("bldac", m_ac)
    sign = [B(f"bldsign{i}", m) for i, m in enumerate(signs)]

    n = 0
    # 남측은 인도에서 14 m 앞이라 층수를 낮춘다. 북측과 같이 6층까지 올리면
    # 횡단보도에서 남쪽을 볼 때 하늘이 통째로 막혀 거리가 좁게 느껴진다.
    for y_front, sgn, seed, skip, cap in ((BLD_N_Y, +1, 20260803, GAP_N, 9),
                                          (BLD_S_Y, -1, 77010203, None, 4)):
        for x0, x1, floors, i in blocks(X0, X1, seed, skip):
            _block(wall[i % 3], slab, glass, base, para, roof, ac,
                   sign, x0, x1, y_front, sgn, min(floors, cap), i)
            n += 1

    # ⚠ Batch 는 만들어 넘기는 것으로 끝나지 않는다 — **`build()` 를 불러야** 메시가 된다.
    #    처음에 이 두 개를 아래 루프에 안 넣어서 남측 인도·지반이 통째로 없었고,
    #    건물이 허공에 선 판으로 보였다(디렉터 지적 "지반이 없어 둥둥 떠 있다").
    swalk = B("swalk_s", mat("SW_PAVER_S", (0.700, 0.695, 0.675), roughness=0.85))
    scurb = B("curb_s", mat("SW_CURB_S", (0.615, 0.610, 0.595), roughness=0.8))
    _pavement_south(swalk, scurb)

    total = 0
    for b in (*wall, slab, glass, base, para, roof, ac, swalk, scurb, *sign):
        ob = b.build(coll)
        if ob:
            ob.parent = None
            ob.location = (0.0, 0.0, 0.0)
            ob.rotation_euler = (0.0, 0.0, 0.0)
            ob.scale = (1.0, 1.0, 1.0)
            total += len(ob.data.polygons)
    hidden = _hide_old()
    sig = signals()
    print(f"[hq_street] 건물 {n}동 · 면 {total:,}개 · 옛 매스 {hidden}개 숨김 · 신호등 {sig}기")


def _block(wall, slab, glass, base, para, roof, ac, signs,
           x0, x1, y_front, sgn, floors, i):
    """건물 한 동. 저층부 → 기준층 → 옥탑 순으로 쌓는다."""
    y_back = y_front + sgn * DEPTH
    ya, yb = min(y_front, y_back), max(y_front, y_back)
    top = BASE_H + floors * FLOOR_H

    # ── 저층부: 상가. 유리 파사드 + 간판 띠. 기준층과 성격이 달라야 가로가 산다
    fx = y_front + sgn * 0.02
    base.box(x0, ya, 0.0, x1, yb, BASE_H)
    # 유리는 **칸으로 나눈다.** 한 동을 통으로 이으면 지면 위 3 m 짜리 하늘색 띠가
    # 가로 끝까지 흘러 상가가 아니라 색 줄로 보인다(실측: 원경 x6).
    # 실사 상가도 점포마다 기둥으로 끊긴다.
    bays = max(2, int((x1 - x0) / 4.2))
    bw = (x1 - x0 - 0.6) / bays
    for k in range(bays):
        bx = x0 + 0.30 + k * bw
        _face(glass, bx + 0.34, bx + bw - 0.34, 0.35, BASE_H - 1.05, fx, sgn, 0.10)
        # 간판도 **점포마다** 따로다. 동 전체를 한 색으로 두면 20 m 짜리 색 줄이 된다 —
        # 실사 가로에서 리듬을 만드는 건 이 색이 짧게 자주 바뀌는 것이다.
        _face(signs[(i * 2 + k) % len(signs)], bx + 0.10, bx + bw - 0.10,
              BASE_H - 0.95, BASE_H - 0.20, fx, sgn, 0.16)

    # ── 기준층: 층마다 슬래브 띠 + 창 분할
    wall.box(x0, ya, BASE_H, x1, yb, top)
    cols = max(2, int((x1 - x0) / 2.6))
    side = max(2, int(DEPTH / 2.8))
    for f in range(floors):
        z0 = BASE_H + f * FLOOR_H
        # 띠는 **둘레를 돈다.** 앞면에만 두면 가로 축으로 볼 때 측면이 화면을 채우는데
        # 거기엔 아무 이음매도 없어서 건물이 통짜 회색 덩어리로 보인다 —
        # 실제로 그렇게 나왔다(원경 xa·xc). 층이 어디서 보든 읽혀야 한다.
        slab.box(x0 - 0.09, ya - 0.09, z0, x1 + 0.09, yb + 0.09, z0 + SLAB_T)
        for c in range(cols):                                   # 앞면 창
            w = (x1 - x0 - 0.5) / cols
            cx = x0 + 0.25 + c * w
            _face(glass, cx + 0.16, cx + w - 0.16, z0 + 0.85, z0 + FLOOR_H - 0.45,
                  fx, sgn, 0.07)
        for e, ex in ((-1, x0), (+1, x1)):                      # 측면 창
            for c in range(side):
                d = (DEPTH - 1.2) / side
                cy = min(ya, yb) + 0.6 + c * d
                gx0, gx1 = sorted((ex, ex + e * 0.07))
                glass.box(gx0, cy + 0.20, z0 + 0.85, gx1, cy + d - 0.20,
                          z0 + FLOOR_H - 0.45)

    # ── 옥탑: 파라펫 + 계단실 + 물탱크/실외기. 스카이라인을 끊는 것이 이 셋이다
    slab.box(x0 - 0.09, ya - 0.09, top - SLAB_T, x1 + 0.09, yb + 0.09, top)
    for a, b, c, d in ((x0, ya, x1, ya + 0.22), (x0, yb - 0.22, x1, yb),
                       (x0, ya, x0 + 0.22, yb), (x1 - 0.22, ya, x1, yb)):
        para.box(a, b, top, c, d, top + PARAPET_H)
    hx = x0 + (x1 - x0) * 0.62
    roof.box(hx - 1.3, ya + 2.2, top, hx + 1.3, ya + 5.0, top + 2.6)     # 계단실
    for k in range(3):
        ax = x0 + 1.0 + k * 1.5
        if ax + 0.9 < x1:
            ac.box(ax, ya + 1.0, top, ax + 0.9, ya + 1.7, top + 0.75)


def _face(b, x0, x1, z0, z1, fx, sgn, out):
    """앞면에 붙는 판. `out` 만큼 돌출한다 — 벽과 같은 평면에 두면 깊이가 흔들린다."""
    n0, n1 = fx, fx + sgn * out
    b.box(x0, min(n0, n1), z0, x1, max(n0, n1), z1)


def _pavement_south(walk, curb):
    """남측 인도 · 연석 · **건물이 딛는 지반**.

    처음에는 인도(y 12.6~16)만 깔았다. 건물은 y 12.6 에서 1.6 까지 뒤로 뻗는데
    그 밑에 아무것도 없어서, 조금만 비스듬히 봐도 건물이 허공에 뜬 판으로 보였다.
    지반을 건물 뒤까지 이어 깐다.
    """
    walk.box(X0, WALK_S[0], -0.15, X1, WALK_S[1], -0.01)
    curb.box(X0, WALK_S[1] - 0.16, -0.02, X1, WALK_S[1], 0.14)
    # 건물 발치 지반 — 안길이보다 넉넉히 뒤까지
    walk.box(X0 - 2.0, BLD_S_Y - DEPTH - 3.0, -0.16, X1 + 2.0, WALK_S[0] + 0.02, -0.02)
    # 이면도로가 남쪽으로 이어지는 노면
    walk.box(SIDE_ROAD[0], BLD_S_Y - DEPTH - 3.0, -0.14, SIDE_ROAD[1], ROAD[0], -0.01)


# 옛 신호등 한 기(`Z1_TL_*`)와 머리 없는 기둥(`Z1_OBJ02_signal`)도 같이 뺀다 —
# 새 보행등이 그 자리를 대신한다. 남겨 두면 같은 자리에 등이 두 벌 선다.
OLD = ("Z1_bld_mass_W", "Z1_bld_mass_E",
       "Z1_TL_pole", "Z1_TL_head", "Z1_TL_red", "Z1_TL_grn", "Z1_TL_count",
       "Z1_OBJ02_signal")


def _hide_old():
    """옛 상자 매스는 익스포트에서 뺀다. 그레이박스라 지우면 못 되살린다.
    창(`Z1_bld_win*`)·차양(`Z1_bld_can_*`)은 그 앞면에 붙어 있었으므로 같이 뺀다."""
    n = 0
    for o in bpy.data.objects:
        if o.name in OLD or o.name.startswith(("Z1_bld_win", "Z1_bld_can_")):
            if not o.hide_render:
                n += 1
            o.hide_render = True
            o.hide_viewport = True
    return n


# ── 보행신호등 ───────────────────────────────────────────────────
# 횡단보도는 x −31~−23 · y 23.9~31.1 (`world.ts` CROSSWALK).
#
# ⚠ **건너는 방향은 x 다.** 이면도로가 x −31~−23 폭으로 남북으로 흐르고,
#   보행자는 그 8 m 를 동서로 통과한다(`Z1-SIDEROAD-S/N` 이 y 22~23.9 · 31.1~34 를
#   막아 통행을 y 23.9~31.1 안으로 가둔다). 처음에 이걸 y 방향 횡단으로 잘못 읽어
#   신호등을 남·북단에 세우고 등면을 ±y 로 돌렸다 — 90° 틀린 것이라 걷는 사람에게는
#   등이 옆을 보고 있었다.
#
#   서단 등은 **동쪽에서 오는 사람**이 보므로 등면이 +x, 동단 등은 −x 다.
CROSS = (-31.0, 23.9, -23.0, 31.1)
POLE_R = 0.075
HEAD_W, HEAD_H, HEAD_D = 0.42, 0.86, 0.26      # 폭 · 높이 · 두께(등면 300 mm 기준)
LENS = 0.15                                     # 등면 반지름
EYE_Z = 2.55                                    # 등 하단 높이
WALK_MID = (CROSS[1] + CROSS[3]) / 2


def signals():
    m_pole = mat("TL_POLE", (0.30, 0.31, 0.33), metallic=0.45, roughness=0.4)
    m_case = mat("TL_CASE", (0.10, 0.11, 0.12), roughness=0.55)
    m_red = mat("TL_RED", (0.45, 0.06, 0.07), emit=(0.90, 0.11, 0.12), strength=3.0)
    m_grn = mat("TL_GRN", (0.05, 0.40, 0.16), emit=(0.10, 0.85, 0.32), strength=3.0)
    m_cnt = mat("TL_COUNT", (0.55, 0.14, 0.03), emit=(1.00, 0.42, 0.06), strength=2.6)

    coll = zone_collection("Z1_GROUND")
    pole = Batch("Z1_hq_tlpole", m_pole)
    case = Batch("Z1_hq_tlcase", m_case)

    made = 0
    for k, (px, py, face) in enumerate((
            (CROSS[0] - 0.70, WALK_MID - 2.2, +1),      # 서단 — 등면 +x
            (CROSS[2] + 0.70, WALK_MID + 2.2, -1))):    # 동단 — 등면 −x
        _ped_signal(pole, case, m_red, m_grn, m_cnt, coll, k, px, py, face)
        made += 1
    _car_signal(pole, case, m_red, m_grn, coll)
    made += 1

    for b in (pole, case):
        _zero(b.build(coll))
    return made


def _zero(ob):
    """정점을 월드로 쌓았으니 오브젝트 변환은 항등이어야 한다."""
    if ob is None:
        return
    ob.parent = None
    ob.location = (0.0, 0.0, 0.0)
    ob.rotation_euler = (0.0, 0.0, 0.0)
    ob.scale = (1.0, 1.0, 1.0)


def _lens(name, coll, material, cx, cy, cz, face, r=LENS):
    """등면 원판 — **x 를 향한다.** 동적 재질은 오브젝트마다 따로 있어야
    게임이 등을 개별로 켠다(`station.ts` 가 머티리얼 이름으로 노드를 모은다)."""
    b = Batch(name, material)
    seg = 18
    n0 = len(b.verts)
    b.verts.append((cx + face * 0.006, cy, cz))
    for i in range(seg):
        a = 2 * math.pi * i / seg
        b.verts.append((cx + face * 0.006, cy + r * math.cos(a), cz + r * math.sin(a)))
    for i in range(seg):
        j, k = n0 + 1 + i, n0 + 1 + (i + 1) % seg
        # 감김 검증: 평면 x=const 에서 (중심, i, i+1) 삼각형의 법선은
        # (P1−P0)×(P2−P0) = (sin(a₂−a₁), 0, 0)·r² 이므로 **(n0, j, k) 가 +x** 다.
        # 처음에 이걸 뒤집어 놔서 등면이 전부 반대를 보고 있었다
        # (실측: face=+1 인 서단 등의 법선이 −1.00).
        b.faces.append((n0, j, k) if face > 0 else (n0, k, j))
    _zero(b.build(coll))


def _ped_signal(pole, case, m_red, m_grn, m_cnt, coll, k, px, py, face):
    """보행신호등 한 기. 기둥 · 케이스 · 세로 2등 · 차양 · 잔여시간 막대.
    케이스는 y 로 넓고 **x 로 얇다** — 통행 축이 x 이므로 등면이 x 를 향해야 한다."""
    top = EYE_Z + HEAD_H + 0.30
    pole.tube("z", 0.0, top, px, py, POLE_R, seg=12)
    pole.box(px - 0.16, py - 0.16, 0.0, px + 0.16, py + 0.16, 0.18)     # 베이스 플레이트

    cx = px + face * (POLE_R + HEAD_D / 2)
    case.box(cx - HEAD_D / 2, py - HEAD_W / 2, EYE_Z,
             cx + HEAD_D / 2, py + HEAD_W / 2, EYE_Z + HEAD_H)
    # 차양 — 실사 보행등은 등마다 얕은 챙이 있다. 없으면 검은 판에 원 두 개다
    for z in (EYE_Z + HEAD_H - 0.02, EYE_Z + HEAD_H / 2 - 0.02):
        a, b2 = sorted((cx - face * HEAD_D / 2, cx + face * (HEAD_D / 2 + 0.11)))
        case.box(a, py - HEAD_W / 2 - 0.03, z, b2, py + HEAD_W / 2 + 0.03, z + 0.045)

    fx = cx + face * HEAD_D / 2
    _lens(f"Z1_tl{k}_grn", coll, m_grn, fx, py, EYE_Z + HEAD_H * 0.74, face)
    _lens(f"Z1_tl{k}_red", coll, m_red, fx, py, EYE_Z + HEAD_H * 0.26, face)

    # 잔여시간 막대 — 게임이 `scale.y` 로 줄인다(`station.ts`).
    cb = Batch(f"Z1_tl{k}_count", m_cnt)
    a, b2 = sorted((fx + face * 0.004, fx + face * 0.010))
    cb.box(a, py - HEAD_W / 2 + 0.05, EYE_Z - 0.30, b2, py + HEAD_W / 2 - 0.05, EYE_Z - 0.06)
    _zero(cb.build(coll))


def _car_signal(pole, case, m_red, m_grn, coll):
    """차량 신호등 — 차도(y 16~22)는 x 축 도로다. 차가 보게 등면을 −x 로 돌린다.
    기둥은 북측 연석에 서고 암이 차도 위로 뻗는다."""
    px, py = CROSS[2] + 2.6, ROAD[1] + 0.35
    h, arm = 5.4, 3.6
    pole.tube("z", 0.0, h, px, py, 0.10, seg=12)
    pole.box(px - 0.20, py - 0.20, 0.0, px + 0.20, py + 0.20, 0.22)
    pole.box(px - 0.07, py - arm, h - 0.14, px + 0.07, py, h)           # 암
    ay = py - arm + 0.45
    case.box(px - 0.15, ay - 0.62, h - 0.62, px + 0.15, ay + 0.62, h - 0.14)
    a, b2 = sorted((px - 0.15, px - 0.19))
    case.box(a, ay - 0.66, h - 0.20, px + 0.15, ay + 0.66, h - 0.14)    # 챙
    _lens("Z1_tlcar_red", coll, m_red, px - 0.15, ay - 0.40, h - 0.38, -1, r=0.13)
    _lens("Z1_tlcar_grn", coll, m_grn, px - 0.15, ay + 0.40, h - 0.38, -1, r=0.13)


build()
