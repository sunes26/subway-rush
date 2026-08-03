"""패스 E — 개찰구 존.

진단에서 Z3가 최악이었다. 오브젝트 171개에 면이 4,780개 — 존 하나가
승강장 기둥 하나보다 단순하다. 개찰기 한 대가 상자 다섯 개(본체·상판·플랩·리더·패널)로
끝나서, 가까이 서면 회색 궤짝이 줄지어 있는 것으로 보인다.

실물 개찰기에서 형태를 만드는 것은 이 여섯이다.

  둥근 상판 · 경사진 태그 패드 · 잔액 LCD · 진행 표시 LED 화살표
  · 반투명 플랩 두 장 · 측면 스테인리스 리빌

거기에 존 전체가 비어 있던 것 둘을 채운다 — **매달림 방향 사인**과 **역 구내 안내도**.
레퍼런스(스크린샷 6·7)에서 개찰구 상부는 검은 사인판이 두세 장씩 붙어 있고,
그게 그 공간의 성격을 만든다.

부수로 고친 것: 게이트 상부 사인 9개가 전부 빨강 X였다. 실제로 그러면 역이 닫힌 것이다.
"""

from __future__ import annotations

import math
import os
import re
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))
                if "__file__" in dir() else r"C:\Users\User\Documents\HACKERTON\tools")
import hq_lib                                    # noqa: E402
import importlib                                 # noqa: E402
importlib.reload(hq_lib)
from hq_lib import Batch, frange, mat, zone_collection   # noqa: E402

FLOOR = -6.00
CEIL = -2.80
CLOSED_GATES = ("G5",)          # 실제 역도 한두 대는 닫혀 있다


def units():
    """개찰기 본체를 실측해 (이름, x0, y0, x1, y1, 윗면 z) 로 돌려준다."""
    out = []
    for o in bpy.data.objects:
        m = re.match(r"Z3_GATE_(G\d+)_([NS])_body$", o.name)
        if not m or o.type != "MESH":
            continue
        cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
        out.append((m.group(1), m.group(2),
                    min(c.x for c in cs), min(c.y for c in cs),
                    max(c.x for c in cs), max(c.y for c in cs),
                    max(c.z for c in cs)))
    return sorted(out, key=lambda r: (r[0], r[1]))


def build():
    m_shell = mat("HQ_GATE_SHELL", (0.83, 0.845, 0.855), metallic=0.20, roughness=0.35)
    m_steel = mat("HQ_GATE_STEEL", (0.62, 0.64, 0.66), metallic=0.55, roughness=0.28)
    m_dark = mat("HQ_GATE_DARK", (0.12, 0.13, 0.14), roughness=0.6)
    m_pad = mat("HQ_GATE_PAD", (0.10, 0.24, 0.62),
                emit=(0.20, 0.55, 1.00), strength=3.0)
    m_lcd = mat("HQ_GATE_LCD", (0.06, 0.12, 0.10),
                emit=(0.35, 0.95, 0.75), strength=2.2)
    m_go = mat("HQ_GATE_GO", (0.05, 0.42, 0.18), emit=(0.10, 0.95, 0.35), strength=2.6)
    m_no = mat("HQ_GATE_NO", (0.42, 0.05, 0.05), emit=(1.00, 0.14, 0.10), strength=2.6)
    m_flap = mat("HQ_GATE_FLAP", (0.68, 0.82, 0.88), roughness=0.2)
    m_signbody = mat("HQ_SIGN_BODY", (0.055, 0.06, 0.07), roughness=0.55)
    m_signwhite = mat("HQ_SIGN_WHITE", (0.95, 0.95, 0.93),
                      emit=(0.9, 0.9, 0.88), strength=0.8)
    m_signgrn = mat("HQ_SIGN_GRN", (0.10, 0.72, 0.36), emit=(0.12, 0.85, 0.42),
                    strength=1.0)
    m_signyel = mat("HQ_SIGN_YEL", (0.96, 0.80, 0.12), emit=(1.0, 0.84, 0.14),
                    strength=1.0)
    m_mapface = mat("HQ_MAP_FACE", (0.94, 0.94, 0.91), emit=(0.9, 0.9, 0.87),
                    strength=0.9)

    coll = zone_collection("Z3_GATES")
    shell = Batch("Z3_hq_gateshell", m_shell)
    steel = Batch("Z3_hq_gatesteel", m_steel)
    dark = Batch("Z3_hq_gatedark", m_dark)
    pad = Batch("Z3_hq_gatepad", m_pad)
    lcd = Batch("Z3_hq_gatelcd", m_lcd)
    go = Batch("Z3_hq_gatego", m_go)
    no = Batch("Z3_hq_gateno", m_no)
    sb = Batch("Z3_hq_signbody", m_signbody)
    sw = Batch("Z3_hq_signwhite", m_signwhite)
    sg = Batch("Z3_hq_signgrn", m_signgrn)
    sy = Batch("Z3_hq_signyel", m_signyel)
    mp = Batch("Z3_hq_mapface", m_mapface)

    rows = units()
    for gid, side, x0, y0, x1, y1, ztop in rows:
        closed = gid in CLOSED_GATES
        _gate(shell, steel, dark, pad, lcd, go, no,
              x0, y0, x1, y1, ztop, side, closed)
    print(f"  개찰기 {len(rows)}대")

    # 통로 가장자리에 판을 깔던 예전 장식 플랩. 이제 `door_panels()` 가 진짜 문을
    # 만들므로 남아 있으면 문과 겹친다. 빈 Batch 는 오브젝트를 안 지우니 직접 지운다.
    stale = bpy.data.objects.get("Z3_hq_gateflap")
    if stale is not None:
        bpy.data.objects.remove(stale, do_unlink=True)
        print("  장식 플랩 Z3_hq_gateflap 제거 (문과 중복)")

    glyph = Batch("Z3_hq_headglyph", m_signwhite)
    door_panels()
    _gate_cap(rows)
    _recolor_head_signs()
    _side_leds()
    _hanging(sb, sw, sg, sy)
    _wall_map(sb, mp, sw)

    total = 0
    for b in (shell, steel, dark, pad, lcd, go, no, sb, sw, sg, sy, mp, glyph):
        ob = b.build(coll)
        if ob:
            total += len(ob.data.polygons)
    print(f"[hq_gates] 면 {total:,}개 추가")


def _gate(shell, steel, dark, pad, lcd, go, no,
          x0, y0, x1, y1, ztop, side, closed):
    """개찰기 한 대. 통로는 x 방향, 기계는 y로 얇다."""
    w = y1 - y0
    inner = y0 if side == "N" else y1          # 통로를 향하는 면
    sgn = -1 if side == "N" else +1

    shell.bevel_box(x0, y0, ztop - 0.06, x1, y1, ztop, r=0.028)      # 둥근 상판
    steel.box(x0 - 0.006, y0 - 0.006, FLOOR, x1 + 0.006, y1 + 0.006, FLOOR + 0.09)
    for t in (0.34, 0.66):                                            # 측면 리빌
        z = FLOOR + (ztop - FLOOR) * t
        for y in (y0 - 0.004, y1 - 0.010):
            steel.box(x0 + 0.05, y, z - 0.010, x1 - 0.05, y + 0.014, z + 0.010)
    steel.box(x0 - 0.004, y0, ztop - 0.10, x0 + 0.028, y1, ztop)      # 양 끝 마구리
    steel.box(x1 - 0.028, y0, ztop - 0.10, x1 + 0.004, y1, ztop)

    # 태그 패드 — 경사 하우징 위에 발광 원판
    px = x0 + 0.30
    dark.box(px - 0.13, y0 + 0.03, ztop - 0.005, px + 0.13, y1 - 0.03, ztop + 0.055)
    pad.disc(px, (y0 + y1) / 2, ztop + 0.058, 0.085, seg=18)

    # 잔액 LCD — 통로 반대편을 향해 살짝 눕는다
    lx = x0 + 0.62
    dark.box(lx - 0.16, y0 + 0.04, ztop - 0.005, lx + 0.16, y1 - 0.04, ztop + 0.085)
    lcd.box(lx - 0.13, y0 + 0.06, ztop + 0.086, lx + 0.13, y1 - 0.06, ztop + 0.090)

    # 진행 표시 — 상판에 매입된 화살표(초록) 또는 X(빨강)
    ax = x1 - 0.30
    tgt = no if closed else go
    if closed:
        for d in (-1, 1):
            _bar(tgt, ax, (y0 + y1) / 2, ztop + 0.004, 0.20, 0.030, d * math.pi / 4)
    else:
        _arrow(tgt, ax, (y0 + y1) / 2, ztop + 0.004, 0.22, 0.13)

    # 플랩은 여기서 그리지 않는다 — `door_panels()` 가 **움직이는 문짝**으로 따로 만든다.
    # 예전에는 여기서도 통로 가장자리에 판을 깔았는데, 그 자리에 그레이박스 플랩
    # (`Z3_GATE_G*_[NS]_flap`)이 이미 있어 **같은 자리에 판이 두 겹**이었다.
    # 겹친 두 장은 문으로도 안 읽히고 깊이 판정만 흔든다.
    dark.box(x0 + 0.08, inner + sgn * 0.004, FLOOR + 0.14,
             x1 - 0.08, inner + sgn * 0.016, FLOOR + 0.19)


# ── 움직이는 플랩 문 ─────────────────────────────────────────────
# 애니메이션되는 `Z3_GATE_G\d_[NS]_flap` 18개는 **어떤 패스도 만들지 않았다** —
# 그레이박스 시절 형상이 blend 에만 남아 있었다(신호등과 같은 유형).
#
# 실측하면 판이 x 60.81~61.43 · 두께 0.03 으로 **진행 방향과 나란히** 서 있다.
# 그건 문이 아니라 하우징에 붙어 **접힌 자세**다. 그래서 게임에서 늘 열린 것처럼
# 보였고, 통과 허가가 나면 렌더러가 그걸 바깥으로 0.5 m 더 밀어내
# "열려 있다가 또 열린다"가 됐다. 게다가 충돌(`gateFlaps`)은 닫힘 기준으로 막고 있어
# **보이는 것과 막는 것이 어긋나 있었다.**
#
# 실물 플랩식 개찰기는 문 두 장이 통로를 가로질러 맞물려 있다가 옆으로 눕는다.
# 0.62 짜리 판을 경첩에서 90° 돌리면 통로(0.55)를 넘어 반대쪽 문과 0.69 겹치므로
# 길이부터 다시 잡는다 — **한 장이 통로의 절반**이다.
#
# 회전 피벗은 게임 쪽에서 잡는다. 로더가 월드 트랜스폼을 지오메트리에 굽기 때문에
# (`station.ts` 의 `bakeGeo`) 여기서 원점을 옮겨 봐야 익스포트 뒤에 사라진다.
# 여기서는 **닫힌 자세**만 정확히 만들면 된다.
DOOR_T = 0.032          # 문짝 두께
DOOR_Z0 = 0.20          # 바닥에서 아랫단 — 실물도 발밑이 트여 있다
DOOR_Z1 = 1.02          # 윗단. 충돌 상한 1.15 보다 낮게 둔다
DOOR_GAP = 0.004        # 맞물리는 두 장 사이 틈(장당). 16 mm 로 뒀더니 통로 한가운데
                        # 빛이 새는 세로 줄이 생겼다 — 정면으로 서면 그게 먼저 보인다.
DOOR_AT = 0.60          # 개찰기 x 폭에서 문이 서는 위치(태그 패드·LCD 보다 하류)
DOOR_EDGE = 0.055       # 자유단 기둥 폭
DOOR_ET = 0.052         # 자유단 기둥 두께 — 판보다 굵어야 실루엣이 산다
DOOR_RAIL = 0.070       # 상단 가로대 높이


def door_panels():
    """`Z3_GATE_G{n}_{N|S}_flap` 18개를 **닫힌 문짝**으로 다시 만든다."""
    m_door = mat("HQ_GATE_FLAP", (0.68, 0.82, 0.88), roughness=0.2)
    coll = zone_collection("Z3_GATES")

    by_gate: dict[str, dict[str, tuple]] = {}
    for gid, side, x0, y0, x1, y1, ztop in units():
        by_gate.setdefault(gid, {})[side] = (x0, y0, x1, y1, ztop)

    made = 0
    for gid, sides in sorted(by_gate.items()):
        if "N" not in sides or "S" not in sides:
            print(f"  ! {gid}: 본체가 한 쪽뿐이라 문을 못 만든다")
            continue
        nx0, ny0, nx1, _ny1, _ = sides["N"]
        _sx0, _sy0, _sx1, sy1, _ = sides["S"]
        # 통로는 두 본체의 마주 보는 면 사이. N 이 y 가 큰 쪽이라는 전제를 검사한다 —
        # 이름과 좌표가 어긋나면 문이 하우징 **안쪽**으로 열려 조용히 사라진다.
        if ny0 <= sy1:
            print(f"  ! {gid}: N({ny0:.3f}) 이 S({sy1:.3f}) 보다 남쪽이다 — 건너뛴다")
            continue
        half = (ny0 - sy1) / 2 - DOOR_GAP
        dx = nx0 + (nx1 - nx0) * DOOR_AT

        for side, hinge, toward in (("N", ny0, -1), ("S", sy1, +1)):
            name = f"Z3_GATE_{gid}_{side}_flap"
            b = Batch(name, m_door)
            y_a, y_b = hinge, hinge + toward * half
            y_edge = y_b - toward * DOOR_EDGE
            z0, z1 = FLOOR + DOOR_Z0, FLOOR + DOOR_Z1
            z_rail = z1 - DOOR_RAIL

            # 판·자유단 기둥·상단 가로대를 **겹치지 않게** 나눈다.
            # 처음에는 굵은 상자를 판 위에 덧씌웠는데, 두 상자가 같은 z 를 공유해
            # 윗면·아랫면이 동일평면이 되면서 문이 줄무늬로 나왔다. 맞대기면 뒷면이
            # 컬링되므로 다투지 않는다 — 덧씌우기만 피하면 된다.
            b.box(dx - DOOR_T / 2, y_a, z0, dx + DOOR_T / 2, y_edge, z_rail)
            b.box(dx - DOOR_T / 2, y_a, z_rail, dx + DOOR_T / 2, y_edge, z1)      # 가로대
            b.box(dx - DOOR_ET / 2, y_edge, z0, dx + DOOR_ET / 2, y_b, z1)        # 자유단 기둥

            ob = b.build(coll)
            # `Batch.build` 는 같은 이름이면 메시만 갈아 끼운다. 그레이박스 시절 트랜스폼이
            # 남아 있으면 새 좌표가 그만큼 밀리므로 여기서 항등으로 되돌린다.
            ob.parent = None
            ob.location = (0.0, 0.0, 0.0)
            ob.rotation_euler = (0.0, 0.0, 0.0)
            ob.scale = (1.0, 1.0, 1.0)
            if ob.name not in coll.objects:
                for c in list(ob.users_collection):
                    c.objects.unlink(ob)
                coll.objects.link(ob)
            made += 1

    print(f"  플랩 문 {made}장 — 닫힌 자세 · 한 장이 통로 절반")


def _gate_cap(rows):
    """개찰기 위를 통째로 덮던 검은 판을 대당 몰딩으로 바꾼다.

    그레이박스 시절의 `Z3_gate_cap` 은 **상자 하나**였다 —
    x 60.310…61.690 · y 7.510…24.670 · z −5.140…−4.970, 재질 GATE_TOP (0.16, 0.17, 0.18).
    y 로 17.16 m 를 끊김 없이 지나가므로 개찰기 사이 **통로 위까지 검게 덮는다.**
    게임 화면(`tour/10-z3-gates.png`)에서 개찰구 전체를 가로지르는 검은 띠가 이것이고,
    가까이 서면 회색 하우징 위에 검은 직육면체가 얹힌 것으로 읽힌다.

    레퍼런스의 개찰기는 **밝은 회색 몸통 + 어두운 상판**이다. 어두운 상판은 이미
    `Z3_GATE_G*_[NS]_top`(대당 x 1.37 · y 0.30 · 두께 0.03)이 맡고 있으므로,
    이 오브젝트는 지우는 대신 **상판 밑 그림자 홈**으로 다시 굽는다. 대당으로 끊기니
    통로를 안 덮고, 몸통에 수평선이 하나 생겨 상자 티가 준다.

    지우지 않고 다시 굽는 이유: 이 이름을 참조하는 곳이 있는지 확인했고
    (`game/src` · 다른 패스 전부 없음) 없지만, 오브젝트를 없애는 것보다
    `Batch.build()` 로 메시만 갈아 끼우는 편이 멱등하고 되돌리기 쉽다.
    """
    m_cap = bpy.data.materials.get("GATE_TOP") or mat(
        "HQ_GATE_CAP", (0.16, 0.17, 0.18), roughness=0.45)
    cap = Batch("Z3_gate_cap", m_cap)
    for _gid, _side, x0, y0, x1, y1, ztop in rows:
        # 상판(윗면 ztop+0.005 부근) 바로 아래 22 mm — 베벨 상판보다 살짝 튀어나오게
        cap.box(x0 - 0.008, y0 - 0.008, ztop - 0.030,
                x1 + 0.008, y1 + 0.008, ztop - 0.008)
    ob = cap.build(zone_collection("Z3_GATES"))
    if ob is not None:
        ob.location = (0.0, 0.0, 0.0)
        ob.rotation_euler = (0.0, 0.0, 0.0)
        ob.scale = (1.0, 1.0, 1.0)
    print(f"  게이트 캡 — 통짜 검은 판 1개 → 대당 몰딩 {len(rows)}개")


def _emit(b, axis, a, u, v, pts, flip=False):
    """(u, v) 평면 위의 다각형을 축에 수직인 판으로 놓는다.

    반시계로 감았을 때의 법선은 축마다 부호가 다르다 — z 는 +z, x 는 +x, y 는 −y.
    한 규칙으로 뭉뚱그리면 절반이 안 보인다.
    """
    if axis == "z":
        tri = [(u + p, v + q, a) for p, q in pts]
    elif axis == "x":
        tri = [(a, u + p, v + q) for p, q in pts]
    else:
        tri = [(u + p, a, v + q) for p, q in pts]
    b.quad(list(reversed(tri)) if flip else tri)


def _arrow(b, cx, cy, z, length, half, axis="z", flip=False, turn=0.0):
    """화살표 — 축(axis)에 수직인 판. 상판은 z, 사인판은 x. `turn` 으로 방향을 돌린다."""
    a, u, v = (z, cx, cy) if axis == "z" else (cx, cy, z)
    shaft = [(-length / 2, -half * 0.40), (length * 0.06, -half * 0.40),
             (length * 0.06, half * 0.40), (-length / 2, half * 0.40)]
    head = [(length * 0.02, -half), (length / 2, 0.0), (length * 0.02, half)]
    c, s = math.cos(turn), math.sin(turn)
    rot = lambda pts: [(p * c - q * s, p * s + q * c) for p, q in pts]
    _emit(b, axis, a, u, v, rot(shaft), flip)
    _emit(b, axis, a, u, v, rot(head), flip)


def _bar(b, cx, cy, z, length, half, ang, axis="z", flip=False):
    a, u, v = (z, cx, cy) if axis == "z" else (cx, cy, z)
    c, s = math.cos(ang), math.sin(ang)
    pts = [(-length / 2, -half), (length / 2, -half), (length / 2, half), (-length / 2, half)]
    _emit(b, axis, a, u, v, [(p * c - q * s, p * s + q * c) for p, q in pts], flip)


def _recolor_head_signs():
    """게이트 상부 사인.

    처음엔 아홉 개가 전부 빨강이었다 — 실제로 그러면 역이 닫힌 것이다.
    초록으로 바꾸고 나니 이번엔 **발광 3.0 이 색을 먹어** 민트색 백판 다섯 개가
    천장까지 초록으로 물들였다. 1.1 이 "켜져 있는데 색이 보이는" 지점이다.

    그리고 사인은 바탕만으로는 안 읽힌다. 통행 가능은 흰 화살표, 폐쇄는 흰 X 를 얹는다.
    """
    grn = mat("HQ_HEADSIGN_GO", (0.06, 0.52, 0.23), emit=(0.09, 0.80, 0.33), strength=1.1)
    red = mat("HQ_HEADSIGN_NO", (0.46, 0.05, 0.05), emit=(0.95, 0.12, 0.09), strength=1.1)
    n = 0
    for o in bpy.data.objects:
        m = re.match(r"Z3_sign_(G\d+)_face$", o.name)
        if not m:
            continue
        closed = m.group(1) in CLOSED_GATES
        o.data.materials.clear()
        o.data.materials.append(red if closed else grn)
        n += 1
    # 글리프(↑ / ✕)는 **굽지 않는다.** 게임이 `render/decals.ts` 의
    # `createGateSigns()` 로 게이트 상태(`gates.workingIds`)에 맞춰 직접 그리고,
    # 색도 런타임에 덮어쓴다. 여기서 구우면 그 위에 겹쳐 z-파이팅만 난다.
    # 여기 색은 Blender 렌더·쇼케이스에서만 의미가 있다.
    print(f"  상부 사인 {n}개 (게임은 런타임에 다시 칠한다 · 폐쇄 {CLOSED_GATES})")


def _side_leds():
    """개찰기 측면 LED 18개가 전부 빨강이었다. 통행 가능한 대는 초록이어야 한다."""
    grn = mat("HQ_GATELED_GO", (0.05, 0.40, 0.17), emit=(0.10, 0.90, 0.34), strength=2.0)
    floor = mat("HQ_GATEFLOOR_GO", (0.06, 0.32, 0.15), emit=(0.12, 0.80, 0.32),
                strength=1.4)
    n = 0
    for o in bpy.data.objects:
        m = re.match(r"Z3_GATE_(G\d+)_([NS]_panel|floorlamp)$", o.name)
        if not m or m.group(1) in CLOSED_GATES:
            continue
        o.data.materials.clear()
        o.data.materials.append(floor if o.name.endswith("floorlamp") else grn)
        n += 1
    print(f"  측면 LED · 통로 바닥등 {n}개 초록")


def _hanging(sb, sw, sg, sy):
    """매달림 방향 사인.

    레퍼런스에서 개찰구·계단 앞에는 검은 사인판이 두세 장 이어 붙어 있다.
    Z3에는 한 장도 없었다 — 이게 존이 '창고처럼' 보이던 큰 이유다.
    통로 축이 x이므로 판은 **y로 넓고 x로 얇다.** 반대로 만들면 두께 옆면만 보인다.
    """
    # 하단이 **바닥 위 2.6 m** 여야 한다. 처음엔 z1 = CEIL−0.28, z0 = z1−0.62 로
    # 하단이 2.30 m 였는데, 개찰구를 통과하면 1.4 m 앞에 이 판이 눈높이 바로 위로
    # 걸려 화면 위 절반을 덮었다. 봉이 화면 밖으로 나가 **판만 공중에 뜬 것**으로 읽혔다.
    # (디렉터 제보 "68.0,8.3,−6.0 에서 전광판이 공중에 떠 있다")
    # 보행 통과 높이 기준도 2.5 m 이상이다. 판을 얇게 하고 천장에 바짝 올려 단다.
    z1 = CEIL - 0.08
    z0 = z1 - 0.52
    # 면마다 실제 문안을 넣는다. 처음엔 흰 막대 두 줄로 자리만 잡았는데
    # 가까이서 보면 **뜻이 없는 판**이라 사용자가 "이 패널은 무슨 의미냐"고 물었다.
    # Z2·Z4 사인 뱅크(`hq_signs.py`)는 처음부터 한글이 들어가 있었다 — 여기만 빠져 있었다.
    #   서면(−x, 대합실에서 오는 사람) / 동면(+x, 운임구역에서 나오는 사람)
    for x, faces, words in ((58.6, ("grn", "yel"), ("승강장", "나가는 곳")),
                            (69.4, ("grn", "wht"), ("승강장", "환승"))):
        for cy, wid in ((8.0, 3.0), (16.0, 3.4), (24.0, 3.0)):
            # 판 두께 0.14 — 얇게 두면 글자가 표면에서 1 cm 밖에 안 떠서
            # 폴리곤 오프셋(TXT_WHITE 7)이 판을 이기고 **반대편 문안이 비친다.**
            sb.box(x - 0.070, cy - wid / 2, z0, x + 0.070, cy + wid / 2, z1)
            for s in (-1, 1):                       # 매다는 봉 두 개
                sb.box(x - 0.018, cy + s * wid * 0.33 - 0.018, z1,
                       x + 0.018, cy + s * wid * 0.33 + 0.018, CEIL)
            for sgn, kind, word in ((-1, faces[0], words[0]), (+1, faces[1], words[1])):
                _sign_face(sb, sw, sg, sy, x, sgn, cy, wid, z0, z1, kind)
                _sign_text(x, sgn, cy, wid, (z0 + z1) / 2, word)


def _sign_face(sb, sw, sg, sy, x, sgn, cy, wid, z0, z1, kind):
    """사인 한 면. 픽토그램 · 문안 막대 · 화살표.

    화살표는 **면마다 좌우를 뒤집는다.** 이건 기하가 아니라 의미다 —
    보는 사람 기준의 왼쪽이 면에 따라 월드 −y 이기도 +y 이기도 하다.
    """
    fx = x + sgn * 0.072
    d = 0.014
    body = (fx, fx + sgn * d)
    put = lambda b, p0, p1, q0, q1: b.box(min(body), p0, q0, max(body), p1, q1)
    tint = {"grn": sg, "yel": sy, "wht": sw}[kind]

    # 픽토그램 자리 (사인 안쪽 끝).
    # 흰 면에는 안 그린다 — 흰 바탕에 흰 사각형이라 뜻 없는 판 한 장으로만 보인다.
    if kind != "wht":
        px = cy - sgn * wid * 0.34
        put(tint, px - 0.17, px + 0.17, z0 + 0.09, z1 - 0.09)
    # 화살표 — 진행 방향은 사인 바깥쪽 끝
    ax = cy + sgn * wid * 0.36
    h = (z0 + z1) / 2
    pts = [(ax - sgn * 0.15, h - 0.10), (ax + sgn * 0.04, h - 0.10),
           (ax + sgn * 0.04, h - 0.17), (ax + sgn * 0.19, h),
           (ax + sgn * 0.04, h + 0.17), (ax + sgn * 0.04, h + 0.10),
           (ax - sgn * 0.15, h + 0.10)]
    n0 = fx + sgn * d
    # 감김은 **재서 맞춘다.** x = 상수 평면에서 (y, z) 신발끈 부호가 음수면 법선 −x다.
    # 예전에는 `pts` 가 `sgn` 을 곱해 만들어지는 것에 기대 `reversed()` 를 뺐는데,
    # 그건 화살표 방향이 늘 `sgn` 과 같을 때만 성립한다. 직접 재면 그 가정이 필요 없다.
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1]
               - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    wound = pts if (area > 0) == (sgn > 0) else list(reversed(pts))
    sw.quad([(n0, u, v) for u, v in wound])


def _sign_text(x, sgn, cy, wid, cz, body):
    """매달림 사인의 한글 문안.

    FONT 는 `rotX(90°)` 만 걸면 법선 −y · 읽는 방향 +x 다. 이 판은 x 에 수직이므로
    −x 를 향하는 면은 `rotZ = 3π/2`, +x 면은 `π/2`.
    글자를 **월드 좌표에 놓으면 좌우는 저절로 맞는다** — 면마다 뒤집지 않는다.
    """
    name = f"Z3_hq_signtxt_{int(x * 10)}_{int(cy * 10)}_{'W' if sgn < 0 else 'E'}"
    coll = zone_collection("Z3_GATES")
    o = bpy.data.objects.get(name)
    if o is None or o.type != "FONT":
        cu = bpy.data.curves.new(name, type="FONT")
        o = bpy.data.objects.new(name, cu)
        coll.objects.link(o)
    cu = o.data
    cu.body = body
    cu.font = bpy.data.fonts.get("Malgun Gothic Bold") or cu.font
    cu.size = 0.22
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.extrude = 0.003
    cu.resolution_u = 1            # 한글 글리프 분할이 glTF 용량의 88 % 였다
    cu.materials.clear()
    cu.materials.append(mat("HQ_SIGN_WHITE", (0.95, 0.95, 0.93),
                            emit=(0.9, 0.9, 0.88), strength=0.8))
    o.location = (x + sgn * 0.082, cy + sgn * wid * 0.04, cz)
    o.rotation_euler = (math.pi / 2, 0.0, 3 * math.pi / 2 if sgn < 0 else math.pi / 2)


def _wall_map(sb, mp, sw):
    """역 구내 안내도. 개찰구 밖 벽에 붙는 큰 판이다."""
    for x, y, axis in ((56.10, 6.0, "x"), (56.10, 26.0, "x")):
        sb.box(x - 0.02, y - 1.30, FLOOR + 0.95, x + 0.10, y + 1.30, FLOOR + 2.85)
        mp.box(x + 0.10, y - 1.20, FLOOR + 1.05, x + 0.13, y + 1.20, FLOOR + 2.62)
        sw.box(x + 0.13, y - 1.20, FLOOR + 2.62, x + 0.15, y + 1.20, FLOOR + 2.80)


build()
