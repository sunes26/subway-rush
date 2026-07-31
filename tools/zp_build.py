"""ACT-05 좀비폰족(ZP) 소스 빌드.

mc_character.blend 를 열어 MC 계열만 남기고 ZP 로 파생시킨 뒤
assets/zp_character.blend 로 '다른 이름 저장'한다. 원본은 저장하지 않는다.

실행:  blender -b assets/mc_character.blend --python zp_build.py -- <out.blend>
"""
import bpy, sys, os, json, math
from mathutils import Vector, Matrix, Euler

D = math.radians
OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else None
if not OUT:
    raise RuntimeError("output .blend path required after --")
REPORT = os.environ.get("ZP_REPORT", "/tmp/zp_build_report.json")

rep = {}


def need_obj(name):
    o = bpy.data.objects.get(name)
    if o is None:
        raise RuntimeError("Required object not found: %s" % name)
    return o


def need_action(name):
    a = bpy.data.actions.get(name)
    if a is None:
        raise RuntimeError("Required action not found: %s" % name)
    return a


def need_mat(name):
    m = bpy.data.materials.get(name)
    if m is None:
        raise RuntimeError("Required material not found: %s" % name)
    return m


def set_active(obj):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def principled(mat):
    if not mat.node_tree:
        raise RuntimeError("material %s has no node tree" % mat.name)
    n = next((x for x in mat.node_tree.nodes if x.type == 'BSDF_PRINCIPLED'), None)
    if n is None:
        raise RuntimeError("material %s has no Principled BSDF" % mat.name)
    return n


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_lin(h):
    h = h.lstrip("#")
    return tuple(srgb_to_lin(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


# ---------------------------------------------------------------- 0. 사전 검증
MC_MESH = need_obj("MC_Character")
MC_RIG = need_obj("MC_Rig")
ACT_WALK = need_action("Walk")
ACT_IDLE = need_action("Idle")
MC_WHITE = need_mat("MC_White")
AJ_DARK = need_mat("AJ_Dark")
if MC_MESH.parent is not MC_RIG:
    raise RuntimeError("MC_Character is not parented to MC_Rig")
if not any(m.type == 'ARMATURE' for m in MC_MESH.modifiers):
    raise RuntimeError("MC_Character has no Armature modifier")

scene = bpy.context.scene
if scene.render.fps != 30:
    raise RuntimeError("scene fps is %d, expected 30" % scene.render.fps)

rep["source"] = {"mc_verts": len(MC_MESH.data.vertices),
                 "mc_bones": len(MC_RIG.data.bones),
                 "blender": bpy.app.version_string,
                 "file_version": list(bpy.data.version)}

# ------------------------------------------- 1. 재사용할 하체 모션을 먼저 샘플링
LOWER = ["Root", "Hips", "UpperLeg.L", "LowerLeg.L", "Foot.L",
         "UpperLeg.R", "LowerLeg.R", "Foot.R"]
ALL_MC_BONES = [b.name for b in MC_RIG.data.bones]


def sample_action(act, f_start, f_end, bones):
    """액션을 리그에 임시로 얹고 프레임별 pose 값을 읽어 온다."""
    ad = MC_RIG.animation_data or MC_RIG.animation_data_create()
    prev = ad.action
    ad.action = act
    dg = bpy.context.evaluated_depsgraph_get()
    out = {}
    for f in range(f_start, f_end + 1):
        scene.frame_set(f)
        dg.update()
        snap = {}
        for bn in bones:
            pb = MC_RIG.pose.bones.get(bn)
            if pb is None:
                raise RuntimeError("pose bone missing: %s" % bn)
            snap[bn] = {"loc": list(pb.location),
                        "rot": list(pb.rotation_euler),
                        "mode": pb.rotation_mode}
        out[f] = snap
    ad.action = prev
    scene.frame_set(1)
    return out


WALK_LOWER = sample_action(ACT_WALK, 1, 31, LOWER)
IDLE_LOWER = sample_action(ACT_IDLE, 1, 61, LOWER)
BASE_LOWER = {k: dict(v) for k, v in IDLE_LOWER[1].items()}   # 정지 기준 = Idle 1프레임

# 루트모션(수평) 재확인
for nm, samp in (("Walk", WALK_LOWER), ("Idle", IDLE_LOWER)):
    for f, sn in samp.items():
        for bn in ("Root", "Hips"):
            lx, lz = sn[bn]["loc"][0], sn[bn]["loc"][2]
            if abs(lx) > 1e-4 or abs(lz) > 1e-4:
                raise RuntimeError("horizontal root motion in %s f%d %s" % (nm, f, bn))
rep["lower_body_source"] = {"Walk": [1, 31], "Idle": [1, 61], "bones": LOWER}

# ------------------------------------------------------- 2. MC 계열만 남기고 삭제
KEEP_OBJ = {"MC_Character", "MC_Rig", "Camera", "Light", "Fill", "Rim"}
for o in list(bpy.data.objects):
    if o.name not in KEEP_OBJ:
        bpy.data.objects.remove(o, do_unlink=True)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)          # ZP 액션은 아래에서 새로 만든다
for m in list(bpy.data.meshes):
    if m.users == 0:
        bpy.data.meshes.remove(m)
for a in list(bpy.data.armatures):
    if a.users == 0:
        bpy.data.armatures.remove(a)
for im in list(bpy.data.images):
    if im.users == 0 and not im.name.startswith("Render Result"):
        bpy.data.images.remove(im)

# ------------------------------------------------------------------ 3. 이름/원점
rig = need_obj("MC_Rig")
mesh = need_obj("MC_Character")
rig.name = "ZP_Rig"
rig.data.name = "ZP_Rig"
mesh.name = "ZP_Character"
mesh.data.name = "ZP_Character"
rig.location = (0.0, 0.0, 0.0)
rig.rotation_euler = (0.0, 0.0, 0.0)
rig.scale = (1.0, 1.0, 1.0)
mesh.location = (0.0, 0.0, 0.0)
mesh.rotation_euler = (0.0, 0.0, 0.0)
mesh.scale = (1.0, 1.0, 1.0)
bpy.context.view_layer.update()

# ------------------------------------------------------------ 4. Prop.R 본 추가
set_active(rig)
bpy.ops.object.mode_set(mode='EDIT')
eb = rig.data.edit_bones
if "LowerArm.R" not in eb:
    raise RuntimeError("LowerArm.R missing")
parent = eb["LowerArm.R"]
if "Prop.R" in eb:
    raise RuntimeError("Prop.R already exists")
pr = eb.new("Prop.R")
pr.head = parent.tail.copy()
pr.tail = parent.tail + Vector((0.0, 0.0, -0.060))
pr.parent = parent
pr.use_connect = False
pr.use_deform = False
bpy.ops.object.mode_set(mode='OBJECT')
rep["rig"] = {"bones": len(rig.data.bones),
              "names": [b.name for b in rig.data.bones]}

for pb in rig.pose.bones:
    pb.rotation_mode = 'XYZ'

# --------------------------------------------------------------- 5. 머티리얼
HOODIE_HEX = "#7C7F84"          # 무채 계열 중명도 회색
if "ZP_Hoodie" in bpy.data.materials:
    raise RuntimeError("ZP_Hoodie already exists")
hood_mat = bpy.data.materials.new("ZP_Hoodie")
hood_mat.use_nodes = True
b = principled(hood_mat)
b.inputs["Base Color"].default_value = hex_lin(HOODIE_HEX) + (1.0,)
b.inputs["Roughness"].default_value = 0.72      # 면 원단
b.inputs["Metallic"].default_value = 0.0
hood_mat.diffuse_color = hex_lin(HOODIE_HEX) + (1.0,)

screen_mat = bpy.data.materials.new("ZP_Screen")
screen_mat.use_nodes = True
b = principled(screen_mat)
b.inputs["Base Color"].default_value = hex_lin("#BFE6FF") + (1.0,)
b.inputs["Roughness"].default_value = 0.20
b.inputs["Metallic"].default_value = 0.0
if "Emission Color" in b.inputs and "Emission Strength" in b.inputs:
    b.inputs["Emission Color"].default_value = hex_lin("#BFE6FF") + (1.0,)
    b.inputs["Emission Strength"].default_value = 1.6
else:
    raise RuntimeError("Principled BSDF lacks Emission sockets")
screen_mat.diffuse_color = hex_lin("#BFE6FF") + (1.0,)

# ------------------------------------------------------- 6. 머리 치수 실측 → 후드
gi = {g.name: g.index for g in mesh.vertex_groups}
if "Head" not in gi:
    raise RuntimeError("Head vertex group missing")
hidx = gi["Head"]
head_pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices
            if sum(g.weight for g in v.groups if g.group == hidx) > 0.995]
if len(head_pts) < 50:
    raise RuntimeError("head region too small: %d verts" % len(head_pts))
hx = max(abs(p.x) for p in head_pts)
hy_min = min(p.y for p in head_pts); hy_max = max(p.y for p in head_pts)
hz_min = min(p.z for p in head_pts); hz_max = max(p.z for p in head_pts)
head_c = Vector((0.0, (hy_min + hy_max) / 2.0, (hz_min + hz_max) / 2.0))
head_r = Vector((hx, (hy_max - hy_min) / 2.0, (hz_max - hz_min) / 2.0))
rep["head"] = {"n": len(head_pts), "center": [round(v, 4) for v in head_c],
               "radii": [round(v, 4) for v in head_r]}

import bmesh

# 후드는 '두피에 붙은 뚜껑'이 아니라 '머리 위에 덮어쓴 자루'여야 한다.
# 이전 버전은 머리에 1.10배로 딱 붙어서 바가지머리처럼 읽혔다.
# 머리보다 확실히 크게 띄우고, 얼굴 구멍을 크게 내서 얼굴이 안쪽으로
# 들어가 보이게 만든다.
# 얼굴 구멍은 구의 '극점'에 오도록 만든다. 원뿔로 격자를 가로질러 자르면
# 경계가 링을 따르지 않아 테두리가 톱니로 남는다. 극점 기준으로 자르면
# 경계가 위도선 하나와 정확히 일치해 완전한 원이 된다.
FACE_DIR = Vector((0.0, -1.0, -0.30)).normalized()   # 얼굴 구멍이 향하는 방향
FACE_HALF = 62.0                                     # 구멍 반각
HOOD_R = (head_r.x + head_r.y + head_r.z) / 3.0 * 1.28 + 0.010
HOOD_CEN = head_c + Vector((0.0, 0.030, 0.016))

bpy.ops.mesh.primitive_uv_sphere_add(segments=28, ring_count=16, radius=1.0,
                                     location=(0, 0, 0))
hood = bpy.context.active_object
hood.name = "ZP_HoodShell"
hood.data.name = "ZP_HoodShell"

bm = bmesh.new()
bm.from_mesh(hood.data)
_cut = -math.cos(math.radians(FACE_HALF))
kill = [v for v in bm.verts if v.co.z < _cut]
if not kill:
    raise RuntimeError("hood face opening cut removed no vertices")
bmesh.ops.delete(bm, geom=kill, context='VERTS')
loose = [v for v in bm.verts if not v.link_edges]
if loose:
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
bm.to_mesh(hood.data)
bm.free()
hood.data.update()

# -Z(구멍 방향)를 FACE_DIR 로 돌린다
hood.rotation_mode = 'QUATERNION'
hood.rotation_quaternion = Vector((0.0, 0.0, -1.0)).rotation_difference(FACE_DIR)
hood.scale = (HOOD_R, HOOD_R, HOOD_R)        # 균일 스케일 — 회전 후 왜곡 방지
hood.location = HOOD_CEN
set_active(hood)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

bm = bmesh.new()
bm.from_mesh(hood.data)
kill = []
for v in bm.verts:
    d = v.co - HOOD_CEN
    # 머리 비율에 맞춰 월드에서 살짝 늘린다 (균일구 → 계란형)
    v.co.z = HOOD_CEN.z + d.z * 1.07
    v.co.y = HOOD_CEN.y + d.y * 1.03
    # 아래쪽은 머리 회전축 근처에서 끊는다. 더 내리면 고개를 숙일 때
    # 후드가 어깨를 파고든다 — 목 아래는 Chest 에 실린 칼라가 맡는다.
    if v.co.z < 0.688:
        kill.append(v)
if kill:
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
# 뒷목 카울 — 후면(+Y) 볼륨을 키워 자루처럼 늘어지게 한다
for v in bm.verts:
    d = v.co - HOOD_CEN
    if d.y > 0.0:
        k = d.y / HOOD_R
        v.co.y += d.y * 0.40 * k
        if d.z < 0.30 * HOOD_R:
            v.co.z -= 0.020 * k
loose = [v for v in bm.verts if not v.link_edges]
if loose:
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
bm.to_mesh(hood.data)
bm.free()
hood.data.update()
if len(hood.data.vertices) < 120:
    raise RuntimeError("hood shell collapsed: %d verts" % len(hood.data.vertices))

sol = hood.modifiers.new("Thick", 'SOLIDIFY')
sol.thickness = 0.017          # 두꺼워야 얼굴 구멍 테두리가 원단으로 읽힌다
sol.offset = 1.0
set_active(hood)
bpy.ops.object.modifier_apply(modifier=sol.name)
bpy.ops.object.shade_smooth()
hood.data.materials.clear()
hood.data.materials.append(hood_mat)
rep["hood_shell"] = {"head_radii": [round(v, 4) for v in head_r],
                     "verts": len(hood.data.vertices),
                     "radius": round(HOOD_R, 4), "face_opening_half_deg": FACE_HALF}

# 후드 전체를 Head 본에 100% 웨이트
vg = hood.vertex_groups.new(name="Head")
vg.add(range(len(hood.data.vertices)), 1.0, 'REPLACE')
rep["hood"] = {"verts": len(hood.data.vertices),
               "tris": sum(len(p.vertices) - 2 for p in hood.data.polygons)}

# ------------------------------------------------- 6-b. 후드티 몸판(소매 포함)
# 이미 웨이트가 실린 본체를 부분 복제해 법선 방향으로 부풀린다.
# 정점 그룹이 그대로 따라오므로 재바인딩이 전혀 필요 없다 —
# 이 프로젝트에서 가장 잘 깨지는 단계를 통째로 건너뛴다.
HOODIE_OFFSET = 0.0080
HEM_Z = 0.437            # 밑단. 0.40 이면 가랑이 지오메트리가 V 자로 남아 뾰족해진다
CUFF = 0.70              # 아래팔의 몇 %까지 소매로 덮을지. 손은 맨손으로 남긴다

set_active(mesh)
bpy.ops.object.duplicate()
gar = bpy.context.active_object
gar.name = "ZP_HoodieShell"
gar.data.name = "ZP_HoodieShell"
for m in list(gar.modifiers):
    gar.modifiers.remove(m)
gar.parent = None

_gi = {g.name: g.index for g in gar.vertex_groups}
for _n in ("Head", "Spine", "Chest", "Hips", "Shoulder.L", "Shoulder.R",
           "UpperArm.L", "UpperArm.R", "LowerArm.L", "LowerArm.R",
           "UpperLeg.L", "UpperLeg.R", "LowerLeg.L", "LowerLeg.R", "Foot.L", "Foot.R"):
    if _n not in _gi:
        raise RuntimeError("vertex group missing for hoodie cut: %s" % _n)
_LEG = {_gi["UpperLeg.L"], _gi["UpperLeg.R"], _gi["LowerLeg.L"],
        _gi["LowerLeg.R"], _gi["Foot.L"], _gi["Foot.R"]}
_LOWERARM = {"L": _gi["LowerArm.L"], "R": _gi["LowerArm.R"]}
_arm_axis = {}
for side in ("L", "R"):
    bn = rig.data.bones["LowerArm." + side]
    h = bn.head_local.copy()
    d = (bn.tail_local - bn.head_local)
    _arm_axis[side] = (h, d.normalized(), d.length)


def _keep(v):
    """그룹 기준 대략 컷. 밑단·소맷부리 같은 '직선이어야 하는' 경계는
    정점 단위로 자르면 톱니가 남으므로 아래에서 평면 bisect 로 따로 자른다."""
    ws = {g.group: g.weight for g in v.groups if g.weight > 1e-4}
    if not ws:
        return False
    if ws.get(_gi["Head"], 0.0) > 0.30:          # 머리·목은 후드가 덮는다
        return False
    dom = max(ws, key=ws.get)
    if dom in _LEG:
        return False
    if v.co.z < HEM_Z - 0.06:                     # 여유를 두고 대충 잘라 둔다
        return False
    for side, idx in _LOWERARM.items():
        if dom == idx:
            h, d, ln = _arm_axis[side]
            if (v.co - h).dot(d) / ln > CUFF + 0.25:
                return False
    return True


_kill = [v.index for v in gar.data.vertices if not _keep(v)]
if len(_kill) >= len(gar.data.vertices) - 200:
    raise RuntimeError("hoodie cut removed almost everything: %d/%d"
                       % (len(_kill), len(gar.data.vertices)))
bm = bmesh.new()
bm.from_mesh(gar.data)
bm.verts.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.verts[i] for i in _kill], context='VERTS')
bm.verts.ensure_lookup_table()


def _bisect(bm_, co, no, verts_filter=None):
    """평면으로 잘라 normal 반대쪽을 버린다. 밑단이 직선으로 떨어진다."""
    geom = list(bm_.verts) + list(bm_.edges) + list(bm_.faces)
    if verts_filter is not None:
        vs = {v for v in bm_.verts if verts_filter(v)}
        geom = list(vs) + [e for e in bm_.edges if all(v in vs for v in e.verts)] \
               + [f for f in bm_.faces if all(v in vs for v in f.verts)]
        if not geom:
            raise RuntimeError("bisect: empty geometry subset")
    bmesh.ops.bisect_plane(bm_, geom=geom, dist=1e-6,
                           plane_co=co, plane_no=no,
                           clear_inner=True, clear_outer=False)
    bm_.verts.ensure_lookup_table()


# 순서 주의: 부풀린 '뒤에' 잘라야 한다.
# 자른 뒤 법선 방향으로 밀면 밑단 정점마다 법선의 수직 성분이 달라
# 애써 평면으로 자른 밑단이 다시 울퉁불퉁해진다.
bm.normal_update()
for v in bm.verts:
    v.co += v.normal * HOODIE_OFFSET             # 원단 두께만큼 부풀린다
_bisect(bm, Vector((0.0, 0.0, HEM_Z)), Vector((0.0, 0.0, 1.0)))
for _side in ("L", "R"):
    _h, _d, _ln = _arm_axis[_side]
    _cut = _h + _d * (_ln * CUFF)
    _bisect(bm, _cut, -_d, lambda v, _h=_h, _d=_d, _ln=_ln: (v.co - _h).dot(_d) / _ln > 0.15)
bm.normal_update()
loose = [v for v in bm.verts if not v.link_edges]
if loose:
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
bm.to_mesh(gar.data)
bm.free()
gar.data.update()
if len(gar.data.vertices) < 400:
    raise RuntimeError("hoodie shell too small: %d verts" % len(gar.data.vertices))
gar.data.materials.clear()
gar.data.materials.append(hood_mat)         # 슬롯 0 = 후드티 (풀오버라 지퍼 없음)

# ---- 주머니: 몸판 면을 복제해 바깥으로 밀어낸다 ----
# 풀오버 후드티라 지퍼는 없다. 배 앞 캥거루 주머니 융기만 만든다.
# 웨이트가 그대로 따라오므로 별도 리깅이 필요 없고 몸을 정확히 따라간다.
bm = bmesh.new()
bm.from_mesh(gar.data)
bm.faces.ensure_lookup_table()
bm.edges.ensure_lookup_table()
bm.verts.ensure_lookup_table()


def _dup_offset(bm_, pred, dist):
    src = [f for f in bm_.faces if pred(f)]
    if len(src) < 6:
        raise RuntimeError("dup_offset: too few faces (%d)" % len(src))
    geom = list(src)
    seen = set()
    for f in src:
        for e in f.edges:
            if e.index not in seen:
                seen.add(e.index)
                geom.append(e)
    seen_v = set()
    for f in src:
        for v in f.verts:
            if v.index not in seen_v:
                seen_v.add(v.index)
                geom.append(v)
    res = bmesh.ops.duplicate(bm_, geom=geom)
    new_faces = [g for g in res["geom"] if isinstance(g, bmesh.types.BMFace)]
    new_verts = {v for g in res["geom"] if isinstance(g, bmesh.types.BMVert) for v in (g,)}
    for v in new_verts:
        v.co += v.normal * dist
    return new_faces


def _front(f):
    # 밑단에서 아래로 말려 들어가는 면까지 잡으면 지퍼가 가랑이 쪽으로
    # 검은 혀처럼 삐져나온다. 정면을 확실히 향한 면만 쓴다.
    return f.calc_center_median().y < -0.02 and f.normal.y < -0.55


POCKET = _dup_offset(bm, lambda f: _front(f)
                     and 0.455 < f.calc_center_median().z < 0.535
                     and 0.020 < abs(f.calc_center_median().x) < 0.082, 0.0105)
bm.to_mesh(gar.data)
bm.free()
gar.data.update()

set_active(gar)
bpy.ops.object.shade_smooth()
rep["pocket_faces"] = len(POCKET)
rep["hoodie"] = {"verts": len(gar.data.vertices),
                 "tris": sum(len(p.vertices) - 2 for p in gar.data.polygons),
                 "offset_m": HOODIE_OFFSET, "hem_z": HEM_Z, "cuff": CUFF,
                 "color": HOODIE_HEX}

# ---- 칼라: 후드와 몸판 사이 목 구간을 메운다 ----
# 후드는 Head 본에 100% 실려 고개와 함께 통째로 돈다. 목 아래까지 후드를
# 내리면 고개를 숙일 때 어깨를 파고들므로, 그 구간은 Chest 에 실린 칼라가 맡는다.
COL_Z0, COL_Z1 = 0.628, 0.706
bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=1.0, depth=1.0,
                                    location=(0, 0, 0))
col = bpy.context.active_object
col.name = "ZP_Collar"
col.data.name = "ZP_Collar"
bm = bmesh.new()
bm.from_mesh(col.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if abs(f.normal.z) > 0.9], context='FACES')
for v in bm.verts:
    t = 0.5 + v.co.z                       # 0(아래) ~ 1(위)
    r = 0.055 + 0.030 * t                  # 위로 갈수록 벌어진다
    ln = Vector((v.co.x, v.co.y, 0.0)).length
    if ln > 1e-6:
        v.co.x = v.co.x / ln * r
        v.co.y = v.co.y / ln * r * 1.06
    v.co.z = COL_Z0 + (COL_Z1 - COL_Z0) * t
bm.to_mesh(col.data)
bm.free()
col.data.update()
sol2 = col.modifiers.new("Thick", 'SOLIDIFY')
sol2.thickness = 0.014
set_active(col)
bpy.ops.object.modifier_apply(modifier=sol2.name)
bpy.ops.object.shade_smooth()
col.data.materials.clear()
col.data.materials.append(hood_mat)
vgc = col.vertex_groups.new(name="Chest")
vgc.add(range(len(col.data.vertices)), 1.0, 'REPLACE')
rep["collar"] = {"verts": len(col.data.vertices), "z": [COL_Z0, COL_Z1]}

# ---- 조임끈 2가닥: 후드 앞 테두리에서 가슴으로 늘어진다 ----
cords = []
for sgn in (-1, 1):
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.0052, depth=0.100,
                                        location=(sgn * 0.026, -0.089, 0.610))
    c = bpy.context.active_object
    c.name = "ZP_Cord.%s" % ("L" if sgn > 0 else "R")
    c.rotation_euler = (math.radians(-9), 0.0, 0.0)   # 아래쪽이 앞으로 나오게
    set_active(c)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_smooth()
    c.data.materials.clear()
    c.data.materials.append(hood_mat)
    g = c.vertex_groups.new(name="Chest")
    g.add(range(len(c.data.vertices)), 1.0, 'REPLACE')
    cords.append(c)
rep["cords"] = len(cords)

# 본체에 조인 (기존 파이프라인: 액세서리 셸은 *_Character 에 합침)
set_active(mesh)
hood.select_set(True)
gar.select_set(True)
col.select_set(True)
for c in cords:
    c.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.join()
mesh = need_obj("ZP_Character")
if "ZP_Hoodie" not in [m.name for m in mesh.data.materials]:
    raise RuntimeError("hoodie material lost during join")
# 기존 캐릭터 4종에 공통으로 남아 있던 고립 정점 2개(파이프라인 유래)를 ZP 에서는 정리한다.
_bm = bmesh.new()
_bm.from_mesh(mesh.data)
_lo = [v for v in _bm.verts if not v.link_edges]
rep["loose_verts_removed"] = len(_lo)
if _lo:
    bmesh.ops.delete(_bm, geom=_lo, context='VERTS')
_bm.to_mesh(mesh.data)
_bm.free()
mesh.data.update()

# ------------------------------------------------------------- 7. 스마트폰 프롭
PW, PH, PT = 0.052, 0.100, 0.014        # 폭 / 높이 / 두께 (과장)
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
phone = bpy.context.active_object
phone.name = "PR_Phone"
phone.data.name = "PR_Phone"
phone.scale = (PW, PT, PH)          # primitive_cube_add(size=1.0) 은 1.0 폭이다
set_active(phone)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bev = phone.modifiers.new("Round", 'BEVEL')
bev.width = 0.0032
bev.segments = 2
bev.limit_method = 'ANGLE'
bpy.ops.object.modifier_apply(modifier=bev.name)
bpy.ops.object.shade_smooth()

# 화면 패널 (앞면 -Y 쪽에 살짝 띄운 판)
bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0, 0))
scr = bpy.context.active_object
scr.name = "ZP_ScreenPanel"
scr.rotation_euler = (math.radians(90), 0, 0)          # XY평면 → XZ평면
scr.scale = (PW * 0.80, PH * 0.84, 1.0)
scr.location = (0.0, -(PT / 2) - 0.0009, 0.0)
set_active(scr)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
scr.data.materials.clear()
scr.data.materials.append(screen_mat)

phone.data.materials.clear()
phone.data.materials.append(AJ_DARK)
set_active(phone)
scr.select_set(True)
bpy.context.view_layer.objects.active = phone
bpy.ops.object.join()
phone = need_obj("PR_Phone")
dims = list(phone.dimensions)
if not (abs(dims[0] - PW) < 0.002 and abs(dims[2] - PH) < 0.002
        and PT * 0.9 < dims[1] < PT * 1.35):
    raise RuntimeError("phone dimensions off: %s expected ~(%.3f,%.3f,%.3f)"
                       % ([round(v, 4) for v in dims], PW, PT, PH))
rep["phone"] = {"verts": len(phone.data.vertices),
                "tris": sum(len(p.vertices) - 2 for p in phone.data.polygons),
                "dims": [round(v, 4) for v in phone.dimensions],
                "mats": [m.name for m in phone.data.materials]}

# ------------------------------------------------ 8. 팔 포즈 수치 해석 (IK 대용)
dg = bpy.context.evaluated_depsgraph_get()


def apply_pose(vals):
    for bn, rot in vals.items():
        pb = rig.pose.bones.get(bn)
        if pb is None:
            raise RuntimeError("pose bone missing: %s" % bn)
        pb.rotation_euler = Euler([D(x) for x in rot], 'XYZ')
    dg.update()


# 레퍼런스 방향: 등이 C자로 깊게 말리고 머리가 앞으로 튀어나온 "거북목" 자세.
# 목 하나를 꺾지 않고 Hips→Spine→Chest→Head 로 나눠 누적 70도를 만든다.
UPPER_BASE = {"Hips": (6, 0, 0), "Spine": (15, 0, 0),
              "Chest": (20, 0, 0),
              "Head": (float(os.environ.get("ZP_HEAD_BOW", "23")), 0, 0)}
# 하체 기준 포즈(Idle 1프레임) 얹기
for bn, sn in BASE_LOWER.items():
    pb = rig.pose.bones[bn]
    pb.location = sn["loc"]
    pb.rotation_euler = Euler(sn["rot"], 'XYZ')
apply_pose({k: v for k, v in UPPER_BASE.items() if k != "Hips"})
# Hips 는 하체 샘플 회전에 상체 기울기를 더한다
rig.pose.bones["Hips"].rotation_euler.x += D(UPPER_BASE["Hips"][0])
dg.update()


def tip(bone):
    return rig.matrix_world @ rig.pose.bones[bone].tail


def elbow(bone):
    return rig.matrix_world @ rig.pose.bones[bone].head


def solve_arm(side, hand_target, elbow_target):
    ua, la = "UpperArm." + side, "LowerArm." + side
    par = [0.0] * 6

    def cost(p):
        rig.pose.bones[ua].rotation_euler = Euler([D(p[0]), D(p[1]), D(p[2])], 'XYZ')
        rig.pose.bones[la].rotation_euler = Euler([D(p[3]), D(p[4]), D(p[5])], 'XYZ')
        dg.update()
        c = (tip(la) - hand_target).length ** 2
        c += 0.30 * (elbow(la) - elbow_target).length ** 2
        c += 1e-6 * sum(x * x for x in p)
        return c

    step = 24.0
    best = cost(par)
    for _ in range(9):
        improved = True
        while improved:
            improved = False
            for i in range(6):
                for s in (step, -step):
                    trial = list(par)
                    trial[i] += s
                    if abs(trial[i]) > 150:
                        continue
                    c = cost(trial)
                    if c < best - 1e-12:
                        best, par, improved = c, trial, True
        step *= 0.5
    cost(par)
    return par, math.sqrt(max(best, 0.0))


# 상체를 깊게 굽히면 어깨 위치가 크게 이동하므로 손 목표를 월드 절대좌표로
# 못 박지 않고, 굽힌 뒤의 '머리 위치 + 시선 방향'에서 역산한다.
hb = rig.pose.bones["Head"]
rest_head = rig.data.bones["Head"].matrix_local
head_ctr = rig.matrix_world @ ((hb.head + hb.tail) / 2.0)
delta = (hb.matrix @ rest_head.inverted()).to_3x3()
gaze = (delta @ Vector((0.0, -1.0, 0.0))).normalized()   # rest 정면(-Y)에 포즈 회전 적용
PHONE_AIM = head_ctr + gaze * 0.170
rep["gaze"] = {"head_center": [round(v, 4) for v in head_ctr],
               "dir": [round(v, 4) for v in gaze],
               "phone_aim": [round(v, 4) for v in PHONE_AIM]}

# 폰을 사이에 두고 오른손은 아래, 왼손은 위 — 실루엣 비대칭
from mathutils.kdtree import KDTree


_HOODIE_SLOT = [i for i, m in enumerate(mesh.data.materials)
                if m and m.name == "ZP_Hoodie"]
if not _HOODIE_SLOT:
    raise RuntimeError("ZP_Hoodie material slot not found")
_HOODIE_SLOT = _HOODIE_SLOT[0]
_HOODIE_VERTS = {vi for p in mesh.data.polygons
                 if p.material_index == _HOODIE_SLOT for vi in p.vertices}


def hand_surface(side, thr=0.6):
    """현재 포즈에서 맨손 표면 정점의 월드 좌표.

    소매(후드티 셸)도 같은 LowerArm 웨이트를 갖고 있으므로 반드시 빼야 한다.
    소매에 스냅하면 폰이 원단 안으로 들어가 안 보인다.
    """
    idx = gi["LowerArm." + side]
    dgh = bpy.context.evaluated_depsgraph_get()
    dgh.update()
    ev = mesh.evaluated_get(dgh)
    pts = [mesh.matrix_world @ ev.data.vertices[v.index].co
           for v in mesh.data.vertices
           if v.index not in _HOODIE_VERTS
           and sum(g.weight for g in v.groups if g.group == idx) > thr]
    if len(pts) < 50:
        raise RuntimeError("bare hand region too small for %s: %d" % (side, len(pts)))
    return pts


def kdtree_of(pts):
    t = KDTree(len(pts))
    for i, p in enumerate(pts):
        t.insert(p, i)
    t.balance()
    return t


def nearest_gap(mat, tree):
    """폰을 mat 에 놓았을 때 (최단거리, 폰쪽 점, 손쪽 점)."""
    best = (1e9, None, None)
    for v in phone.data.vertices:
        w = mat @ v.co
        co, _, d = tree.find(w)
        if d < best[0]:
            best = (d, w, co)
    return best


def snap_to_hand(center, basis, tree, embed):
    """폰이 손 표면에 닿을 때까지 밀어 넣는다. embed 만큼 더 파묻어 '쥔' 느낌을 만든다.

    블롭 캐릭터는 손가락이 없어서, 살짝 파묻혀야만 쥐고 있는 걸로 읽힌다.
    """
    c = center.copy()
    last_dir = None
    d0, _, _ = nearest_gap(Matrix.Translation(c) @ basis, tree)
    for _ in range(80):
        d, pp, hp = nearest_gap(Matrix.Translation(c) @ basis, tree)
        if pp is None:
            raise RuntimeError("snap_to_hand: no nearest point")
        if d <= 5e-4:
            break
        last_dir = (hp - pp).normalized()
        c += last_dir * d
    else:
        raise RuntimeError("snap_to_hand did not converge (gap %.4f)" % d)
    if last_dir is None:
        raise RuntimeError("snap_to_hand: phone already overlapping, cannot orient embed")
    c += last_dir * embed          # 접촉 직전 방향으로 더 밀어 파묻는다
    return c, d0


HAND_R = PHONE_AIM + Vector((-0.047, 0.014, -0.031))
HAND_L = PHONE_AIM + Vector((0.047, 0.020, 0.013))
# 위팔은 몸을 따라 축 늘어뜨리고 아래팔만 폰으로 올린다 (레퍼런스의 긴 팔)
sh_r = rig.matrix_world @ rig.pose.bones["UpperArm.R"].head
sh_l = rig.matrix_world @ rig.pose.bones["UpperArm.L"].head
ELB_R = sh_r + Vector((-0.052, 0.004, -0.132))
ELB_L = sh_l + Vector((0.052, 0.004, -0.132))
pr_r, err_r = solve_arm("R", HAND_R, ELB_R)
pr_l, err_l = solve_arm("L", HAND_L, ELB_L)
UPPER_BASE["UpperArm.R"] = tuple(round(x, 2) for x in pr_r[:3])
UPPER_BASE["LowerArm.R"] = tuple(round(x, 2) for x in pr_r[3:])
UPPER_BASE["UpperArm.L"] = tuple(round(x, 2) for x in pr_l[:3])
UPPER_BASE["LowerArm.L"] = tuple(round(x, 2) for x in pr_l[3:])
UPPER_BASE["Shoulder.L"] = (0, 0, 0)
UPPER_BASE["Shoulder.R"] = (0, 0, 0)
UPPER_BASE["Prop.R"] = (0, 0, 0)
apply_pose({k: v for k, v in UPPER_BASE.items() if k != "Hips"})
rep["arm_solve"] = {"R": {"params": UPPER_BASE["UpperArm.R"] + UPPER_BASE["LowerArm.R"],
                          "residual_m": round(err_r, 5),
                          "hand_world": [round(v, 4) for v in tip("LowerArm.R")]},
                    "L": {"params": UPPER_BASE["UpperArm.L"] + UPPER_BASE["LowerArm.L"],
                          "residual_m": round(err_l, 5),
                          "hand_world": [round(v, 4) for v in tip("LowerArm.L")]}}

# ------------------------------------------------ 9. 폰을 Prop.R 본에 부착 (역산)
hR, hL = tip("LowerArm.R"), tip("LowerArm.L")
head_world = rig.matrix_world @ rig.pose.bones["Head"].tail
phone_c = (hR + hL) / 2.0 * 0.68 + PHONE_AIM * 0.32 + Vector((0.0, -0.012, 0.004))
n = (head_world - phone_c).normalized()          # 화면이 바라볼 방향
# 머리를 그대로 겨누면 폰이 거의 수평으로 눕고 뒤쪽 모서리가 가슴을 파고든다.
# 전방(-Y)에서 잰 기울기를 MAX_TILT 로 제한해 세워 든 실루엣을 유지한다.
# 사용자 요청: 화면이 얼굴을 정면으로 보게 한다 = 폰 면과 얼굴 면이 평행.
# 시선 방향을 그대로 법선으로 쓰므로 사실상 클램프를 풀어 둔 값이다.
# 폰 기울기: 전방 수평(-Y)에서 잰 절대 목표각으로 지정한다.
# 상한(clamp)으로 두면 조준값(=시선과 완전 평행, 81.7도)을 넘는 값을 줘도
# 조준값에 머물러 실제로는 안 눕는다.
#   0   = 수직 (화면이 정면을 봄)
#   81.7= 시선과 완전 평행 (화면이 얼굴을 정면으로 봄)
#   90  = 완전 수평 (화면이 하늘을 봄)
PHONE_TILT = float(os.environ.get('ZP_PHONE_TILT', '85'))
fwd = Vector((0.0, -1.0, 0.0))
aimed = math.degrees(n.angle(fwd))
axis = fwd.cross(n)
if axis.length < 1e-6:
    raise RuntimeError("cannot set phone tilt: degenerate axis")
n = (Matrix.Rotation(D(PHONE_TILT), 4, axis.normalized()) @ fwd).normalized()
rep["phone_tilt_deg"] = {"aimed_face_parallel": round(aimed, 2),
                         "applied": PHONE_TILT}
yax = -n                                          # 로컬 +Y = 화면 뒷면
xr = Vector((1.0, 0.0, 0.0))
xax = (xr - yax * xr.dot(yax)).normalized()
zax = xax.cross(yax)
basis = Matrix((
    (xax.x, yax.x, zax.x),
    (xax.y, yax.y, zax.y),
    (xax.z, yax.z, zax.z),
)).to_4x4()
basis = basis @ Matrix.Rotation(D(7.0), 4, 'Y')   # 살짝 비틀어 대칭 깨기

# 오른손 표면에 실제로 닿을 때까지 밀어 넣는다.
# 본 꼬리 기준 거리만 보면 붙어 보이지만 실제로는 38mm 떠 있었다 —
# 블롭은 손가락이 없어서 표면끼리 파묻혀야만 '쥔' 것으로 읽힌다.
# 폰만 손으로 끌어내리면 시선 조준점에서 멀어져 폰이 아래로 처진다.
# 간격의 65% 는 손이 올라와서 메우고 35% 만 폰이 양보하도록 반복 수렴시킨다.
GRIP_EMBED = 0.006
gap_before = None
for _gi_it in range(4):
    tree_r = kdtree_of(hand_surface("R"))
    new_c, gap = snap_to_hand(phone_c, basis, tree_r, GRIP_EMBED)
    if gap_before is None:
        gap_before = gap
    delta = new_c - phone_c
    if delta.length < 0.004:
        phone_c = new_c
        break
    HAND_R -= delta * 0.65                    # 손을 폰 쪽으로 끌어올린다
    pr_r, err_r = solve_arm("R", HAND_R, ELB_R)
    UPPER_BASE["UpperArm.R"] = tuple(round(x, 2) for x in pr_r[:3])
    UPPER_BASE["LowerArm.R"] = tuple(round(x, 2) for x in pr_r[3:])
    apply_pose({k: v for k, v in UPPER_BASE.items() if k != "Hips"})
    phone_c = phone_c + delta * 0.35
else:
    tree_r = kdtree_of(hand_surface("R"))
    phone_c, _ = snap_to_hand(phone_c, basis, tree_r, GRIP_EMBED)
desired = Matrix.Translation(phone_c) @ basis
rep["grip_R"] = {"gap_before_m": round(gap_before, 4), "embed_m": GRIP_EMBED,
                 "iterations": _gi_it + 1,
                 "phone_center": [round(v, 4) for v in phone_c],
                 "aim_point": [round(v, 4) for v in PHONE_AIM]}

# 폰이 오른손으로 끌려갔으니 왼손 목표를 다시 잡아 폰 왼쪽 모서리에 붙인다.
xax_w = (basis.to_3x3() @ Vector((1.0, 0.0, 0.0))).normalized()
zax_w = (basis.to_3x3() @ Vector((0.0, 0.0, 1.0))).normalized()
tgt_l = phone_c + xax_w * (PW * 0.52) + zax_w * (-PH * 0.10)
for _it in range(6):
    pr_l, err_l = solve_arm("L", tgt_l, ELB_L)
    UPPER_BASE["UpperArm.L"] = tuple(round(x, 2) for x in pr_l[:3])
    UPPER_BASE["LowerArm.L"] = tuple(round(x, 2) for x in pr_l[3:])
    apply_pose({k: v for k, v in UPPER_BASE.items() if k != "Hips"})
    tree_l = kdtree_of(hand_surface("L"))
    d_l, pp_l, hp_l = nearest_gap(desired, tree_l)
    if d_l <= 0.0035:
        break
    tgt_l += (pp_l - hp_l).normalized() * (d_l * 0.9)
else:
    raise RuntimeError("left hand did not reach the phone (gap %.4f)" % d_l)
rep["grip_L"] = {"gap_m": round(d_l, 4), "iterations": _it + 1,
                 "residual_m": round(err_l, 5)}

# 한손 변형 — 오른손과 폰은 그대로 두고 왼팔만 몸 옆으로 내린다.
# ACT-05 는 Z2/Z4 에 여러 개체가 동시에 스폰되므로, 같은 메시로 파지 방식만
# 갈라 두면 코드가 개체별로 골라 쓸 수 있다.
HANG_L = sh_l + Vector((0.030, 0.012, -0.258))
HANG_ELB_L = sh_l + Vector((0.050, 0.004, -0.130))
pr_hang, err_hang = solve_arm("L", HANG_L, HANG_ELB_L)
UPPER_1H = dict(UPPER_BASE)
UPPER_1H["UpperArm.L"] = tuple(round(x, 2) for x in pr_hang[:3])
UPPER_1H["LowerArm.L"] = tuple(round(x, 2) for x in pr_hang[3:])
apply_pose({k: v for k, v in UPPER_1H.items() if k != "Hips"})
_hang_tip = tip("LowerArm.L")
_torso_pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices
              if sum(g.weight for g in v.groups
                     if g.group in (gi["Spine"], gi["Chest"], gi["Hips"],
                                    gi["UpperLeg.L"])) > 0.85]
_hang_gap = min((_hang_tip - q).length for q in _torso_pts)
if _hang_gap < 0.012:
    raise RuntimeError("one-hand left arm too close to body: %.4f" % _hang_gap)
rep["one_hand"] = {"params": UPPER_1H["UpperArm.L"] + UPPER_1H["LowerArm.L"],
                   "residual_m": round(err_hang, 5),
                   "hand_world": [round(v, 4) for v in _hang_tip],
                   "body_gap_m": round(_hang_gap, 4)}
# 기본 포즈로 복귀
apply_pose({k: v for k, v in UPPER_BASE.items() if k != "Hips"})

pb_prop = rig.pose.bones["Prop.R"]
bone_len = rig.data.bones["Prop.R"].length
parent_mat = rig.matrix_world @ pb_prop.matrix @ Matrix.Translation((0.0, bone_len, 0.0))
local = parent_mat.inverted() @ desired

phone.parent = rig
phone.parent_type = 'BONE'
phone.parent_bone = "Prop.R"
phone.matrix_parent_inverse = Matrix.Identity(4)
phone.matrix_basis = local
bpy.context.view_layer.update()
dg.update()
# 기본 포즈에서 폰이 본체를 파고들지 않는지 즉시 검증
from mathutils.bvhtree import BVHTree
_dgx = bpy.context.evaluated_depsgraph_get()
_dgx.update()
_me = mesh.evaluated_get(_dgx)
_hs = [i for i, m in enumerate(mesh.data.materials) if m and m.name == "ZP_Hoodie"][0]
_vs = [mesh.matrix_world @ v.co for v in _me.data.vertices]
_tr = []
for _p in _me.data.polygons:
    if _p.material_index == _hs:
        continue
    _iv = list(_p.vertices)
    for _k in range(1, len(_iv) - 1):
        _tr.append((_iv[0], _iv[_k], _iv[_k + 1]))
_bvh = BVHTree.FromPolygons([tuple(v) for v in _vs], _tr, all_triangles=True)
_pe = phone.evaluated_get(_dgx)
_pw = [phone.matrix_world @ v.co for v in _pe.data.vertices]


def _inside(pt):
    """+X 레이 히트 수가 홀수면 본체 내부."""
    o = Vector(pt)
    d = Vector((1.0, 0.0, 0.0))
    h = 0
    for _ in range(64):
        r = _bvh.ray_cast(o, d)
        if r[0] is None:
            break
        h += 1
        o = r[0] + d * 1e-4
    return h % 2 == 1


# 폰은 손에 닿아 있는 게 정상이므로 '팔까지 포함한 최단거리'는 판정 기준이 못 된다.
# (a) 본체 볼륨 내부로 들어간 정점이 없을 것  (b) 몸통과 충분히 떨어져 있을 것
_gi_arm = {gi["LowerArm.L"], gi["LowerArm.R"]}


def _dom_group(vi):
    g = max(mesh.data.vertices[vi].groups, key=lambda x: x.weight, default=None)
    return g.group if g else -1


def _is_grip(pt):
    """가장 가까운 본체 면이 아래팔(=손)이면 의도한 그립 접촉이다."""
    hit = _bvh.find_nearest(pt)
    if hit[0] is None:
        return False
    return all(_dom_group(v) in _gi_arm for v in _tr[hit[2]])


# 폰은 손에 6mm 파묻혀 있어야 쥔 것으로 읽힌다. 손 접촉은 관통이 아니다.
_pen = [p for p in _pw if _inside(p) and not _is_grip(p)]
if _pen:
    raise RuntimeError("phone penetrates body (non-hand) in base pose: %d verts" % len(_pen))
_gt = {gi["Spine"], gi["Chest"], gi["Hips"]}
_torso = [mesh.matrix_world @ v.co for v in _me.data.vertices
          if sum(g.weight for g in v.groups if g.group in _gt) > 0.85]
if len(_torso) < 100:
    raise RuntimeError("torso region too small: %d" % len(_torso))
_dmin = min(min((p - q).length for q in _torso) for p in _pw)
if _dmin < 0.020:
    raise RuntimeError("phone too close to torso in base pose: %.4f m" % _dmin)
rep["phone_body_clearance_m"] = {"penetrating_verts": _pen, "min_dist_to_torso": round(_dmin, 5)}
rep["phone_attach"] = {
    "parent_bone": "Prop.R",
    "loc": [round(v, 5) for v in phone.location],
    "rot_deg": [round(math.degrees(v), 3) for v in phone.rotation_euler],
    "scale": [round(v, 4) for v in phone.scale],
    "world_center": [round(v, 4) for v in phone_c],
    "dist_to_headtip": round((head_world - phone_c).length, 4),
    "dist_hand_R": round((hR - phone_c).length, 4),
    "dist_hand_L": round((hL - phone_c).length, 4),
}

# --------------------------------------------- 9-b. 화면 불빛 (프리뷰 전용 라이트)
# 레퍼런스의 핵심 연출인 '화면 불빛이 얼굴을 비추는' 상태를 만든다.
# 익스포트 대상 선택(리그·본체·폰)에 들어가지 않으므로 GLB/FBX 에는 나가지 않는다.
# 엔진에서는 각자 라이트를 붙여야 한다.
if "ZP_ScreenGlow" in bpy.data.objects:
    raise RuntimeError("ZP_ScreenGlow already exists")
_ld = bpy.data.lights.new("ZP_ScreenGlow", type='POINT')
_ld.energy = 6.0
_ld.color = hex_lin("#BFE6FF")
_ld.shadow_soft_size = 0.035
glow = bpy.data.objects.new("ZP_ScreenGlow", _ld)
scene.collection.objects.link(glow)
glow.parent = phone
glow.matrix_parent_inverse = Matrix.Identity(4)
glow.location = (0.0, -0.030, 0.012)      # 폰 로컬 -Y = 화면이 향하는 쪽
rep["screen_glow"] = {"energy": _ld.energy, "parent": "PR_Phone",
                      "exported": False}

# ------------------------------------------------------------- 10. 액션 생성
def new_action(name):
    if name in bpy.data.actions:
        raise RuntimeError("action name collision: %s" % name)
    a = bpy.data.actions.new(name)
    a.use_fake_user = True
    return a


UPPER_BONES = ["Spine", "Chest", "Head", "Shoulder.L", "UpperArm.L", "LowerArm.L",
               "Shoulder.R", "UpperArm.R", "LowerArm.R", "Prop.R"]
KEYED = LOWER + UPPER_BONES


def base_upper(bn, variant=None):
    tbl = UPPER_1H if variant == "1h" else UPPER_BASE
    return list(tbl.get(bn, (0, 0, 0)))


def write_action(name, nframes, framefunc):
    """framefunc(f) -> {bone: {'loc':[..] or None, 'rot':[deg,deg,deg]}}"""
    act = new_action(name)
    ad = rig.animation_data or rig.animation_data_create()
    ad.action = act
    for f in range(1, nframes + 1):
        scene.frame_set(f)
        data = framefunc(f)
        for bn in KEYED:
            pb = rig.pose.bones[bn]
            d = data.get(bn, {})
            pb.location = d.get("loc", (0.0, 0.0, 0.0))
            pb.rotation_euler = Euler([D(x) for x in d.get("rot", (0, 0, 0))], 'XYZ')
            pb.keyframe_insert("location", frame=f)
            pb.keyframe_insert("rotation_euler", frame=f)
    ad.action = None
    scene.frame_set(1)
    return act


def lower_from(sample, f):
    out = {}
    for bn, sn in sample[f].items():
        out[bn] = {"loc": list(sn["loc"]),
                   "rot": [math.degrees(x) for x in sn["rot"]]}
    return out


def add_upper(d, f, n, style, variant=None):
    """상체 = ZP 기본 포즈 + 스타일별 미세 변조. 양팔은 항상 동일 델타."""
    t = (f - 1) / float(n)          # 0..1 (loop 이면 f=n+1 이 f=1 과 동일)
    tau = 2 * math.pi * t
    for bn in UPPER_BONES:
        d.setdefault(bn, {})["rot"] = base_upper(bn, variant)
    if style == "walk":
        d["Head"]["rot"] = [base_upper("Head", variant)[0] + 2.2 * math.sin(tau * 2),
                            2.5 * math.sin(tau),
                            3.0 * math.sin(tau)]
        d["Chest"]["rot"] = [base_upper("Chest", variant)[0] + 1.2 * math.sin(tau * 2),
                             0.0, -2.2 * math.sin(tau)]
        d["Spine"]["rot"] = [base_upper("Spine", variant)[0], 0.0, 3.5 * math.sin(tau)]
        sway = 1.6 * math.sin(tau * 2)
        for s in ("R", "L"):
            for bn in ("UpperArm." + s, "LowerArm." + s):
                r = list(base_upper(bn, variant))
                r[0] += sway
                d[bn]["rot"] = r
    elif style == "idle":
        br = 1.1 * math.sin(tau)
        d["Head"]["rot"] = [base_upper("Head", variant)[0] + 1.4 * math.sin(tau) + 1.0 * math.sin(tau * 3),
                            1.2 * math.sin(tau * 2), 0.0]
        d["Chest"]["rot"] = [base_upper("Chest", variant)[0] + br, 0.0, 0.0]
        d["Spine"]["rot"] = [base_upper("Spine", variant)[0] + br * 0.6, 0.0, 0.0]
        thumb = 2.6 * max(0.0, math.sin(tau * 4)) ** 3
        r = list(base_upper("LowerArm.L", variant)); r[0] -= thumb
        d["LowerArm.L"]["rot"] = r
        for bn in ("UpperArm.R", "LowerArm.R", "UpperArm.L"):
            r = list(base_upper(bn, variant)); r[0] += br * 0.8
            d[bn]["rot"] = r
    return d


def f_walk(f):
    d = lower_from(WALK_LOWER, f)
    return add_upper(d, f, 30, "walk")


def f_idle(f):
    d = lower_from(IDLE_LOWER, f)
    return add_upper(d, f, 60, "idle")


def lerp(a, b, u):
    return a + (b - a) * u


def ease(u):
    return u * u * (3 - 2 * u)


def keyed_curve(f, keys):
    """keys = [(frame, value), ...] 선형+ease 보간"""
    if f <= keys[0][0]:
        return keys[0][1]
    for i in range(len(keys) - 1):
        f0, v0 = keys[i]
        f1, v1 = keys[i + 1]
        if f0 <= f <= f1:
            u = ease((f - f0) / float(f1 - f0)) if f1 > f0 else 0.0
            return lerp(v0, v1, u)
    return keys[-1][1]


def pose_blend(d, f, offsets):
    """기본 포즈에 축별 오프셋 커브를 더한다. offsets = {bone: {axis: [(f,val)..]}}"""
    for bn in UPPER_BONES + ["Hips"]:
        if bn == "Hips":
            continue
        d.setdefault(bn, {})["rot"] = base_upper(bn)
    for bn, axes in offsets.items():
        if bn == "Hips":
            base = d["Hips"]["rot"]
        else:
            base = list(d.get(bn, {}).get("rot", base_upper(bn)))
        for ax, keys in axes.items():
            base[ax] += keyed_curve(f, keys)
        d.setdefault(bn, {})["rot"] = base
    return d


BUMP_N = 19
BUMP = {
    "Head":  {0: [(1, 0), (4, -30), (9, -26), (14, -8), (19, 0)]},
    "Chest": {0: [(1, 0), (4, -13), (9, -9), (14, -3), (19, 0)]},
    "Spine": {0: [(1, 0), (4, -7), (9, -5), (14, -2), (19, 0)]},
    "Hips":  {0: [(1, 0), (4, -5), (9, -3), (14, -1), (19, 0)]},
    "UpperArm.R": {0: [(1, 0), (4, 12), (9, 8), (14, 2), (19, 0)],
                   2: [(1, 0), (4, -9), (9, -6), (14, -1), (19, 0)]},
    "UpperArm.L": {0: [(1, 0), (4, 12), (9, 8), (14, 2), (19, 0)],
                   2: [(1, 0), (4, 9), (9, 6), (14, 1), (19, 0)]},
    "LowerArm.R": {0: [(1, 0), (4, 10), (9, 7), (14, 2), (19, 0)]},
    "LowerArm.L": {0: [(1, 0), (4, 10), (9, 7), (14, 2), (19, 0)]},
}
BUMP_LEG = {
    "UpperLeg.R": {0: [(1, 0), (4, 10), (9, 13), (14, 5), (19, 0)]},
    "LowerLeg.R": {0: [(1, 0), (4, -6), (9, -10), (14, -4), (19, 0)]},
    "UpperLeg.L": {0: [(1, 0), (4, -6), (9, -8), (14, -3), (19, 0)]},
    "LowerLeg.L": {0: [(1, 0), (4, 4), (9, 6), (14, 2), (19, 0)]},
}
ASIDE_N = 41
ASIDE = {
    "Head":  {0: [(1, 0), (9, -21), (16, -19), (24, -6), (33, -2), (41, 0)],
              2: [(1, 0), (9, 4), (16, 10), (24, 6), (33, 2), (41, 0)]},
    # 상체 트위스트는 6/11 → 4/7 로 낮췄다. 원래 값에서는 f31 에서 폰이
    # 몸통을 2정점 파고들었다 (검사기 적발).
    "Chest": {0: [(1, 0), (9, -7), (16, -6), (24, -2), (41, 0)],
              2: [(1, 0), (16, 4), (24, 7), (33, 4), (41, 0)]},
    "Spine": {2: [(1, 0), (16, 3), (24, 5), (33, 3), (41, 0)]},
    # 왼팔 복귀는 바깥으로 우회시킨다. 직선 복귀 경로에서는 f31 에 아래팔이
    # 폰을 0.5~1.0mm 스쳤다 (검사기 적발, 관통 지점을 LowerArm.L 로 특정).
    "LowerArm.L": {0: [(1, 0), (12, -34), (18, -38), (26, -18), (34, -7), (41, 0)],
                   2: [(1, 0), (12, 16), (18, 18), (26, 10), (34, 4), (41, 0)]},
    "UpperArm.L": {0: [(1, 0), (12, -14), (18, -16), (26, -8), (34, -3), (41, 0)],
                   2: [(1, 0), (12, -8), (18, -9), (26, -5), (34, -2), (41, 0)]},
}
ASIDE_LEG = {
    "UpperLeg.L": {2: [(1, 0), (18, 0), (26, 13), (33, 9), (41, 0)]},
    "UpperLeg.R": {2: [(1, 0), (18, 0), (26, 5), (33, 3), (41, 0)]},
    "Hips": {2: [(1, 0), (18, 0), (26, 7), (33, 5), (41, 0)]},
}


def make_once(offsets_upper, offsets_leg, n):
    def fn(f):
        d = {}
        for bn, sn in BASE_LOWER.items():
            d[bn] = {"loc": list(sn["loc"]),
                     "rot": [math.degrees(x) for x in sn["rot"]]}
        d["Hips"]["rot"][0] += UPPER_BASE["Hips"][0]
        for bn, axes in offsets_leg.items():
            for ax, keys in axes.items():
                d[bn]["rot"][ax] += keyed_curve(f, keys)
        return pose_blend(d, f, offsets_upper)
    return fn


def f_walk_1h(f):
    d = lower_from(WALK_LOWER, f)
    return add_upper(d, f, 30, "walk", "1h")


def f_idle_1h(f):
    d = lower_from(IDLE_LOWER, f)
    return add_upper(d, f, 60, "idle", "1h")


a_walk = write_action("ZP_Walk", 31, f_walk)
a_idle = write_action("ZP_Idle", 61, f_idle)
a_bump = write_action("ZP_Bump", BUMP_N, make_once(BUMP, BUMP_LEG, BUMP_N))
a_aside = write_action("ZP_MoveAside", ASIDE_N, make_once(ASIDE, ASIDE_LEG, ASIDE_N))
a_walk1 = write_action("ZP_Walk1H", 31, f_walk_1h)
a_idle1 = write_action("ZP_Idle1H", 61, f_idle_1h)

rep["actions"] = []
for a in (a_walk, a_idle, a_bump, a_aside, a_walk1, a_idle1):
    nf = 0
    for layer in a.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                nf += len(cb.fcurves)
    if nf == 0:
        raise RuntimeError("action %s has no fcurves" % a.name)
    rep["actions"].append({"name": a.name, "range": list(a.frame_range), "fcurves": nf})

# 기본 표시 포즈 = ZP_Idle 1프레임
ad = rig.animation_data or rig.animation_data_create()
ad.action = a_idle
scene.frame_set(1)
bpy.context.view_layer.update()

# ------------------------------------------------------------- 11. 정리 & 저장
scene.frame_start = 1
scene.frame_end = 61
for o in bpy.data.objects:
    o.select_set(False)

rep["objects"] = [{"name": o.name, "type": o.type,
                   "loc": [round(v, 5) for v in o.location],
                   "parent": o.parent.name if o.parent else None,
                   "parent_bone": o.parent_bone or None,
                   "mods": [(m.name, m.type) for m in o.modifiers],
                   "mats": [m.name for m in o.data.materials] if o.type == 'MESH' else None,
                   "verts": len(o.data.vertices) if o.type == 'MESH' else None,
                   "tris": sum(len(p.vertices) - 2 for p in o.data.polygons) if o.type == 'MESH' else None}
                  for o in bpy.data.objects]

bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(OUT), copy=False)
rep["saved"] = os.path.abspath(OUT)
with open(REPORT, "w") as fh:
    json.dump(rep, fh, indent=1, ensure_ascii=False)
print("ZP BUILD OK ->", OUT)
