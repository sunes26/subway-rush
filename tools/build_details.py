"""
마감 디테일 — 승강장 가장자리 · 승차위치 · 기둥 밴드 · 매달림 광고 · 하강부 조명과 사인.

레퍼런스(TurboSquid 1402902)와 우리 것을 나란히 놓았을 때, 형태가 아니라
**바닥과 가장자리의 정보량**에서 가장 크게 갈렸다.

  레퍼런스 : 승강장 끝단에 어두운 틈 마감, 그 앞에 흰 승차위치 화살표,
             기둥마다 굽도리와 띠, 천장에 광고 모니터가 쌍으로 매달림
  우리     : 노란 점자블록 한 줄이 전부. 나머지는 통짜 회색 타일

바닥은 1인칭 시야의 아래쪽 절반을 늘 차지한다. 거기가 비면 아무리 벽을 채워도
빈 공간으로 읽힌다.

    exec(open(r"C:\\Users\\User\\Documents\\HACKERTON\\tools\\build_details.py").read())
"""

import bpy
import mathutils
from mathutils import Vector

FONT = bpy.data.fonts["Malgun Gothic Bold"]


class Acc:
    """머티리얼별 누산기 — 한 머티리얼 = 한 오브젝트 = (병합 후) 한 드로우 콜."""

    def __init__(self, coll):
        self.coll = coll
        self.d = {}

    def box(self, mat, x0, y0, z0, x1, y1, z1):
        """감김은 전부 **바깥**을 향한다 — 게임이 `FrontSide` 컬링이라 뒤집히면
        바깥 면이 잘리고 반대쪽 안쪽 면이 대신 보인다 (build_ceiling.py `_box` 주석 참고)."""
        v, f = self.d.setdefault(mat, ([], []))
        n = len(v)
        v += [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
              (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        f += [(n + 3, n + 2, n + 1, n), (n + 4, n + 5, n + 6, n + 7),
              (n + 1, n + 5, n + 4, n), (n + 2, n + 6, n + 5, n + 1),
              (n + 3, n + 7, n + 6, n + 2), (n, n + 4, n + 7, n + 3)]

    def quad(self, mat, pts):
        """법선이 +z 가 되도록 반시계로 준 4점 (바닥 마킹용)."""
        v, f = self.d.setdefault(mat, ([], []))
        n = len(v)
        v += list(pts)
        f.append((n, n + 1, n + 2, n + 3))

    def emit(self, prefix):
        for mat, (v, f) in self.d.items():
            name = f"{prefix}_{mat}"
            old = bpy.data.objects.get(name)
            if old:
                bpy.data.objects.remove(old, do_unlink=True)
            if not v:
                continue
            me = bpy.data.meshes.new(name)
            me.from_pydata(v, [], f)
            me.validate()
            me.update()
            me.materials.append(bpy.data.materials[mat])
            for p in me.polygons:
                p.use_smooth = False
            ob = bpy.data.objects.new(name, me)
            bpy.data.collections[self.coll].objects.link(ob)
        return len(self.d)


_TXT = {}


def text(name, body, loc, size, matname, coll, rot=(1.5707963, 0.0, 0.0)):
    """같은 글자는 메시를 공유한다 (§21.4 와 같은 이유 — glTF 용량은 글리프가 지배한다)."""
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    key = (body, round(size, 4), matname)
    me = _TXT.get(key)
    if me is None:
        cu = bpy.data.curves.new("_t", type="FONT")
        cu.body, cu.font, cu.size = body, FONT, size
        cu.align_x = cu.align_y = "CENTER"
        cu.extrude = 0.002
        cu.resolution_u = 1
        cu.materials.append(bpy.data.materials[matname])
        tmp = bpy.data.objects.new("_t", cu)
        bpy.context.scene.collection.objects.link(tmp)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
        me.name = f"DTXT_{abs(hash(key)) % 10 ** 8}"
        bpy.data.objects.remove(tmp, do_unlink=True)
        bpy.data.curves.remove(cu)
        _TXT[key] = me
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.rotation_euler = rot
    bpy.data.collections[coll].objects.link(ob)
    return ob


# ────────────────────────────── Z5 승강장 ──────────────────────────────

PF_Z = -20.00
DOORS = [78 + 16 * k + d for k in range(8) for d in (2, 6, 10, 14)]


def z5_platform_edge(a):
    """끝단 어두운 틈 마감 + 승차위치 화살표.

    실제 승강장은 승강장 슬래브와 안전문 문턱 사이에 **어두운 마감 줄**이 있다.
    그게 없으면 노란 점자블록 바깥이 바닥과 같은 색이라 '끝'이 안 읽힌다.
    """
    a.box("PF_DARKWALL", 78.0, 11.78, PF_Z - 0.02, 206.0, 11.90, PF_Z + 0.004)

    # 승차위치 — 문을 향한 삼각형 2개.
    # 처음엔 갈매기(꺾쇠)로 만들었는데 사각형 네 점을 비틀어 쓰다 보니 화면에서
    # 그냥 **흰 빗금**으로 읽혔다. 방향을 말해야 하는 표시가 방향을 잃으면 의미가 없다.
    # 삼각형은 세 점이라 어떤 각도에서 봐도 꼭짓점이 가리키는 곳이 분명하다.
    z = PF_Z + 0.006
    for cx in DOORS:
        for s in (-1, 1):
            bx = cx + s * 0.58
            v, f = a.d.setdefault("TXT_WHITE", ([], []))
            n = len(v)
            v += [(bx - 0.26, 10.02, z), (bx + 0.26, 10.02, z), (bx, 10.52, z)]
            f.append((n, n + 1, n + 2))

    # 대기선 — 문 양옆에서 뒤로 뻗는 가는 두 줄.
    # 레퍼런스는 연녹색 타원 패드지만 서울 승강장은 줄이다. 실사 쪽을 따른다.
    for cx in DOORS:
        for s in (-1, 1):
            a.box("PSD_GREEN", cx + s * 0.86 - 0.035, 8.55, PF_Z + 0.002,
                  cx + s * 0.86 + 0.035, 9.90, PF_Z + 0.008)
        a.box("PSD_GREEN", cx - 0.90, 8.55, PF_Z + 0.002, cx + 0.90, 8.62, PF_Z + 0.008)


def z5_column_band(a):
    """기둥 띠 — 굽도리 위 허리 높이. 통짜 원기둥이 마디 없이 서 있으면 스케일이 안 읽힌다."""
    shaft = bpy.data.objects["Z5_colr_shaft"]
    xs = sorted({round((shaft.matrix_world @ v.co).x, 2) for v in shaft.data.vertices})
    cl, cur = [], [xs[0]]
    for x in xs[1:]:
        if x - cur[-1] > 1.0:
            cl.append(cur)
            cur = [x]
        else:
            cur.append(x)
    cl.append(cur)
    r = 0.578
    for c in cl:
        cx = (c[0] + c[-1]) / 2
        # 원기둥 근사 12각 링
        import math
        v, f = a.d.setdefault("LINE2_GRN", ([], []))
        n0 = len(v)
        seg = 12
        for i in range(seg):
            ang = 2 * math.pi * i / seg
            px, py = cx + r * math.sin(ang), 4.0 + r * math.cos(ang)
            v += [(px, py, -19.10), (px, py, -18.94)]
        for i in range(seg):
            b0 = n0 + i * 2
            b1 = n0 + ((i + 1) % seg) * 2
            f.append((b0, b0 + 1, b1 + 1, b1))


def z5_hanging_ads(a):
    """천장 매달림 광고 모니터 — 쌍으로, 통로 쪽을 향해 살짝 벌려 단다."""
    for i, cx in enumerate((104.0, 136.0, 168.0, 200.0)):
        for s in (-1, 1):
            y = 6.0 + s * 0.02
            a.box("DUCT", cx - 0.03, y - 0.03, -15.50, cx + 0.03, y + 0.03, -16.15)
            a.box("SIGN_DARK", cx - 0.62, y - 0.05 + s * 0.05, -16.15,
                  cx + 0.62, y + 0.05 + s * 0.05, -16.90)
            mat = ("AD_PANEL", "AD_PANEL2", "AD_PANEL3")[i % 3]
            a.box(mat, cx - 0.55, y + s * 0.10, -16.21, cx + 0.55, y + s * 0.11, -16.84)


# ────────────────────────────── Z2 대합실 ──────────────────────────────

def _col_centers(name):
    """병합된 기둥 메시에서 x·y 각각의 군집을 뽑는다.

    ⚠ 돌려주는 두 목록의 **곱집합을 기둥 자리로 쓰지 말 것.** 기둥이 격자로
    놓여 있지 않으면 없는 자리가 생긴다 (`_col_islands` 주석 참조).
    """
    o = bpy.data.objects[name]
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    xs = sorted({round(p.x, 2) for p in pts})
    ys = sorted({round(p.y, 2) for p in pts})
    def cluster(vals):
        cl, cur = [], [vals[0]]
        for v in vals[1:]:
            if v - cur[-1] > 1.0:
                cl.append(cur)
                cur = [v]
            else:
                cur.append(v)
        cl.append(cur)
        return [(c[0] + c[-1]) / 2 for c in cl]
    return cluster(xs), cluster(ys), (max(xs) - min(xs)), pts


def _col_islands(name):
    """기둥 메시를 연결 요소로 쪼개 **기둥 하나씩** (cx, cy, r) 을 돌려준다.

    `_col_centers` 의 x 군집 × y 군집 **곱집합**을 쓰면 안 된다. Z2 는 기둥이
    (12,10)(12,20)(24,10)(24,20)(26,16)(36,10)(36,20)(48,10)(48,20) 아홉 개인데,
    x 24 와 26 이 0.9 m 밖에 안 떨어져 한 군집(중심 25)으로 뭉치고 y 는 10·16·20
    세 군집이 되어 곱집합이 4×3 = 12 가 된다. 실제로 그렇게 굽혔더니 (12,16)
    (25,10)(25,16)(25,20)(36,16)(48,16) 여섯 개가 **기둥 없는 허공**에 떠 있었고
    (24,10)(24,20)(26,16) 세 기둥에는 띠가 없었다. 곱집합은 격자 배치일 때만 맞다.
    """
    import bmesh
    o = bpy.data.objects[name]
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table()
    seen, out = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for e in cur.link_edges:
                ov = e.other_vert(cur)
                if ov.index not in seen:
                    seen.add(ov.index)
                    stack.append(ov)
        cs = [o.matrix_world @ vv.co for vv in comp]
        x0, x1 = min(c.x for c in cs), max(c.x for c in cs)
        y0, y1 = min(c.y for c in cs), max(c.y for c in cs)
        out.append(((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2))
    bm.free()
    return sorted(out)


def z2_column_bands(a):
    """대합실 기둥 띠. Z5 와 같은 이유 — 통짜 원기둥은 스케일이 안 읽힌다."""
    import math
    made = 0
    for cx, cy, rad in _col_islands("Z2_colr_shaft"):
        r = rad + 0.006                      # 기둥 표면에서 6 mm — z-파이팅 방지
        v, f = a.d.setdefault("LINE2_GRN", ([], []))
        n0 = len(v)
        seg = 12
        for i in range(seg):
            ang = 2 * math.pi * i / seg
            v += [(cx + r * math.sin(ang), cy + r * math.cos(ang), -4.62),
                  (cx + r * math.sin(ang), cy + r * math.cos(ang), -4.46)]
        for i in range(seg):
            b0 = n0 + i * 2
            b1 = n0 + ((i + 1) % seg) * 2
            f.append((b0, b0 + 1, b1 + 1, b1))
        made += 1
    return made


def z2_wall_ads(a):
    """대합실 벽 라이트박스.

    **새 머티리얼을 쓰지 않는다.** Z2 는 드로우 콜 예산이 가장 빡빡한 존이라
    AD_PANEL 3색을 들이면 그대로 +3 이다. 이미 Z2 에 있는 색(SIGN_INFO 파랑 ·
    SH_RED · SH_GREEN)을 광고 면으로 돌려쓰고 테두리는 TXT_DARK 로 잡는다.
    """
    faces = [(0.00, 1, range(4, 53, 4)),        # 남벽 — 내면 y 0.00, 실내가 +y
             (30.00, -1, range(4, 21, 4))]      # 북벽 — 상가·화장실이 x21 부터라 그 앞까지만
    tone = ("SIGN_INFO", "SH_RED", "SH_GREEN")
    made = 0
    for (wy, sgn, xr) in faces:
        for i, cx in enumerate(xr):
            # 노선색 띠(z −4.65~−4.38)를 가로지르면 광고 한가운데 초록 줄이 그어진다.
            # 실사도 광고는 띠 **아래 눈높이**에 있고 띠는 그 위를 지난다. 그 배치를 따른다.
            f0, f1 = wy, wy + sgn * 0.08
            a.box("TXT_DARK", cx - 0.92, min(f0, f1), -5.82, cx + 0.92, max(f0, f1), -4.74)
            p0, p1 = wy + sgn * 0.08, wy + sgn * 0.09
            a.box(tone[i % 3], cx - 0.82, min(p0, p1), -5.73, cx + 0.82, max(p0, p1), -4.83)
            made += 1
    return made


def z2_floor_decals(a, coll):
    """바닥 유도 데칼.

    실사 조사에서 찾은 것 — 서울 지하철은 환승·출구 안내를 **바닥에 붙인다**.
    파란/초록 사각 스티커에 화살표와 출구 번호가 찍혀 있고, 사람이 많아 벽 사인이
    가릴 때 이게 유일하게 보이는 안내다. 우리 바닥에는 점자블록뿐이었다.

    바닥은 1인칭 시야의 아래 절반을 늘 차지한다 — 가장 싸게 '서울'로 읽히는 자리다.
    """
    z = -5.994
    plan = [
        # 글자가 rotZ −90° 로 누워 있어 **읽는 방향이 −y · 글자 위가 +x** 다.
        # 그래서 화면 문자와 월드 방향의 대응은 → −y · ← +y · ↑ +x · ↓ −x 다.
        # 전부 "→" 로 적혀 있었는데 그건 남쪽을 가리키는 것이라 다섯 개 모두 틀렸다.
        (10.0, 15.0, "SIGN_INFO", "1 · 3 출구  ←"),      # 출구 계단 y 25.4~30.6 = 북
        (24.0, 15.0, "SIGN_INFO", "1 · 3 출구  ↓"),      # 계단 x 2~14.6 = 서
        (38.0, 15.0, "SH_GREEN", "승강장  Platform  ↑"),  # 개찰구 x 56~ = 동
        (50.0, 15.0, "SH_GREEN", "승강장  Platform  ↑"),
        (17.0, 24.0, "SIGN_INFO", "화장실  Restroom  ↑"),  # 화장실 x 36~51 = 동
    ]
    for i, (cx, cy, mat, body) in enumerate(plan):
        a.box("TXT_DARK", cx - 1.26, cy - 0.46, z - 0.004, cx + 1.26, cy + 0.46, z + 0.001)
        a.box(mat, cx - 1.20, cy - 0.40, z, cx + 1.20, cy + 0.40, z + 0.004)
        # 바닥 글자는 **걷는 사람 기준**으로 눕혀야 한다.
        # 회전 없이 눕히면 글자 위쪽이 +y(걷는 사람의 왼쪽)를 향해 90° 돌아 보인다.
        # +x 로 걷는 사람은 오른쪽이 −y 이므로 읽는 방향이 −y, 글자 위쪽이 +x 다 → rotZ −90°.
        text(f"Z2_decal_txt{i}", body, (cx, cy, z + 0.006), 0.20, "TXT_WHITE", coll,
             rot=(0.0, 0.0, -1.5707963))
    return len(plan)


def z3_exit_band(a, coll):
    """개찰구 상부 「나가는 곳 Exit」 밴드.

    실사에서 개찰구 위에 가장 크게 걸린 사인이 이것이고, 색이 **연두**다.
    우리 개찰구 위에는 게이트별 ▲/✕ 표지판만 있어서 '어디가 밖인지'를 말하는 게 없었다.
    """
    m = bpy.data.materials.get("SIGN_EXIT")
    if m is None:
        m = bpy.data.materials.new("SIGN_EXIT")
        m.use_nodes = True
        b = m.node_tree.nodes.get("Principled BSDF")
        if b:
            b.inputs["Base Color"].default_value = (0.706, 0.812, 0.180, 1.0)
    m.diffuse_color = (0.706, 0.812, 0.180, 1.0)

    cx = 62.6                      # 개찰구 동쪽(운임구역 쪽) 바로 뒤
    for cy in (8.0, 16.0, 24.0):
        a.box("DUCT", cx - 0.03, cy - 1.30, -3.05, cx + 0.03, cy - 1.24, -2.80)
        a.box("DUCT", cx - 0.03, cy + 1.24, -3.05, cx + 0.03, cy + 1.30, -2.80)
        a.box("TXT_DARK", cx - 0.10, cy - 1.42, -3.62, cx + 0.10, cy + 1.42, -3.02)
        a.box("SIGN_EXIT", cx - 0.12, cy - 1.36, -3.56, cx + 0.12, cy + 1.36, -3.08)
    for i, cy in enumerate((8.0, 16.0, 24.0)):
        for s, sfx in ((-1, "W"), (1, "E")):
            # 양면에 같은 문안이 걸리는데 "←" 는 보는 사람 기준 왼쪽(면마다 반대)이라
            # 한쪽은 반드시 틀린다. 방향이 애매하면 화살표를 빼는 게 맞다 —
            # 이 띠는 개찰구 위라 "여기가 나가는 곳"이라는 표시만으로 충분하다.
            text(f"Z3_exitband{i}{sfx}", "나가는 곳  Exit", (cx + s * 0.135, cy, -3.32),
                 0.20, "TXT_DARK", coll,
                 rot=(1.5707963, 0.0, 1.5707963 * (3 if s < 0 else 1)))
    return 3


# ────────────────────────────── Z4 하강부 ──────────────────────────────

def _soffit_z(obj, x, y):
    mw_inv = obj.matrix_world.inverted()
    dirv = (mw_inv.to_3x3() @ mathutils.Vector((0, 0, 1))).normalized()
    ok, loc, _, _ = obj.ray_cast(mw_inv @ mathutils.Vector((x, y, -30.0)), dirv)
    return (obj.matrix_world @ loc).z if ok else None


def z4_descent_light(a):
    """경사 소핏을 따라 내려가는 연속 조명.

    하강 샤프트가 캄캄해서 아래가 안 보였다. 실제 에스컬레이터 샤프트는
    소핏을 따라 조명이 이어진다 — 그게 '내려가도 된다'는 유일한 신호다.
    """
    obj = bpy.data.objects["Z4_desc_ceil"]
    # 경사면에 축정렬 상자로 연속 띠를 만들면 계단처럼 층져 **고장난 조명**으로 보인다.
    # 실제 에스컬레이터 샤프트도 연속 띠가 아니라 일정 간격 매입 다운라이트다 — 그쪽을 따른다.
    x = 97.4
    made = 0
    while x < 126.0:
        z = _soffit_z(obj, x, 5.2)
        if z is not None:
            for cy in (3.2, 7.2):
                a.box("DUCT", x - 0.34, cy - 0.34, z - 0.10, x + 0.34, cy + 0.34, z - 0.005)
                a.box("FIXTURE", x - 0.27, cy - 0.27, z - 0.085, x + 0.27, cy + 0.27, z - 0.055)
            made += 2
        x += 2.2
    return made


def z4_wall_ads(a):
    """통로 벽 라이트박스 — 프레임 + 발광면. 통짜 흰 벽이 가장 싸게 살아난다.

    ⚠ 벽의 **내면 y** 를 써야 한다. 벽 오브젝트의 바깥 좌표를 쓰면 광고가 벽 속에
    2.4m 파묻혀 허공에 뜬 것처럼 보인다 — 실제로 그렇게 나왔다.

    ⚠⚠ 그리고 그 값은 **벽 패스와 같이 움직여야 한다.** 북쪽 내면을 9.60 으로 두고
    있었는데, 그건 하강부 난간 y 였고 부록 A · 충돌 `Z4-UPPER` 의 통로는 y 2~12 다.
    `hq_walls` · `hq_cove` · `hq_floor` 를 12.00 으로 고칠 때 여기만 안 따라와서
    이번엔 광고가 벽보다 2.4 m **앞으로** 나와 허공에 떴다 — 같은 숫자가 반대로 났다.
    """
    # ⚠⚠⚠ **이 함수는 더 이상 쓰지 않는다.** `hq_walls.WALLS` 가 Z4wS(y 2.00) ·
    #     Z4wN(y 12.00) 에 걸레받이 · 광고 · 띠를 전부 만들고, 프레임 네 변에
    #     포스터 3종으로 그쪽이 더 정교하다. 여기 것과 위치가 달라서(9.60 대 12.00)
    #     겹치지 않았을 뿐 처음부터 중복이었다.
    #     blend 에 남아 있는 것은 `hq_fixups.corridor_ads_drop()` 이 걷어낸다.
    return
    faces = ((12.00, -1), (2.00, 1))
    for i, cx in enumerate(range(75, 96, 4)):
        for (wy, sgn) in faces:
            f0 = wy
            f1 = wy + sgn * 0.09           # 프레임이 실내로 9cm 나온다
            a.box("SIGN_DARK", cx - 0.86, min(f0, f1), -5.50, cx + 0.86, max(f0, f1), -3.60)
            # Z4 에는 광고 머티리얼이 없었다. **존당 머티리얼 = 드로우 콜**이므로 3색은 +3 이다.
            # 한 색으로 줄였더니 같은 파란 판이 통로에 열두 개 늘어서 벽지처럼 보였다.
            # Z2 시점 실측이 195/200 이라 2콜은 감당된다 — 다양성 쪽을 택한다.
            mat = ("AD_PANEL", "AD_PANEL2", "AD_PANEL3")[i % 3]
            p0 = wy + sgn * 0.09
            p1 = wy + sgn * 0.10
            a.box(mat, cx - 0.76, min(p0, p1), -5.40, cx + 0.76, max(p0, p1), -3.70)


def z4_stair_balusters(a):
    """계단 난간동자.

    핸드레일 3줄은 이미 있는데 **받치는 기둥이 없어** 공중에 뜬 막대기로 보였다.
    레퍼런스의 계단도 난간동자가 촘촘히 서 있고, 그 리듬이 계단의 길이를 읽게 해 준다.

    난간이 계단참(x 107~108.6)에서 꺾이므로 기울기를 1차식으로 가정하면 안 된다 —
    난간 메시에 **레이를 쏴서** 그 x 의 밑면을 직접 읽는다.

    ⚠ 정점을 x 로 양자화해 최솟값을 쓰면 안 된다. 난간은 **회전된 상자**라 정점이
    8개뿐이고, 양자화 키도 그 8개의 x 값밖에 안 생긴다. `min(키, |키−x|)` 로 고르면
    중간 구간 전체가 **끝점의 z** 를 쓰게 되어, 동자 절반이 승강장 바닥(z≈−19.9)에
    꽂히고 절반이 계단 위 공중에 뜬다. 실제로 그렇게 나왔다.
    """
    made = 0
    for name, base in (("Z4_st_rail_4.12", "Z4_st_stringL"),
                       ("Z4_st_rail_6.70", None),
                       ("Z4_st_rail_9.28", "Z4_st_stringR")):
        o = bpy.data.objects.get(name)
        if o is None:
            continue
        pts = [o.matrix_world @ v.co for v in o.data.vertices]
        cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
        x0, x1 = min(p.x for p in pts), max(p.x for p in pts)
        x = x0 + 0.6
        while x < x1 - 0.4:
            zt = _under(o, x, cy)
            zb = _stand_z(x, cy, base)
            if zt is not None and zb is not None and zt - zb > 0.15:
                a.box("STAIR_RAIL", x - 0.028, cy - 0.028, zb,
                      x + 0.028, cy + 0.028, zt + 0.01)
                made += 1
            x += 1.25
    return made


def _under(o, x, y):
    """오브젝트 밑면 높이 — 아래에서 위로 쏴 첫 히트."""
    inv = o.matrix_world.inverted()
    org = inv @ Vector((x, y, -26.0))
    tip = inv @ Vector((x, y, 4.0))
    d = tip - org
    ok, loc, _n, _i = o.ray_cast(org, d.normalized(), distance=d.length)
    return (o.matrix_world @ loc).z if ok else None


def _stand_z(x, y, base):
    """동자가 딛는 면. 옆 난간은 계단 옆판(스트링어) 위, 중앙 난간은 계단면 위."""
    names = ([base] if base else
             [o.name for o in bpy.data.objects
              if o.name.startswith(("Z4_st_tread", "Z4_st_nose", "Z4_st_riser"))])
    best = None
    for nm in names:
        ob = bpy.data.objects.get(nm)
        if ob is None:
            continue
        inv = ob.matrix_world.inverted()
        org = inv @ Vector((x, y, 4.0))
        tip = inv @ Vector((x, y, -26.0))
        d = tip - org
        ok, loc, _n, _i = ob.ray_cast(org, d.normalized(), distance=d.length)
        if ok:
            z = (ob.matrix_world @ loc).z
            if best is None or z > best:
                best = z
    return best


def z4_skirting(a):
    """Z4 통로 걸레받이. Z2·Z3·Z5 에는 있는데 여기만 없어서 벽이 바닥에 그냥 꽂혀 있었다."""
    for (wy, sgn) in ((9.60, -1), (2.00, 1)):
        a.box("ST_TRIM", 72.0, min(wy, wy + sgn * 0.03), -6.00,
              96.0, max(wy, wy + sgn * 0.03), -5.86)


def z4_overhead_sign(a, coll):
    """하강 진입부 매달림 방향 사인 — 검정 박스 + 쌍봉.

    레퍼런스에서 가장 눈에 띄는 사인 형태다. 결정 지점(내려갈지 지나칠지)에 없으면
    통로가 그냥 복도로 보인다.
    """
    # 서울 지하철 방면 안내는 **초록 바탕에 흰 글씨**다. 처음에 검정으로 만들었더니
    # 어두운 천장에 묻혀 결정 지점에 사인이 있는지도 몰랐다.
    # ⚠ 사인 판은 **통로 축에 직각**이어야 한다. Z4 통로는 x 축이므로 판은 y 로 넓고
    # x 로 얇다. 처음에 x 로 넓게 만들었더니 걸어오는 방향에서 판의 옆면(두께 2cm)만
    # 보여 검은 막대기 하나가 매달린 꼴이 됐다.
    cx, cy, z = 93.6, 6.6, -3.02
    for s in (-1, 1):
        a.box("DUCT", cx - 0.025, cy + s * 1.05 - 0.025, z, cx + 0.025, cy + s * 1.05 + 0.025, z + 0.30)
    a.box("SIGN_DARK", cx - 0.11, cy - 2.10, z - 0.82, cx + 0.11, cy + 2.10, z)
    a.box("LINE2_GRN", cx - 0.13, cy - 2.04, z - 0.76, cx + 0.13, cy + 2.04, z - 0.06)
    # W 면은 대합실에서 걸어오는 사람이, E 면은 승강장에서 올라온 사람이 본다
    for s, sfx in ((-1, "W"), (1, "E")):
        text(f"Z4_sign_desc_{sfx}", "승강장  Platform  ↓", (cx + s * 0.145, cy, z - 0.41),
             0.215, "TXT_WHITE", coll,
             rot=(1.5707963, 0.0, 1.5707963 * (3 if s < 0 else 1)))

    # 하강 개구부 상단 페시아 띠 — 큰 회색 쐐기가 통짜로 보이던 면을 끊는다
    a.box("LINE2_GRN", 95.85, 0.95, -3.30, 96.05, 9.55, -2.98)


def main():
    for o in [o for o in bpy.data.objects
              if o.name.startswith(("Z5_DET_", "Z4_DET_", "Z2_DET_", "Z4_sign_desc"))]:
        bpy.data.objects.remove(o, do_unlink=True)

    a5 = Acc("Z5_PLATFORM")
    z5_platform_edge(a5)
    z5_column_band(a5)
    z5_hanging_ads(a5)
    n5 = a5.emit("Z5_DET")

    a4 = Acc("Z4_DESCENT")
    z4_descent_light(a4)
    z4_wall_ads(a4)
    z4_skirting(a4)
    nb = z4_stair_balusters(a4)
    z4_overhead_sign(a4, "Z4_DESCENT")
    n4 = a4.emit("Z4_DET")

    a2 = Acc("Z2_CONCOURSE")
    nc = z2_column_bands(a2)
    na = z2_wall_ads(a2)
    nd = z2_floor_decals(a2, "Z2_CONCOURSE")
    n2 = a2.emit("Z2_DET")

    a3 = Acc("Z3_GATES")
    ne = z3_exit_band(a3, "Z3_GATES")
    a3.emit("Z3_DET")

    print(f"디테일 — Z5 머티리얼 {n5}종 · Z4 {n4}종 · Z2 {n2}종(전부 기존) · 난간동자 {nb}개")
    print(f"  Z2 기둥 띠 {nc}개 · 벽 라이트박스 {na}개 · 바닥 데칼 {nd}개 · Z3 나가는곳 {ne}개")
    print(f"  승차위치 {len(DOORS)}개소 · 대기 원판 {len(DOORS) * 2}개")
    print("  기둥 띠 · 매달림 광고 4쌍 · 하강 소핏 조명 · 통로 라이트박스 · 방향 사인")


main()
