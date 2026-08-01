"""
홍대입구역 실사 기준 역명 사인.

레퍼런스: 승강장 기둥에 감긴 흰 패널.
  · 초록 원 안에 역번호 **239**
  · 홍대입구 / Hongik Univ. / 弘益大学  ホンデイック  (4개 표기)
  · 하단에 인접역 다이어그램 — 240 신촌 ←—●—→ 238 합정

이게 서울 지하철 승강장에서 가장 먼저 눈에 들어오는 물건인데 우리 맵엔 없었다.
"어느 역인지"와 "어느 방향인지"를 한 판에 말해 주는 유일한 사인이다.

    exec(open(r"C:\\Users\\User\\Documents\\HACKERTON\\tools\\build_station_signs.py").read())
"""

import bpy
import math

COLL = bpy.data.collections["Z5_PLATFORM"]
FONT = bpy.data.fonts["Malgun Gothic Bold"]

STATION_NO = "239"
NAME_KR, NAME_EN = "홍대입구", "Hongik Univ."
NAME_CJ = "弘益大学  ホンデイック"
PREV_NO, PREV_KR, PREV_EN = "240", "신촌", "Sinchon"        # ← 서쪽(진행 반대)
NEXT_NO, NEXT_KR, NEXT_EN = "238", "합정", "Hapjeong"       # → 신도림 방면

COL_Y = 4.0            # 기둥 중심 y
COL_R = 0.55
SIGN_R = COL_R + 0.025 # 기둥 표면에 살짝 띄운다
# 사인을 다는 기둥. 기둥은 x 92~196 에 8 m 간격.
# 처음엔 100·116·132·156·172 였는데 자판기(Z5_prop_red)가 100·116·132·148·164·180·196 의
# **북면**에 붙어 있어 사인 아래 1/3(인접역 다이어그램)을 가렸다.
# 양면이 다 트인 기둥만 남긴 것이 아래 목록이다. 124→156 이 32 m 로 벌어지는 건
# 그 사이 132·148 이 둘 다 자판기라 어쩔 수 없다 — 그 구간은 매달림 사인이 받는다.
SIGN_XS = [92, 108, 124, 156, 172, 188]
PANEL_W, PANEL_H = 1.02, 1.52
PANEL_CZ = -17.85      # 승강장 바닥 −20.00 기준 2.15 m

ARC_SEG = 6            # 곡면 근사 분할 (기둥에 감긴 느낌)
# 인접역 표기의 좌우 오프셋. 곡면이라 투영 반폭은 SIGN_R·sin(호폭/2) ≈ 0.45 뿐이다 —
# 0.30 으로 뒀더니 "Hapjeong"이 초록 띠를 밟고 나갔다.
ADJ_DX = 0.25

# 양면. 처음엔 남쪽(-1) 한 면에만 달았는데 승강장에서 아무것도 안 보인다는 지적을 받았다.
# 승강장은 y 0~12, 스크린도어가 y 12(북쪽)다. 기둥이 y 4.0 이므로
# **주 통행·대기 구역은 기둥 북쪽 폭 6.5 m** 이고 남쪽은 폭 3.45 m 뒷골목이다.
# 남쪽 면에만 달면 사람이 안 다니는 쪽을 보고 있다.
#
# 좌우가 뒤집힌다고 걱정했는데 그건 틀린 판단이었다. 글자를 **물리 좌표**에 놓으면
# 서쪽(신촌)은 어느 면에서 보든 서쪽이다 — 관측자 기준 좌우는 저절로 맞는다.
# 면마다 뒤집어야 하는 건 (1) 면 법선 (2) 글자 회전뿐이다.
SIDES = ((-1, "S"), (1, "N"))


def _mesh(name, verts, faces, matname, coll=COLL):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    me.materials.append(bpy.data.materials[matname])
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def arc_panel(name, cx, r, z0, z1, a0, a1, matname, side):
    """기둥에 감긴 곡면 패널. a0~a1 은 라디안, 0 = 그 면의 정면.

    side = -1 남쪽 면(법선 −y) · +1 북쪽 면(법선 +y).
    x·y 를 동시에 side 배로 놓으면 면이 기둥 반대쪽으로 가면서 **감김 방향도 같이
    뒤집혀** 법선이 바깥을 향한다. 게임은 FrontSide 컬링이라 이게 틀리면 사인이 사라진다.
    """
    verts, faces = [], []
    for i in range(ARC_SEG + 1):
        a = a0 + (a1 - a0) * i / ARC_SEG
        x = cx + side * r * math.sin(a)
        y = COL_Y + side * r * math.cos(a)
        verts += [(x, y, z0), (x, y, z1)]
    for i in range(ARC_SEG):
        n = i * 2
        faces.append((n, n + 1, n + 3, n + 2))
    return _mesh(name, verts, faces, matname)


def flat(name, quads, matname):
    """면 앞에 띄운 평면들. (x0, z0, x1, z1, dy, side)"""
    verts, faces = [], []
    for (x0, z0, x1, z1, dy, side) in quads:
        n = len(verts)
        y = COL_Y + side * (SIGN_R + dy)
        # x 를 side 배로 뒤집어 감김 방향까지 같이 뒤집는다 (arc_panel 과 같은 이유)
        a, b = (x0, x1) if side < 0 else (x1, x0)
        verts += [(a, y, z0), (b, y, z0), (b, y, z1), (a, y, z1)]
        faces.append((n, n + 1, n + 2, n + 3))
    return _mesh(name, verts, faces, matname)


def arc_y(dx, dy, side):
    """중심에서 dx 만큼 벗어난 지점의 곡면 y. 평면처럼 고정 y 를 쓰면
    좌우 끝 글자가 패널에서 10cm쯤 떠 버린다."""
    k = max(0.0, SIGN_R * SIGN_R - dx * dx) ** 0.5
    return COL_Y + side * (k + dy)


def disc(cx, cz, r, dy, side, dx=0.0, seg=20):
    """정면을 향한 원판 (초록 역번호 배지)."""
    verts, faces = [], []
    y = arc_y(dx, dy, side)
    verts.append((cx, y, cz))
    for i in range(seg):
        a = 2 * math.pi * i / seg
        verts.append((cx + r * math.cos(a), y, cz + r * math.sin(a)))
    for i in range(seg):
        j, k = 1 + i, 1 + (i + 1) % seg
        faces.append((0, j, k) if side < 0 else (0, k, j))
    return verts, faces


_TEXT_MESH = {}


def _text_mesh(body, size, matname):
    """같은 글자·크기·머티리얼이면 **메시 데이터를 공유**한다.

    사인 12개(6기둥 × 양면)에 적힌 글자는 전부 같은 내용이다. 폰트 오브젝트를
    그대로 두면 익스포터가 12벌을 따로 굽는다 — 양면으로 바꾼 순간 Z5 가
    2,658 → 3,374 KB 로 뛰었다. 메시를 공유하면 glTF 에 한 벌만 실린다.
    (로더는 어차피 머티리얼별로 병합하므로 런타임 삼각형 수는 그대로다.)
    """
    key = (body, round(size, 4), matname)
    me = _TEXT_MESH.get(key)
    if me is not None:
        return me
    cu = bpy.data.curves.new("_txt_tmp", type="FONT")
    cu.body, cu.font, cu.size = body, FONT, size
    cu.align_x = cu.align_y = "CENTER"
    cu.extrude = 0.002
    cu.resolution_u = 1          # 글리프 분할이 glTF 용량을 지배한다
    cu.materials.append(bpy.data.materials[matname])
    tmp = bpy.data.objects.new("_txt_tmp", cu)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    me.name = f"TXTM_{matname}_{abs(hash(key)) % 10**8}"
    bpy.data.objects.remove(tmp, do_unlink=True)
    bpy.data.curves.remove(cu)
    _TEXT_MESH[key] = me
    return me


def text(name, body, x, z, size, matname, dy, side, dx=0.0):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    me = _text_mesh(body, size, matname)
    ob = bpy.data.objects.new(name, me)
    # 글자는 평면이고 패널은 곡면이다. 글자 **중심**의 곡면 y 로 띄우면
    # 안쪽(기둥 중앙 쪽) 절반이 패널 속으로 잠긴다 — 실제로 '합정'의 '정',
    # 'Sinchon'의 'S'가 잘려 나갔다. 글자가 덮는 구간에서 패널이 가장 앞으로
    # 나온 지점(= 중앙에 가장 가까운 x)을 기준으로 띄운다.
    hw = max((abs(v.co.x) for v in me.vertices), default=0.0)
    ob.location = (x, arc_y(max(0.0, abs(dx) - hw), dy, side), z)
    # 북쪽 면은 z 로 180° 돌린다. 글자는 가운데 정렬이라 위치는 그대로 —
    # 그래서 신촌(서, −x)·합정(동, +x)의 물리 위치를 건드릴 필요가 없다.
    ob.rotation_euler = (math.pi / 2, 0.0, 0.0 if side < 0 else math.pi)
    COLL.objects.link(ob)
    return ob


def main():
    # 한 면짜리 옛 이름(Z5_stsign0_kr …)이 남아 있으면 새 이름과 겹쳐 보인다.
    for ob in [o for o in bpy.data.objects if o.name.startswith("Z5_stsign")]:
        bpy.data.objects.remove(ob, do_unlink=True)
    # 공유 글자 메시는 오브젝트를 지워도 남는다 — 재실행할 때마다 쌓이지 않게 치운다.
    _TEXT_MESH.clear()
    for me in [m for m in bpy.data.meshes if m.name.startswith("TXTM_") and m.users == 0]:
        bpy.data.meshes.remove(me)

    top, bot = PANEL_CZ + PANEL_H / 2, PANEL_CZ - PANEL_H / 2
    # 패널 각도 폭 — 호 길이가 PANEL_W 가 되게
    span = PANEL_W / SIGN_R
    plates, discs_v, discs_f = [], [], []

    def add_disc(cx, cz, r, dy, side, dx=0.0, seg=20):
        nonlocal discs_v, discs_f
        v, f = disc(cx, cz, r, dy, side, dx, seg)
        n0 = len(discs_v)
        discs_v += v
        discs_f += [(a + n0, b + n0, c + n0) for (a, b, c) in f]

    for k, cx in enumerate(SIGN_XS):
        for side, sfx in SIDES:
            tag = f"Z5_stsign{k}{sfx}"
            arc_panel(f"{tag}_plate", cx, SIGN_R, bot, top,
                      -span / 2, span / 2, "SIGN_PLATE", side)
            # 좌우 초록 띠 (2호선 색).
            # a0 < a1 을 지켜야 한다 — 각도가 줄어드는 방향으로 주면 감김이 뒤집혀
            # 법선이 기둥 속을 향하고, FrontSide 컬링에 한쪽 띠만 사라진다.
            # 실제로 한쪽 띠가 계속 안 보였다.
            for s in (-1, 1):
                a = s * span / 2
                b = s * (span / 2 - 0.10)
                arc_panel(f"{tag}_edge{s}", cx, SIGN_R + 0.004, bot, top,
                          min(a, b), max(a, b), "LINE2_GRN", side)
            # 역번호 배지
            add_disc(cx, PANEL_CZ + 0.50, 0.165, 0.012, side)
            # 인접역 작은 배지
            for s in (-1, 1):
                add_disc(cx + s * ADJ_DX, PANEL_CZ - 0.40, 0.060, 0.014, side, seg=14)
            # 다이어그램 선
            plates.append((cx - 0.17, PANEL_CZ - 0.404, cx + 0.17, PANEL_CZ - 0.396, 0.011, side))

            text(f"{tag}_no", STATION_NO, cx, PANEL_CZ + 0.50, 0.155, "TXT_WHITE", 0.020, side)
            text(f"{tag}_kr", NAME_KR, cx, PANEL_CZ + 0.16, 0.200, "TXT_DARK", 0.014, side)
            text(f"{tag}_en", NAME_EN, cx, PANEL_CZ - 0.03, 0.105, "TXT_DARK", 0.014, side)
            text(f"{tag}_cj", NAME_CJ, cx, PANEL_CZ - 0.17, 0.072, "TXT_DARK", 0.014, side)
            # 신촌은 서(−x), 합정은 동(+x). 물리 좌표라 면을 바꿔도 그대로 둔다.
            for s, no, kr, en in ((-1, PREV_NO, PREV_KR, PREV_EN),
                                  (1, NEXT_NO, NEXT_KR, NEXT_EN)):
                a = "p" if s < 0 else "n"
                dx = s * ADJ_DX
                text(f"{tag}_{a}no", no, cx + dx, PANEL_CZ - 0.40, 0.055, "TXT_WHITE", 0.022, side, dx)
                text(f"{tag}_{a}kr", kr, cx + dx, PANEL_CZ - 0.56, 0.082, "TXT_DARK", 0.016, side, dx)
                text(f"{tag}_{a}en", en, cx + dx, PANEL_CZ - 0.66, 0.042, "TXT_DARK", 0.016, side, dx)

    flat("Z5_stsign_line", plates, "TXT_DARK")
    _mesh("Z5_stsign_badge", discs_v, discs_f, "LINE2_GRN")
    print(f"역명 기둥 사인 {len(SIGN_XS)}개 × 양면 — x={SIGN_XS}")
    print(f"  {STATION_NO} · {NAME_KR} / {NAME_EN} / {NAME_CJ}")
    print(f"  {PREV_NO} {PREV_KR} ←— ● —→ {NEXT_NO} {NEXT_KR}")


main()


# ─────────────────── 출입구 사인 (레퍼런스 2번째 사진) ───────────────────
# 홍대입구는 2호선 · 공항철도 · 경의중앙선이 만나는 3개 노선 환승역이다.
# 출입구 사인에는 그 배지 3개와 4개 표기, 그리고 출구 번호가 함께 붙는다.

ENTR_X = -1.095        # 흰 판(Z1_entr_signplate) 앞면
ENTR_CY = 27.72
LINES = [("2", (0.00, 0.66, 0.30, 1.0)),        # 2호선 초록
         ("A", (0.10, 0.30, 0.62, 1.0)),        # 공항철도 남색
         ("K", (0.00, 0.51, 0.53, 1.0))]        # 경의중앙선 청록
EXIT_NO = "1"


def entrance_sign():
    Z1 = bpy.data.collections["Z1_GROUND"]

    def mat(n, rgba):
        m = bpy.data.materials.get(n)
        if m is None:
            m = bpy.data.materials.new(n)
            m.use_nodes = True
            b = m.node_tree.nodes.get("Principled BSDF")
            if b:
                b.inputs["Base Color"].default_value = rgba
        m.diffuse_color = rgba
        return m

    def plate(name, boxes, matname):
        old = bpy.data.objects.get(name)
        if old:
            bpy.data.objects.remove(old, do_unlink=True)
        verts, faces = [], []
        for (y0, z0, y1, z1, dx) in boxes:
            n = len(verts)
            x = ENTR_X - dx
            verts += [(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)]
            faces.append((n + 3, n + 2, n + 1, n))     # 법선 −x (서쪽 관측자)
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts, [], faces)
        me.validate()
        me.update()
        me.materials.append(bpy.data.materials[matname])
        for p in me.polygons:
            p.use_smooth = False
        ob = bpy.data.objects.new(name, me)
        Z1.objects.link(ob)
        return ob

    def etext(name, body, cy, z, size, matname, dx=0.010):
        old = bpy.data.objects.get(name)
        if old:
            bpy.data.objects.remove(old, do_unlink=True)
        cu = bpy.data.curves.new(name, type="FONT")
        cu.body, cu.font, cu.size = body, FONT, size
        cu.align_x = cu.align_y = "CENTER"
        cu.extrude = 0.002
        cu.resolution_u = 1
        cu.materials.append(bpy.data.materials[matname])
        ob = bpy.data.objects.new(name, cu)
        ob.location = (ENTR_X - dx, cy, z)
        ob.rotation_euler = (math.pi / 2, 0.0, -math.pi / 2)   # −X(서쪽)를 향한다
        Z1.objects.link(ob)
        return ob

    # 4개 표기 — 기존 한/영에 한자·가나를 더한다
    etext("Z1_entr_name_kr", NAME_KR, ENTR_CY, 3.20, 0.255, "TXT_DARK")
    etext("Z1_entr_name_en", NAME_EN, ENTR_CY, 3.015, 0.098, "TXT_DARK")
    etext("Z1_entr_name_cj", NAME_CJ, ENTR_CY, 2.895, 0.068, "TXT_DARK")

    # 노선 배지 3종.
    # 관측자는 −x 에서 +x 를 본다 → 그 사람의 **왼쪽이 y가 큰 쪽**이다.
    # 처음에 y 작은 쪽에 뒀다가 배지가 오른쪽으로 가고 기존 노선 원과 겹쳤다.
    old = bpy.data.objects.get("Z1_entr_linebadge")     # 2호선 원 하나뿐이던 것 → 배지 3종으로 대체
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    for i, (label, rgba) in enumerate(LINES):
        m = mat(f"LINE_BADGE_{label}", rgba)
        cy = 29.16 - i * 0.30
        plate(f"Z1_entr_badge_{label}", [(cy - 0.115, 2.94, cy + 0.115, 3.17, 0.006)], m.name)
        etext(f"Z1_entr_badge_txt_{label}", label, cy, 3.055, 0.115, "TXT_WHITE", 0.014)

    # 출구 번호 (판 오른쪽)
    # 출구 번호는 관측자 오른쪽 = y 작은 쪽
    plate("Z1_entr_exitbox", [(26.26, 2.90, 26.58, 3.24, 0.006)], "SIGN_DARK")
    etext("Z1_entr_exitno", EXIT_NO, 26.42, 3.07, 0.185, "TXT_WHITE", 0.014)
    print(f"출입구 사인 — 4개 표기 · 노선 배지 {len(LINES)}종 · 출구 {EXIT_NO}")


entrance_sign()
