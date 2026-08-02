"""ITM 픽업 소품 빌드 — 교통카드(ITM-04) · 마스크(ITM-06) · 우산(ITM-09).

실행:  blender -b --factory-startup --python tools/items_build.py -- <out.blend>

왜 맵에 굽지 않는가
  기존 ITM-05(이어폰)·ITM-14(배터리)는 station_map.blend 안에 놓인 지오메트리라
  **세상에 놓이기만 한다.** 여기 셋은 손에도 들려야 한다 — 카드는 개찰구에
  찍고, 우산은 인파를 비켜세우고, 마스크는 착용한다. 맵에 구우면 그 자리에서
  숨기는 것 말고는 못 한다. 그래서 별도 GLB 로 뽑고 자리는 데이터로 넘긴다.

공통 기준
  * 실루엣만으로 정체가 읽혀야 한다. 표면 디테일보다 외곽선에 폴리곤을 쓴다.
  * 베벨은 BEVEL_S 하나로 통일한다. 부품마다 다른 값을 주면 같은 물건인데
    부위별로 다른 재질처럼 보인다.
  * 의미 없는 작은 돌출은 넣지 않는다. 멀리서 안 보이면 폴리곤 낭비다.
  * 재질은 부위 기능이 갈리는 곳에서만 나눈다 (천 / 금속 / 플라스틱).

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
def _mesh(name, verts, faces, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    return o


def _apply(o, mod):
    set_active(o)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def solidify(o, thickness, offset=0.0):
    m = o.modifiers.new("Solidify", 'SOLIDIFY')
    m.thickness = thickness
    m.offset = offset
    _apply(o, m)
    return o


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
    """가운데가 (0,0) 인 라운드 사각형 외곽선 (x, z). 반시계 방향.

    네 귀를 같은 반지름·같은 분할로 돈다 — 귀마다 다르면 '정리되지 않은
    모서리'로 읽힌다.
    """
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


def plate(name, w, h, r, thick, mat, seg=3, y=0.0):
    """XZ 평면의 라운드 사각형 판. y 를 중심으로 thick 만큼 두껍다."""
    verts = [(x, y, z) for x, z in round_rect(w, h, r, seg)]
    o = _mesh(name, verts, [tuple(range(len(verts)))], mat)
    solidify(o, thick, offset=0.0)
    return o


def tube(name, pts, radius, seg, mat):
    """점 목록을 잇는 튜브. 정점을 직접 놓는다 — 실린더를 회전 적용한 뒤
    월드 XY 로 반경을 주면 기울어진 구간이 전단된다."""
    P = [Vector(p) for p in pts]
    if len(P) < 2:
        raise RuntimeError("tube needs >= 2 points")
    verts, faces = [], []
    up = Vector((0.0, 0.0, 1.0))
    for i, p in enumerate(P):
        d = P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]
        if d.length < 1e-9:
            d = Vector((0.0, 0.0, 1.0))
        d.normalize()
        ref = up if abs(d.dot(up)) < 0.95 else Vector((1.0, 0.0, 0.0))
        u = d.cross(ref).normalized()
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


def lobed(name, rings, seg, mat, lobe=0.0):
    """(z, radius) 고리를 쌓은 회전체. lobe>0 이면 반경이 한 칸씩 번갈아 줄어
    세로 골이 생긴다 — 접힌 우산천의 '덩어리감'이 이걸로 읽힌다."""
    verts, faces = [], []
    for z, r in rings:
        for k in range(seg):
            a = 2.0 * math.pi * k / seg
            rr = r * (1.0 - lobe * (k % 2))
            verts.append((rr * math.cos(a), rr * math.sin(a), z))
    for i in range(len(rings) - 1):
        for k in range(seg):
            a, b = i * seg + k, i * seg + (k + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    faces.append(tuple(range(seg - 1, -1, -1)))
    base = (len(rings) - 1) * seg
    faces.append(tuple(range(base, base + seg)))
    return _mesh(name, verts, faces, mat)


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

M_CARD = new_mat("ITM_CardBody", "2C6E8C", 0.44)
M_CARD2 = new_mat("ITM_CardAccent", "8FCBDD", 0.40)
M_CHIP = new_mat("ITM_CardChip", "D9B25E", 0.30, metallic=0.70)
M_DARK = new_mat("ITM_Dark", "20222A", 0.46)
M_CLOTH = new_mat("ITM_MaskCloth", "EFEFE9", 0.94)          # 부직포 — 완전 무광
M_LOOP = new_mat("ITM_MaskLoop", "E2E2DC", 0.92)
M_CANOPY = new_mat("ITM_UmbrellaCanopy", "2A3A5E", 0.78)    # 천
M_METAL = new_mat("ITM_UmbrellaMetal", "9AA0A8", 0.34, metallic=0.80)
M_GRIP = new_mat("ITM_UmbrellaGrip", "23252B", 0.52)        # 플라스틱

ITEMS = {}

# ============================================== ITM-04 교통카드 (P0)
# 실물 85.6×54×0.76mm. 두께는 실물 비율로 얇게(장변의 2.6%), 가로세로는
# 손에 들려야 하므로 기존 소품과 같은 배율로 키운다.
# 원점은 카드 중심 — 개찰구에 찍을 때 손이 카드 가운데를 쥔다.
CW, CH, CT = 0.084, 0.053, 0.0022
CR = 0.0042                       # 네 귀 라운딩 (실물 3.18mm 와 같은 비율)
_PROUD = 0.00022                  # 면 위에 얹는 높이. 0 이면 Z-파이팅으로 지글거린다
_fy = -CT / 2.0 - _PROUD

_body = plate("card_body", CW, CH, CR, CT, M_CARD, seg=3)
# 베벨은 본체에만. 두께 0.0004 짜리 장식 판에 걸면 면이 통째로 무너진다
# (실측: 영-면적 면 36개).
bevel(_body, BEVEL_S * 0.5, 1)
_parts = [_body]

# 앞면 그래픽 — 아래쪽 컬러 블록 + 가는 선 둘. 브랜드·로고는 넣지 않는다.
_band = plate("card_band", CW * 0.99, CH * 0.28, CR * 0.45, _PROUD * 2, M_CARD2, seg=2, y=_fy)
_band.location = (0.0, 0.0, -CH * 0.33)
_parts.append(_band)
for i, zc in enumerate((CH * 0.02, CH * 0.13)):
    _ln = plate("card_line%d" % i, CW * 0.40, 0.0019, 0.0005, _PROUD * 2, M_CARD2, seg=1, y=_fy)
    _ln.location = (CW * 0.24, 0.0, zc)
    _parts.append(_ln)

# IC 칩 — 앞면 좌상단. 얇고 정돈된 라운드 사각형으로 거의 면에 붙인다.
_chip = plate("card_chip", CW * 0.17, CH * 0.24, 0.0012, _PROUD * 3, M_CHIP, seg=2, y=_fy)
_chip.location = (-CW * 0.28, 0.0, CH * 0.17)
_parts.append(_chip)

# 뒷면 자기띠 — 실루엣에는 안 잡히지만 앞뒤가 구분된다.
_stripe = plate("card_stripe", CW * 0.98, CH * 0.15, 0.0007, _PROUD * 2, M_DARK, seg=1,
                y=CT / 2.0 + _PROUD)
_stripe.location = (0.0, 0.0, CH * 0.28)
_parts.append(_stripe)

ITEMS["ITM04_Card"] = finish("ITM04_Card", _parts)

# ============================================== ITM-06 마스크 (P1)
# 일회용 부직포 마스크. 상자를 쌓아 접힘선을 흉내 냈더니 '계단 블록'이 됐고,
# 격자 한 겹만으로는 '휜 판때기'였다. 셋을 동시에 만족해야 마스크로 읽힌다 —
#   ① 코가 앞으로 나오고 좌우가 뒤로 감긴다 (가로 곡률)
#   ② 위·아래가 얼굴 쪽으로 말린다, 특히 턱선 (세로 곡률)
#   ③ 가로 주름 3개 (세로 방향 삼각파)
MW, MH = 0.090, 0.062
NOSE, TUCK, CHIN, PLEAT = 0.020, 0.013, 1.7, 0.0034
NCOL, NROW = 7, 10
_vs, _fs = [], []
for ri in range(NROW):
    zt = ri / (NROW - 1.0) - 0.5                      # -0.5(아래) ~ +0.5(위)
    curl = TUCK * (abs(zt) / 0.5) ** 2 * (CHIN if zt < 0 else 1.0)
    t = 3.0 * (zt + 0.5)                              # 세로 3주기
    pleat = PLEAT * (2.0 * abs(t - round(t)) - 0.5)
    for ci in range(NCOL):
        xt = ci / (NCOL - 1.0) - 0.5
        wrap = -NOSE * (1.0 - (xt / 0.5) ** 2)        # 가운데가 앞(-Y)
        narrow = 1.0 - 0.32 * max(0.0, -zt)           # 턱쪽으로 좁아지는 사다리꼴
        _vs.append((xt * MW * narrow, wrap + curl + pleat, zt * MH))
for ri in range(NROW - 1):
    for ci in range(NCOL - 1):
        i = ri * NCOL + ci
        _fs.append((i, i + 1, i + NCOL + 1, i + NCOL))
_panel = _mesh("mask_panel", _vs, _fs, M_CLOTH)
solidify(_panel, 0.0016, offset=0.0)                  # 부직포 한 장 두께
_parts = [_panel]

# 귀걸이 — 얇고 부드러운 고리. 각진 프레임처럼 보이면 안 되므로 점을 촘촘히
# 놓고 단면은 5각으로 줄인다 (멀리서 원형으로 읽힌다).
for sx in (1, -1):
    x0 = MW * 0.44 * sx
    arc = [(x0 + 0.005 * sx * math.sin(math.pi * i / 6.0),
            0.004 + 0.040 * math.sin(math.pi * i / 6.0),
            math.cos(math.pi * i / 6.0) * MH * 0.33) for i in range(7)]
    _parts.append(tube("mask_loop%s" % ("L" if sx > 0 else "R"), arc, 0.0013, 4, M_LOOP))
ITEMS["ITM06_Mask"] = finish("ITM06_Mask", _parts)

# ============================================== ITM-09 우산 (P1)
# 접힌 장우산. 이전 것은 가늘고 길어 펜처럼 보였다. 짧고 굵게 가고,
# 천 뭉치에 세로 골(lobe)을 넣어 '접힌 원단 덩어리'로 읽히게 한다.
# 손잡이는 직선형 하나로 정리했다 — J 갈고리는 작은 돌출만 늘리고 멀리서
# 손잡이로 안 읽혔다.
# **원점을 손잡이 쥐는 자리에 둔다** — 여기가 (0,0,0) 이어야 손에 붙였을 때
# 우산이 손에서 자라난다. 중심에 두면 손 한가운데를 꿰뚫는다.
# 손잡이는 **J자 갈고리**로 간다. 직선 그립을 가는 목에 붙였더니 다트처럼
# 보였다 — 우산을 우산으로 만드는 건 캐노피가 아니라 이 갈고리다.
# 캐노피는 원뿔이 아니라 거의 평행한 '묶음'이다. 위로 좁아지게 하면 펜이 된다.
# 곧은 대 + 반원 갈고리. 점을 촘촘히 놓아야 꺾임이 각지지 않는다.
HOOK = [(0.0, 0.0, 0.030), (0.0, 0.0, -0.014)]
_HR, _HC = 0.026, -0.030          # 갈고리 반지름 · 원 중심 z
for _i in range(1, 8):
    _a = math.pi * _i / 7.0
    HOOK.append((0.0, _HR * (1.0 - math.cos(_a)), _HC - _HR * math.sin(_a) * 0.62))
CAN_LO, CAN_HI = 0.048, 0.253
_parts = [
    tube("umb_hook", HOOK, 0.0090, 6, M_GRIP),
    lobed("umb_shaft", [(0.026, 0.0052), (CAN_LO + 0.004, 0.0052)], 6, M_METAL),
    lobed("umb_canopy", [(CAN_LO, 0.0182), (CAN_LO + 0.026, 0.0212),
                         (CAN_LO + 0.100, 0.0216), (CAN_HI - 0.020, 0.0206),
                         (CAN_HI, 0.0176)], 6, M_CANOPY, lobe=0.20),
    # 고정 밴드 — 천을 묶고 있는 것이 보이게 천보다 굵게 두른다.
    lobed("umb_band", [(CAN_LO + 0.060, 0.0230), (CAN_LO + 0.078, 0.0230)], 6, M_GRIP),
    # 끝 석돌 — 짧게. 바늘처럼 길면 우산이 아니라 창이 된다.
    lobed("umb_ferrule", [(CAN_HI, 0.0064), (CAN_HI + 0.013, 0.0032)], 6, M_METAL),
]
for _p in _parts:
    bevel(_p, BEVEL_S, 1)
ITEMS["ITM09_Umbrella"] = finish("ITM09_Umbrella", _parts)

# --------------------------------------------------------------------- 검산
for name, o in ITEMS.items():
    rep[name] = measure(o)
    me = o.data
    used = {vi for p in me.polygons for vi in p.vertices}
    loose = [v.index for v in me.vertices if v.index not in used]
    if loose:
        raise RuntimeError("%s has %d loose vertices" % (name, len(loose)))
    if not me.materials:
        raise RuntimeError("%s has no material" % name)
    if max(abs(v) for v in o.location) > 1e-6:
        raise RuntimeError("%s origin is not at 0: %s" % (name, list(o.location)))
    degen = [p.index for p in me.polygons if p.area < 1e-10]
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
