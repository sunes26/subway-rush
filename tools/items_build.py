"""ITM 픽업 소품 빌드 — 교통카드(ITM-04) · 마스크(ITM-06) · 우산(ITM-09).

실행:  blender -b --factory-startup --python tools/items_build.py -- <out.blend>

왜 맵에 굽지 않는가
  기존 ITM-05(이어폰)·ITM-14(배터리)는 station_map.blend 안에 놓인 지오메트리라
  **세상에 놓이기만 한다.** 여기 셋은 손에도 들려야 한다 — 카드는 개찰구에
  찍고, 우산은 인파를 비켜세우고, 마스크는 착용한다. 맵에 구우면 그 자리에서
  숨기는 것 말고는 못 한다. 그래서 별도 GLB 로 뽑고 자리는 데이터로 넘긴다.

크기 규약
  캐릭터 전신이 0.888 이고, 기존 소품은 실물보다 1.5배쯤 과장돼 있다
  (PR_Carrier 0.414 = 전신의 47%, 실제 기내용 캐리어는 32%). 치비 양식이라
  실치수를 그대로 넣으면 손에서 사라진다. 같은 과장을 따른다.

원점 규약
  손에 붙일 지점에 원점을 둔다 — 우산은 손잡이, 카드·마스크는 중심.
  lib.meshops.box 가 그렇듯 조립 중에는 원점을 옮기지 않는다.
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

rep = {}


# ------------------------------------------------------------------ 도우미
def cyl(name, p0, p1, r0, r1, seg, mat):
    """p0→p1 테이퍼 원기둥.

    반경은 **회전 적용 전에** 준다. 회전 뒤 월드 XY 로 스케일하면 기울어진
    부품이 전단된다 (군중 측정 때 이걸로 팔이 찌그러졌다).
    """
    a, b = Vector(p0), Vector(p1)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=1.0, depth=d.length,
                                        end_fill_type='TRIFAN', location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    me = o.data
    zs = [v.co.z for v in me.vertices]
    lo, hi = min(zs), max(zs)
    for v in me.vertices:
        t = 0.0 if hi - lo < 1e-9 else (v.co.z - lo) / (hi - lo)
        s = r0 + (r1 - r0) * t
        v.co.x *= s
        v.co.y *= s
    o.location = (a + b) / 2.0
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    set_active(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    o.data.materials.append(mat)
    return o


def slab(name, cen, dim, mat, bevel=0.0018):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=cen)
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    o.scale = dim
    set_active(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel > 0:
        m = o.modifiers.new("Bevel", 'BEVEL')
        m.width = bevel
        m.segments = 1
        m.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier=m.name)
    o.data.materials.append(mat)
    return o


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
            "longest": round(max(d), 4),
            "vs_body_pct": round(100.0 * max(d) / BODY_H, 1),
            "vs_phone_x": round(max(d) / PHONE_L, 2),
            "materials": [m.name for m in o.data.materials if m]}


# ------------------------------------------------------------------ 씬 준비
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = 30
sc.unit_settings.system = 'METRIC'

M_CARD = new_mat("ITM_CardBody", "2E6F8E", 0.42)
M_CHIP = new_mat("ITM_CardChip", "E3C169", 0.32, metallic=0.65)
M_MASK = new_mat("ITM_MaskCloth", "F1F1EC", 0.86)
M_LOOP = new_mat("ITM_MaskLoop", "D8D8D2", 0.90)
M_CANOPY = new_mat("ITM_UmbrellaCanopy", "2B3A5C", 0.62)
M_DARK = new_mat("ITM_Dark", "22242A", 0.48)   # 카드 자기띠·우산 금속부 공용

ITEMS = {}

# ------------------------------------------------- ITM-04 교통카드 (P0)
# 실물 85.6×54mm. 손에 들려야 하므로 기존 소품과 같은 배율로 키운다.
# 원점은 카드 중심 — 개찰구에 찍을 때 손이 카드 가운데를 쥔다.
_cw, _ch, _ct = 0.082, 0.052, 0.0035
_parts = [slab("card_body", (0, 0, 0), (_cw, _ct, _ch), M_CARD, bevel=0.0015)]
# IC 칩 — 앞면 좌상단. 실제 카드의 판별 요소가 이것 하나다.
_parts.append(slab("card_chip", (-_cw * 0.26, -_ct * 0.52, _ch * 0.16),
                   (_cw * 0.20, _ct * 0.35, _ch * 0.26), M_CHIP, bevel=0.0008))
# 뒷면 자기띠 — 실루엣에는 안 잡히지만 뒤집혔을 때 앞뒤가 구분된다.
_parts.append(slab("card_stripe", (0, _ct * 0.52, _ch * 0.30),
                   (_cw * 0.96, _ct * 0.30, _ch * 0.16), M_DARK, bevel=0.0))
ITEMS["ITM04_Card"] = finish("ITM04_Card", _parts)

# ------------------------------------------------- ITM-06 마스크 (P1)
# 상자 세 장을 층층이 쌓아 접힘선을 흉내 냈더니 '계단 쌓인 블록'으로 읽혔다.
# KF94 의 특징은 가로 접힘이 아니라 **세로 능선**이다 — 정면은 둥근 사각형,
# 측면은 앞으로 뾰족한 쐐기. 격자를 직접 짜서 가운데 열을 앞으로 민다.
# 원점은 패널 중심 — 얼굴 본에 붙이면 코·입을 덮는다.
_mw, _mh = 0.086, 0.058
_RIDGE, _EDGE = 0.021, 0.009
_xs = (-0.50, -0.28, 0.0, 0.28, 0.50)
_zs = (-0.50, -0.17, 0.17, 0.50)
_vs, _fs = [], []
for zi, zt in enumerate(_zs):
    for xi, xt in enumerate(_xs):
        # 가운데가 가장 앞으로(-Y) 나오고 가장자리로 갈수록 얼굴 쪽으로 접힌다.
        y = -_RIDGE * (1.0 - (xt / 0.5) ** 2) + _EDGE * abs(zt / 0.5) ** 1.6
        _vs.append((xt * _mw, y, zt * _mh))
for zi in range(len(_zs) - 1):
    for xi in range(len(_xs) - 1):
        i = zi * len(_xs) + xi
        _fs.append((i, i + 1, i + len(_xs) + 1, i + len(_xs)))
_me = bpy.data.meshes.new("mask_panel")
_me.from_pydata(_vs, [], _fs)
_me.update()
_panel = bpy.data.objects.new("mask_panel", _me)
bpy.context.collection.objects.link(_panel)
_panel.data.materials.append(M_MASK)
set_active(_panel)
_sol = _panel.modifiers.new("Solidify", 'SOLIDIFY')   # 한 겹이면 뒤에서 사라진다
_sol.thickness = 0.0022
_sol.offset = 0.0
bpy.ops.object.modifier_apply(modifier=_sol.name)
_parts = [_panel]
# 귀걸이 — 패널 좌우 모서리에서 시작해 뒤(+Y)로 감긴다. 사방으로 뻗으면
# 마스크가 아니라 곤충 더듬이로 보인다. 시작점을 패널 모서리에 물린다.
for sx in (1, -1):
    # 시작점을 패널 **안쪽**에 물린다. 모서리에 딱 맞추면 굵기 차이 때문에
    # 정면에서 붕 뜬 혹처럼 보인다 (실측: x0=0.49 일 때 네 귀에 혹).
    x0 = _mw * 0.45 * sx
    pts = [(x0, _EDGE * 0.1, _mh * 0.32), (x0 + 0.006 * sx, 0.026, _mh * 0.24),
           (x0 + 0.004 * sx, 0.043, 0.0), (x0 + 0.006 * sx, 0.026, -_mh * 0.24),
           (x0, _EDGE * 0.1, -_mh * 0.32)]
    for i in range(len(pts) - 1):
        _parts.append(cyl("mask_loop%s%d" % ("L" if sx > 0 else "R", i),
                          pts[i], pts[i + 1], 0.0027, 0.0027, 5, M_LOOP))
ITEMS["ITM06_Mask"] = finish("ITM06_Mask", _parts)

# ------------------------------------------------- ITM-09 우산 (P1)
# 접힌 장우산. 우산꽂이에 꽂히고, 손에 들려 인파를 비켜세운다.
# **원점을 손잡이 쥐는 자리에 둔다** — 여기가 (0,0,0) 이어야 손에 붙였을 때
# 우산이 손에서 자라난다. 중심에 두면 손 한가운데를 꿰뚫는다.
_ulen = 0.335
_grip_z = 0.0
_shaft_top = _grip_z + _ulen * 0.78
_parts = []
# 손잡이 — J 자 갈고리. 짧은 원기둥 넷으로 꺾는다.
_hook = [(0.0, 0.0, _grip_z - 0.052), (0.0, 0.0, _grip_z + 0.004),
         (0.0, 0.010, _grip_z + 0.020), (0.0, 0.030, _grip_z + 0.024),
         (0.0, 0.046, _grip_z + 0.012)]
for i in range(len(_hook) - 1):
    _parts.append(cyl("umb_h%d" % i, _hook[i], _hook[i + 1], 0.0088, 0.0084, 7, M_DARK))
# 접힌 천 — 아래로 갈수록 굵어지는 방추형. 이게 실루엣의 주인공이다.
_parts.append(cyl("umb_wrapA", (0, 0, _grip_z + 0.030), (0, 0, _grip_z + 0.090),
                  0.0098, 0.0168, 8, M_CANOPY))
_parts.append(cyl("umb_wrapB", (0, 0, _grip_z + 0.090), (0, 0, _shaft_top - 0.020),
                  0.0168, 0.0104, 8, M_CANOPY))
# 천을 묶는 벨트
_parts.append(cyl("umb_band", (0, 0, _grip_z + 0.126), (0, 0, _grip_z + 0.140),
                  0.0164, 0.0161, 8, M_DARK))
# 노출된 대와 끝 석돌
_parts.append(cyl("umb_shaft", (0, 0, _shaft_top - 0.022), (0, 0, _shaft_top + 0.010),
                  0.0060, 0.0048, 6, M_DARK))
_parts.append(cyl("umb_tip", (0, 0, _shaft_top + 0.010), (0, 0, _shaft_top + 0.020),
                  0.0048, 0.0016, 6, M_DARK))
ITEMS["ITM09_Umbrella"] = finish("ITM09_Umbrella", _parts)

# --------------------------------------------------------------------- 검산
for name, o in ITEMS.items():
    rep[name] = measure(o)
    me = o.data
    loose = [v for v in me.vertices if not any(v.index in p.vertices for p in me.polygons)]
    if loose:
        raise RuntimeError("%s has %d loose vertices" % (name, len(loose)))
    if not me.materials:
        raise RuntimeError("%s has no material" % name)
    if max(abs(v) for v in o.location) > 1e-6:
        raise RuntimeError("%s origin is not at 0: %s" % (name, list(o.location)))

rep["scale_reference"] = {"body_height": BODY_H, "phone_longest": PHONE_L}
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
