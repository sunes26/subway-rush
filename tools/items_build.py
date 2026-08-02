"""ITM 픽업 소품 빌드 — 교통카드(ITM-04) · 마스크(ITM-06) · 우산(ITM-09).

실행:  blender -b --factory-startup --python tools/items_build.py -- <out.blend>

왜 맵에 굽지 않는가
  기존 ITM-05(이어폰)·ITM-14(배터리)는 station_map.blend 안에 놓인 지오메트리라
  **세상에 놓이기만 한다.** 여기 셋은 손에도 들려야 한다 — 카드는 개찰구에
  찍고, 우산은 인파를 비켜세우고, 마스크는 착용한다. 맵에 구우면 그 자리에서
  숨기는 것 말고는 못 한다. 그래서 별도 GLB 로 뽑고 자리는 데이터로 넘긴다.

색 체계 (세 소품이 한 세트로 보이게)
  * 순수 검정·순수 흰색을 쓰지 않는다. 가장 어두운 색이 #20252E, 가장 밝은
    색이 #F0F1EE 다. 게임 화면에서 부드러운 인상을 유지한다.
  * 한 소품이 쓰는 주요 색은 3~4개까지. 면마다 임의로 칠하지 않고 **구조와
    재질이 바뀌는 곳에서만** 나눈다.
  * 접힘·주름은 색을 따로 칠하지 않고 같은 색 계열의 명도 차이로만 낸다.
  * 포인트 컬러(웜 옐로)는 카드 NFC 심볼과 우산 스트랩에만 아주 조금 쓴다 —
    두 소품이 같은 세트라는 신호가 이것 하나다.

크기 규약
  캐릭터 전신이 0.888 이고, 기존 소품은 실물보다 1.5배쯤 과장돼 있다
  (PR_Carrier 0.414 = 전신의 47%, 실제 기내용 캐리어는 32%). 치비 양식이라
  실치수를 그대로 넣으면 손에서 사라진다. 같은 과장을 따른다.

원점 규약
  손에 붙일 지점에 원점을 둔다 — 우산은 손잡이, 카드·마스크는 중심.
"""
import bpy, sys, os, json, math
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib.blend import new_mat, set_active   # noqa: E402

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else None
if not OUT:
    raise RuntimeError("output .blend path required after --")
REPORT = os.environ.get("ITEMS_REPORT", "/tmp/items_build_report.json")

BODY_H = 0.888          # 캐릭터 전신 (크기 대조용)
PHONE_L = 0.100         # PR_Phone 장변 (기존 소품 대조용)
BEVEL_S = 0.0006        # 공통 베벨

rep = {}


# ------------------------------------------------------------------ 도우미
def _mesh(name, verts, faces, mats, mat_idx=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    for m in (mats if isinstance(mats, (list, tuple)) else [mats]):
        o.data.materials.append(m)
    if mat_idx is not None:
        for p, i in zip(me.polygons, mat_idx):
            p.material_index = i
    return o


def _apply(o, mod):
    set_active(o)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def bevel(o, width, segments=1):
    if width <= 0:
        return o
    m = o.modifiers.new("Bevel", 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(35)
    _apply(o, m)
    return o


def round_rect(w, h, r, seg=3):
    """가운데가 (0,0) 인 라운드 사각형 외곽선 (x, z). 반시계 방향."""
    hw, hh = w / 2.0 - r, h / 2.0 - r
    if hw < 0 or hh < 0:
        raise RuntimeError("corner radius %g too large for %gx%g" % (r, w, h))
    pts = []
    for cx, cz, a0 in ((hw, hh, 0.0), (-hw, hh, 90.0),
                       (-hw, -hh, 180.0), (hw, -hh, 270.0)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90.0 * i / seg)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    out = []
    for p in pts:                                   # 귀 이음매의 중복점 제거
        if not out or abs(p[0] - out[-1][0]) > 1e-9 or abs(p[1] - out[-1][1]) > 1e-9:
            out.append(p)
    if abs(out[0][0] - out[-1][0]) < 1e-9 and abs(out[0][1] - out[-1][1]) < 1e-9:
        out.pop()
    return out


def plate(name, w, h, r, thick, mat, seg=3, y=0.0, cx=0.0, cz=0.0):
    """XZ 평면의 라운드 사각형 판. y 를 중심으로 thick 만큼 두껍다."""
    ring = round_rect(w, h, r, seg)
    n = len(ring)
    front = [(x + cx, y - thick / 2.0, z + cz) for x, z in ring]
    back = [(x + cx, y + thick / 2.0, z + cz) for x, z in ring]
    faces = [tuple(range(n))]                                  # 앞면
    faces += [(n + i, n + (i + 1) % n, (i + 1) % n, i) for i in range(n)]  # 옆면
    faces.append(tuple(range(2 * n - 1, n - 1, -1)))            # 뒷면
    return _mesh(name, front + back, faces, mat)


def arc_band(name, r0, r1, a0, a1, seg, thick, mat, y=0.0, cx=0.0, cz=0.0):
    """부채꼴 띠(원호 밴드). NFC 파동 심볼을 만드는 데 쓴다."""
    fr, bk = [], []
    for i in range(seg + 1):
        a = math.radians(a0 + (a1 - a0) * i / seg)
        for r in (r1, r0):
            fr.append((cx + r * math.cos(a), y - thick / 2.0, cz + r * math.sin(a)))
            bk.append((cx + r * math.cos(a), y + thick / 2.0, cz + r * math.sin(a)))
    n = len(fr)
    verts = fr + bk
    faces = []
    for i in range(seg):
        o_ = i * 2
        faces.append((o_, o_ + 2, o_ + 3, o_ + 1))                       # 앞
        faces.append((n + o_ + 1, n + o_ + 3, n + o_ + 2, n + o_))       # 뒤
        faces.append((o_, o_ + 1, n + o_ + 1, n + o_))                   # 안쪽 옆
        faces.append((o_ + 2, n + o_ + 2, n + o_ + 3, o_ + 3))           # 바깥 옆
    faces.append((0, 1, n + 1, n))
    faces.append((seg * 2, n + seg * 2, n + seg * 2 + 1, seg * 2 + 1))
    return _mesh(name, verts, faces, mat)


def tube(name, pts, radius, seg, mat):
    """점 목록을 잇는 튜브.

    단면 좌표계를 **평행 이송**한다. 점마다 고정 기준축(up)에서 새로 만들면,
    경로가 수직에 가까워지는 순간 기준축이 바뀌며 링 감김이 뒤집힌다.
    그 이음매의 사각형은 나비넥타이가 되어 면적이 상쇄돼 0 이 된다
    (실측: 마스크 귀걸이에서 4개).

    정점을 직접 놓는 이유는 따로 있다 — 실린더를 회전 적용한 뒤 월드 XY 로
    반경을 주면 기울어진 구간이 전단된다.
    """
    P = [Vector(p) for p in pts]
    if len(P) < 2:
        raise RuntimeError("tube needs >= 2 points")
    tangents = []
    for i in range(len(P)):
        d = P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]
        tangents.append(d.normalized() if d.length > 1e-9 else Vector((0.0, 0.0, 1.0)))
    ref = Vector((0.0, 0.0, 1.0))
    if abs(tangents[0].dot(ref)) > 0.95:
        ref = Vector((1.0, 0.0, 0.0))
    u = tangents[0].cross(ref).normalized()
    verts, faces = [], []
    for i, p in enumerate(P):
        d = tangents[i]
        u = (u - d * u.dot(d))                    # 이전 축을 새 단면에 투영
        if u.length < 1e-9:
            u = d.cross(Vector((1.0, 0.0, 0.0)))
        u.normalize()
        v = d.cross(u).normalized()
        for k in range(seg):
            a = 2.0 * math.pi * k / seg
            verts.append(tuple(p + (u * math.cos(a) + v * math.sin(a)) * radius))
    for i in range(len(P) - 1):
        for k in range(seg):
            a, b = i * seg + k, i * seg + (k + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    faces.append(tuple(range(seg - 1, -1, -1)))
    base = (len(P) - 1) * seg
    faces.append(tuple(range(base, base + seg)))
    return _mesh(name, verts, faces, mat)


def lobed(name, rings, seg, mats, lobe=0.0, wobble=(), mat_pattern=None):
    """(z, radius) 고리를 쌓은 회전체.

    `lobe` 는 반경을 한 칸씩 번갈아 줄여 세로 골을 만든다. `wobble` 은 열마다
    반경을 조금씩 흔들어 **접힌 천의 비대칭 실루엣**을 낸다 — 완전히 균일한
    육각 기둥은 우산이 아니라 케이스로 읽힌다.

    `mat_pattern` 은 열별 머티리얼 인덱스다. 접힘 음영을 검은 면으로 칠하지
    않고 **같은 색 계열의 명도 차이**로 내는 방법이 이것이다.
    """
    verts, faces, idx = [], [], []
    nr = len(rings)
    for z, r in rings:
        for k in range(seg):
            a = 2.0 * math.pi * k / seg
            w = wobble[k % len(wobble)] if wobble else 1.0
            rr = r * (1.0 - lobe * (k % 2)) * w
            verts.append((rr * math.cos(a), rr * math.sin(a), z))
    for i in range(nr - 1):
        for k in range(seg):
            a, b = i * seg + k, i * seg + (k + 1) % seg
            faces.append((a, b, b + seg, a + seg))
            idx.append(mat_pattern[k % len(mat_pattern)] if mat_pattern else 0)
    faces.append(tuple(range(seg - 1, -1, -1)))
    idx.append(0)
    base = (nr - 1) * seg
    faces.append(tuple(range(base, base + seg)))
    idx.append(0)
    return _mesh(name, verts, faces, mats, idx)


def finish(name, parts):
    """부품을 합치고 평면 셰이딩. 원점은 건드리지 않는다."""
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    # set_active 는 다른 선택을 전부 해제한다 — 여기서 부르면 조인할 대상이
    # 사라져 "No mesh data to join" 이 뜬다. 액티브만 직접 지정한다.
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    # 정리 패스. 튜브 이음매에서 폭이 0 에 가까운 슬리버 면이 남는다
    # (실측: 귀걸이 끈에서 4개). 임계값을 푸는 대신 지운다.
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.mesh.dissolve_degenerate(threshold=1e-5)
    bpy.ops.mesh.delete_loose(use_verts=True, use_edges=True, use_faces=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.shade_flat()
    o.location = (0.0, 0.0, 0.0)
    return o


def measure(o):
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    d = [round(v, 4) for v in o.dimensions]
    return {"tris": tris, "verts": len(o.data.vertices), "dim_m": d,
            "vs_body_pct": round(100.0 * max(d) / BODY_H, 1),
            "vs_phone_x": round(max(d) / PHONE_L, 2),
            "materials": [m.name for m in o.data.materials if m]}


# ------------------------------------------------------------------ 씬 준비
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = 30
sc.unit_settings.system = 'METRIC'

# 세 소품이 공유하는 팔레트. 순수 검정(#000)·순수 흰색(#fff)은 쓰지 않는다.
M_CARD = new_mat("ITM_CardBody", "17617A", 0.46)        # 딥 틸 (주색)
M_CARD2 = new_mat("ITM_CardSky", "79BDD0", 0.44)        # 소프트 스카이 (보조)
M_CARD3 = new_mat("ITM_CardNavy", "183846", 0.48)       # 딥 네이비 (마감)
M_POINT = new_mat("ITM_PointYellow", "E5B84A", 0.40)    # 웜 옐로 (세트 공용 포인트)

M_CLOTH = new_mat("ITM_MaskCloth", "E8ECEC", 0.96)      # 쿨 화이트 — 무광 부직포
M_CLOTH_IN = new_mat("ITM_MaskInner", "C7D0D1", 0.96)   # 안쪽 면 소프트 그레이
M_LOOP = new_mat("ITM_MaskLoop", "F0F1EE", 0.94)        # 오프화이트 끈

M_CANOPY = new_mat("ITM_UmbCanopy", "344B78", 0.74)     # 미드 네이비 (천 기본)
M_FOLD = new_mat("ITM_UmbFold", "263A61", 0.74)         # 딥 블루 (접힘 음영)
M_FOLD2 = new_mat("ITM_UmbFoldLit", "455F8D", 0.74)     # 슬레이트 블루 (밝은 접힘)
M_STRAP = new_mat("ITM_UmbStrap", "202D47", 0.60)       # 다크 네이비 스트랩
M_GRIP = new_mat("ITM_UmbGrip", "20252E", 0.54)         # 블루블랙 손잡이
M_METAL = new_mat("ITM_UmbMetal", "59616A", 0.42, metallic=0.55)   # 건메탈

ITEMS = {}

# ============================================== ITM-04 교통카드 (P0)
# 금융카드로 보이던 요소를 걷어냈다 — 금색 IC 칩과 카드번호처럼 읽히던
# 가로선 둘을 없애고, 대신 NFC 파동(원호 3겹)을 넣었다. 태그하는 물건이라는
# 신호가 이것 하나로 충분하다.
# 원점은 카드 중심 — 개찰구에 찍을 때 손이 카드 가운데를 쥔다.
CW, CH, CT = 0.084, 0.053, 0.0032
CR = 0.0042                       # 네 귀 라운딩 (실물 3.18mm 와 같은 비율)
# 그래픽은 표면과 같은 높이로 읽혀야 한다. 0 으로 두면 Z-파이팅이 지글거리므로
# 84mm 카드에서 0.05mm 만 띄운다 — 눈으로는 평평하다.
FLAT = 0.00005
_fy = -CT / 2.0 - FLAT

_body = plate("card_body", CW, CH, CR, CT, M_CARD, seg=3)
bevel(_body, BEVEL_S * 0.5, 1)
_parts = [_body]

# 하단 보조 그래픽 영역 — 카드를 양분하던 무거운 띠를 낮췄다 (28% → 15%).
# 옆면에 진한 선이 생기지 않도록 외곽선보다 안쪽으로 물린다.
_parts.append(plate("card_band", CW * 0.90, CH * 0.15, 0.0022, FLAT * 2, M_CARD2,
                    seg=2, y=_fy, cz=-CH * 0.335))

# NFC 파동 — 왼쪽에서 오른쪽으로 퍼지는 원호 3겹. 바깥으로 갈수록 얇아진다.
for _i, (_r, _t, _m) in enumerate(((0.0072, 0.0016, M_CARD2),
                                   (0.0118, 0.0014, M_CARD2),
                                   (0.0164, 0.0012, M_POINT))):
    _parts.append(arc_band("card_wave%d" % _i, _r, _r + _t, -52.0, 52.0, 5,
                           FLAT * 2, _m, y=_fy, cx=-CW * 0.28, cz=CH * 0.06))

# 뒷면 마감 띠 — 실루엣에는 안 잡히지만 앞뒤가 구분된다. 순수 검정 대신 네이비.
_parts.append(plate("card_stripe", CW * 0.90, CH * 0.14, 0.0007, FLAT * 2, M_CARD3,
                    seg=1, y=CT / 2.0 + FLAT, cz=CH * 0.27))

ITEMS["ITM04_Card"] = finish("ITM04_Card", _parts)

# ============================================== ITM-06 마스크 (P1)
# 일회용 부직포 마스크. 아래가 뾰족하게 좁아지던 사다리꼴과 세게 말려
# 어두워지던 턱선을 걷어냈다 — 밝고 균일한 부직포로 읽혀야 한다.
#   ① 코가 앞으로 나오고 좌우가 뒤로 감긴다 (가로 곡률)
#   ② 위·아래가 얼굴 쪽으로 완만히 말린다 (세로 곡률)
#   ③ 가로 주름 3개. 색을 칠하지 않고 얕은 접힘의 명암으로만 낸다.
MW, MH = 0.090, 0.062
NOSE, TUCK, CHIN, PLEAT = 0.020, 0.0100, 1.0, 0.0016
NCOL, NROW = 7, 13
_vs, _fs = [], []
for ri in range(NROW):
    zt = ri / (NROW - 1.0) - 0.5                      # -0.5(아래) ~ +0.5(위)
    curl = TUCK * (abs(zt) / 0.5) ** 2 * (CHIN if zt < 0 else 1.0)
    # 3주기 삼각파를 행 수가 적을 때 쓰면 행마다 방향이 뒤집혀 체크무늬로
    # 보인다(실측). 행을 늘려 한 주기를 4행 이상으로 샘플링한다.
    t = 3.0 * (zt + 0.5)
    pleat = PLEAT * (2.0 * abs(t - round(t)) - 0.5)
    for ci in range(NCOL):
        xt = ci / (NCOL - 1.0) - 0.5
        wrap = -NOSE * (1.0 - (xt / 0.5) ** 2)        # 가운데가 앞(-Y)
        # 아래로 아주 완만하게만 좁아진다. 세게 좁히면 아래가 뾰족해지고
        # solidify 테두리가 삼각 돌출로 튀어나온다 (실측).
        narrow = 1.0 - 0.10 * max(0.0, -zt)
        _vs.append((xt * MW * narrow, wrap + curl + pleat, zt * MH))
for ri in range(NROW - 1):
    for ci in range(NCOL - 1):
        i = ri * NCOL + ci
        _fs.append((i, i + 1, i + NCOL + 1, i + NCOL))
_panel = _mesh("mask_panel", _vs, _fs, [M_CLOTH, M_CLOTH_IN])
set_active(_panel)
_sol = _panel.modifiers.new("Solidify", 'SOLIDIFY')
_sol.thickness = 0.0015                               # 부직포 한 장 두께
_sol.offset = 0.0
_sol.material_offset = 1                              # 안쪽 면만 소프트 그레이
_sol.material_offset_rim = 1
_apply(_panel, _sol)
_parts = [_panel]

# 귀걸이 — 얇고 둥근 탄성 끈. 각진 와이어로 보이면 안 되므로 점을 촘촘히
# 놓고 단면은 6각으로 올린다.
for sx in (1, -1):
    x0 = MW * 0.43 * sx
    arc = [(x0 + 0.005 * sx * math.sin(math.pi * i / 7.0),
            0.004 + 0.038 * math.sin(math.pi * i / 7.0),
            math.cos(math.pi * i / 7.0) * MH * 0.31) for i in range(8)]
    _parts.append(tube("mask_loop%s" % ("L" if sx > 0 else "R"), arc, 0.0011, 6, M_LOOP))
ITEMS["ITM06_Mask"] = finish("ITM06_Mask", _parts)

# ============================================== ITM-09 우산 (P1)
# 접힌 장우산. 우산을 우산으로 만드는 건 캐노피가 아니라 **J자 갈고리**다
# (방추형은 펜, 직선 그립은 다트로 보였다).
# 천은 육각 기둥이 아니라 여러 겹이 모인 비대칭 덩어리로 읽혀야 한다 —
# 열마다 반경을 흔들고(wobble), 접힘 음영을 **같은 색 계열의 명도 차이**로 낸다.
# 검은 면을 섞으면 천이 아니라 그림자 뭉치가 된다.
# **원점을 손잡이 쥐는 자리에 둔다** — 여기가 (0,0,0) 이어야 손에 붙였을 때
# 우산이 손에서 자라난다.
HOOK = [(0.0, 0.0, 0.030), (0.0, 0.0, -0.014)]
_HR, _HC = 0.026, -0.030
for _i in range(1, 7):
    _a = math.pi * _i / 6.0
    HOOK.append((0.0, _HR * (1.0 - math.cos(_a)), _HC - _HR * math.sin(_a) * 0.62))

CAN_LO, CAN_HI = 0.048, 0.256
# 8열. 0=기본 · 1=어두운 접힘 · 2=밝은 접힘 을 섞어 겹겹이 접힌 느낌을 낸다.
CAN_MATS = [M_CANOPY, M_FOLD, M_FOLD2]
CAN_PATTERN = [0, 1, 2, 0, 1, 0, 2, 1]
CAN_WOBBLE = (1.00, 0.88, 1.06, 0.93, 1.03, 0.86, 1.08, 0.91)

_parts = [
    tube("umb_hook", HOOK, 0.0090, 6, M_GRIP),
    lobed("umb_shaft", [(0.026, 0.0050), (CAN_LO + 0.004, 0.0050)], 6, M_METAL),
    # 위가 가장 풍성하고 밴드 쪽이 잘록하다.
    lobed("umb_canopy",
          [(CAN_LO, 0.0160), (CAN_LO + 0.030, 0.0208), (CAN_LO + 0.075, 0.0192),
           (CAN_HI - 0.048, 0.0232), (CAN_HI - 0.014, 0.0210), (CAN_HI, 0.0166)],
          8, CAN_MATS, lobe=0.11, wobble=CAN_WOBBLE, mat_pattern=CAN_PATTERN),
    # 스트랩 — 검은 링이 아니라 천을 감는 얇은 띠. 천보다 아주 조금만 굵다.
    lobed("umb_strap", [(CAN_LO + 0.070, 0.0212), (CAN_LO + 0.079, 0.0212)],
          8, M_STRAP, wobble=CAN_WOBBLE),
    lobed("umb_strap_pt", [(CAN_LO + 0.0725, 0.0216), (CAN_LO + 0.0765, 0.0216)],
          8, M_POINT, wobble=CAN_WOBBLE),
    # 끝 팁 — 묻히지 않게 또렷한 형태로.
    lobed("umb_ferrule", [(CAN_HI - 0.002, 0.0082), (CAN_HI + 0.010, 0.0068),
                          (CAN_HI + 0.020, 0.0030)], 6, M_METAL),
]
for _p in _parts:
    bevel(_p, BEVEL_S, 1)
ITEMS["ITM09_Umbrella"] = finish("ITM09_Umbrella", _parts)

# --------------------------------------------------------------------- 검산
def _family(mat):
    """색 계열 이름. 채도가 낮으면 전부 'neutral', 아니면 30도 색상 버킷."""
    b = next(n for n in mat.node_tree.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled')
    lin = b.inputs["Base Color"].default_value[:3]
    srgb = [(1.055 * c ** (1 / 2.4) - 0.055) if c > 0.0031308 else c * 12.92 for c in lin]
    import colorsys
    h, sv, v = colorsys.rgb_to_hsv(*srgb)
    if sv < 0.16:
        return "neutral"
    return "hue%d" % (int(round(h * 12)) % 12)


PURE = {(0.0, 0.0, 0.0), (1.0, 1.0, 1.0)}
for m in bpy.data.materials:
    b = next((n for n in m.node_tree.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
    c = tuple(round(v, 3) for v in b.inputs["Base Color"].default_value[:3])
    if c in PURE:
        raise RuntimeError("%s is pure black/white: %s" % (m.name, c))

for name, o in ITEMS.items():
    rep[name] = measure(o)
    me = o.data
    used = {vi for p in me.polygons for vi in p.vertices}
    loose = [v.index for v in me.vertices if v.index not in used]
    if loose:
        raise RuntimeError("%s has %d loose vertices" % (name, len(loose)))
    if not me.materials:
        raise RuntimeError("%s has no material" % name)
    # '주요 색상 3~4개' 는 슬롯 수가 아니라 **색 계열** 수다. 접힘 음영은
    # 같은 색상 계열의 명도 차이로 내라는 지시였으므로 한 계열로 센다.
    fams = {_family(m) for m in me.materials if m}
    if len(fams) > 4:
        raise RuntimeError("%s uses %d colour families %s (3~4개까지)"
                           % (name, len(fams), sorted(fams)))
    rep[name]["colour_families"] = sorted(fams)
    if max(abs(v) for v in o.location) > 1e-6:
        raise RuntimeError("%s origin is not at 0: %s" % (name, list(o.location)))
    # polygon.area 는 편집 모드 조작 뒤 갱신되지 않은 값을 돌려준다 —
    # 멀쩡한 면을 0 으로 보고했다(실측 4개). 좌표로 직접 잰다 (뉴얼 법).
    degen = []
    for poly in me.polygons:
        n = Vector((0.0, 0.0, 0.0))
        vs = [me.vertices[i].co for i in poly.vertices]
        for i, a in enumerate(vs):
            b = vs[(i + 1) % len(vs)]
            n += Vector(((a.y - b.y) * (a.z + b.z),
                         (a.z - b.z) * (a.x + b.x),
                         (a.x - b.x) * (a.y + b.y)))
        if n.length * 0.5 < 1e-9:
            degen.append(poly.index)
    if degen:
        raise RuntimeError("%s has %d zero-area faces" % (name, len(degen)))

rep["scale_reference"] = {"body_height": BODY_H, "phone_longest": PHONE_L,
                          "bevel": BEVEL_S}
rep["total_tris"] = sum(rep[k]["tris"] for k in ITEMS)
rep["materials"] = sorted(m.name for m in bpy.data.materials)

extra = sorted(o.name for o in bpy.data.objects if o.name not in ITEMS)
if extra:
    raise RuntimeError("unexpected objects in scene: %s" % extra)

OUT = os.path.abspath(OUT)
bpy.ops.wm.save_as_mainfile(filepath=OUT)
rep["saved"] = OUT
with open(REPORT, "w") as fh:
    json.dump(rep, fh, indent=1, ensure_ascii=False)
print("ITEMS_BUILD OK ->", OUT)
print(json.dumps(rep, ensure_ascii=False, indent=1))
