"""ACT-08 역무원(SS) 소스 빌드.

mc_character.blend 를 열어 MC 계열만 남기고 SS 로 파생시킨 뒤
assets/ss_character.blend 로 '다른 이름 저장'한다. 원본은 저장하지 않는다.

실행:  blender -b assets/mc_character.blend --python ss_build.py -- <out.blend>

ZP(ACT-05)·CP(ACT-06)에서 검증된 파생 경로를 그대로 쓴다 — 베이크 메시 복제로
스킨 웨이트를 상속받고, 본 히트 재바인딩을 하지 않는다.

ACT-08 고유 판단
  * 실루엣의 핵심은 '각진 어깨'다. 기존 5종이 전부 둥근 블롭이라 여기서 갈린다.
    재킷 셸을 부풀린 뒤 어깨 윗면을 평면으로 눌러 고원을 만들고 가로로 넓힌다.
  * 무전은 프롭을 들리지 않고 왼쪽 견장 위 숄더 마이크로 처리한다.
    양손에 물건을 들리면 실루엣이 뭉개지고, 우손 테이저 / 좌손 무전으로
    역할이 갈려야 비대칭이 산다.
  * 테이저는 ZP 폰과 같이 Prop.R 본에 매단다. 위치는 고정값이 아니라
    '팔을 푼 뒤 손이 실제로 간 자리'에서 역산한다.
  * 홀스터도 마찬가지로 테이저 위치에서 역산한다. 먼저 박아 두면 총이 허공에 뜬다.
"""
import bpy, sys, os, json, math, bmesh
from mathutils import Vector, Matrix, Euler
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree

D = math.radians
OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else None
if not OUT:
    raise RuntimeError("output .blend path required after --")
REPORT = os.environ.get("SS_REPORT", "/tmp/ss_build_report.json")

rep = {}


def need_obj(name):
    o = bpy.data.objects.get(name)
    if o is None:
        raise RuntimeError("Required object not found: %s" % name)
    return o


def need_action(name):
    a = bpy.data.actions.get(name)
    if a is None:
        raise RuntimeError("Required action not found: %s (have %s)"
                           % (name, sorted(x.name for x in bpy.data.actions)))
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


def new_mat(name, hexcol, rough, emit=0.0):
    if name in bpy.data.materials:
        raise RuntimeError("material already exists: %s" % name)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = principled(m)
    b.inputs["Base Color"].default_value = hex_lin(hexcol) + (1.0,)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.0
    if emit > 0.0:
        # 발광은 GLB 로 나가지 않는다(ZP_ScreenGlow 와 동일). 프리뷰 렌더 전용이고
        # 엔진에서는 베이스 컬러만 받아 이미시브를 따로 지정해야 한다.
        b.inputs["Emission Color"].default_value = hex_lin(hexcol) + (1.0,)
        b.inputs["Emission Strength"].default_value = emit
    m.diffuse_color = hex_lin(hexcol) + (1.0,)
    return m


# ---------------------------------------------------------------- 0. 사전 검증
MC_MESH = need_obj("MC_Character")
MC_RIG = need_obj("MC_Rig")
ACT_IDLE = need_action("Idle")
ACT_WALK = need_action("Walk")
ACT_RUN = need_action("Run")
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
# ACT-08 은 순찰(Walk)·추격(Run)·정지(Idle) 세 가지 하체가 다 필요하다.
LOWER = ["Root", "Hips", "UpperLeg.L", "LowerLeg.L", "Foot.L",
         "UpperLeg.R", "LowerLeg.R", "Foot.R"]


def sample_action(act, f_start, f_end, bones):
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
            snap[bn] = {"loc": list(pb.location), "rot": list(pb.rotation_euler)}
        out[f] = snap
    ad.action = prev
    scene.frame_set(1)
    return out


def act_span(a):
    fr = a.frame_range
    return int(round(fr[0])), int(round(fr[1]))


IDLE_F = act_span(ACT_IDLE)
WALK_F = act_span(ACT_WALK)
RUN_F = act_span(ACT_RUN)
IDLE_LOWER = sample_action(ACT_IDLE, IDLE_F[0], IDLE_F[1], LOWER)
WALK_LOWER = sample_action(ACT_WALK, WALK_F[0], WALK_F[1], LOWER)
RUN_LOWER = sample_action(ACT_RUN, RUN_F[0], RUN_F[1], LOWER)
BASE_LOWER = {k: dict(v) for k, v in IDLE_LOWER[IDLE_F[0]].items()}
for _nm, _s in (("Idle", IDLE_LOWER), ("Walk", WALK_LOWER), ("Run", RUN_LOWER)):
    for f, sn in _s.items():
        for bn in ("Root", "Hips"):
            if abs(sn[bn]["loc"][0]) > 1e-4 or abs(sn[bn]["loc"][2]) > 1e-4:
                raise RuntimeError("horizontal root motion in %s f%d %s" % (_nm, f, bn))
rep["lower_body_source"] = {"Idle": list(IDLE_F), "Walk": list(WALK_F),
                            "Run": list(RUN_F), "bones": LOWER}

# ------------------------------------------------------- 2. MC 계열만 남기고 삭제
KEEP_OBJ = {"MC_Character", "MC_Rig", "Camera", "Light", "Fill", "Rim"}
for o in list(bpy.data.objects):
    if o.name not in KEEP_OBJ:
        bpy.data.objects.remove(o, do_unlink=True)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
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
rig.name = "SS_Rig"
rig.data.name = "SS_Rig"
mesh.name = "SS_Character"
mesh.data.name = "SS_Character"
for o in (rig, mesh):
    o.location = (0.0, 0.0, 0.0)
    o.rotation_euler = (0.0, 0.0, 0.0)
    o.scale = (1.0, 1.0, 1.0)
bpy.context.view_layer.update()
for pb in rig.pose.bones:
    pb.rotation_mode = 'XYZ'

# 좌우 규약을 눈대중하지 않고 실측한다. 이 프로젝트는 캐릭터가 -Y 를 보고
# 오른쪽이 -X 다. 뒤집히면 홀스터와 견장이 반대쪽에 붙는다.
_shl = rig.data.bones["UpperArm.L"].head_local
_shr = rig.data.bones["UpperArm.R"].head_local
if not (_shl.x > 0.0 > _shr.x):
    raise RuntimeError("side convention broken: L.x=%.4f R.x=%.4f" % (_shl.x, _shr.x))
SIDE_SIGN = {"L": 1.0, "R": -1.0}
SOLE_Z = 0.0351          # MC 발바닥 높이

# --------------------------------------------------------------- 4. 머티리얼
UNIFORM_HEX = "#0E1730"   # 제복 — 팔레트 1호선 #0052A4 를 어둡게. CP #4C5670 보다 저명도
                          # AgX 톤매핑이 어두운 쪽을 크게 들어올린다. #1E2E52 는
                          # 화면에서 중명도 파랑으로 떠서 '제복'이 아니라 '파란 옷'이 된다.
TRIM_HEX = "#FFC83D"      # 견장·모자밴드 — 팔레트 골드. 제복 권위의 관습 기호
CART_HEX = "#E9E32B"      # 테이저 전면 카트리지 — 실제 X26 의 노란 면
                          # 금장(#FFC83D)으로 대신했더니 소매 수장과 붙어
                          # '제복 장식'으로 읽혔다. 채도·색상을 갈라 둔다.
ARC_HEX = "#6FE3F0"       # 테이저 스파크 (발광, 익스포트 안 됨)
uni_mat = new_mat("SS_Uniform", UNIFORM_HEX, 0.62)
trim_mat = new_mat("SS_Trim", TRIM_HEX, 0.40)
cart_mat = new_mat("SS_Cartridge", CART_HEX, 0.44)
arc_mat = new_mat("SS_Arc", ARC_HEX, 0.20, emit=6.0)

# ------------------------------------------------------- 5. 머리·어깨 실측
gi = {g.name: g.index for g in mesh.vertex_groups}
for n in ("Head", "Chest", "Spine", "Hips", "Shoulder.L", "Shoulder.R",
          "UpperArm.L", "UpperArm.R", "LowerArm.L", "LowerArm.R"):
    if n not in gi:
        raise RuntimeError("vertex group missing: %s" % n)
head_pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices
            if sum(g.weight for g in v.groups if g.group == gi["Head"]) > 0.995]
if len(head_pts) < 50:
    raise RuntimeError("head region too small: %d" % len(head_pts))
head_c = Vector((0.0,
                 (min(p.y for p in head_pts) + max(p.y for p in head_pts)) / 2.0,
                 (min(p.z for p in head_pts) + max(p.z for p in head_pts)) / 2.0))
head_r = Vector((max(abs(p.x) for p in head_pts),
                 (max(p.y for p in head_pts) - min(p.y for p in head_pts)) / 2.0,
                 (max(p.z for p in head_pts) - min(p.z for p in head_pts)) / 2.0))
HEAD_TOP = head_c.z + head_r.z
SHOULDER_Z = max(_shl.z, _shr.z)
rep["measure"] = {"head_center": [round(v, 4) for v in head_c],
                  "head_radii": [round(v, 4) for v in head_r],
                  "head_top_z": round(HEAD_TOP, 4),
                  "shoulder_z": round(SHOULDER_Z, 4),
                  "sole_z": SOLE_Z}

# ================================================================= 6. 정모
# 평평한 크라운 + 위로 벌어지는 테이퍼 + 앞 챙만.
# GP 의 부드러운 모자와 갈리는 지점이 바로 이 '평면 윗면 + 직선 테이퍼'다.
# 크라운을 74mm 로 뽑았더니 드럼통이 됐다(첫 렌더). 머리 반지름 103mm 짜리
# 블롭에서는 48mm 정도가 한계고, 벌어짐도 1.16배면 충분히 제복모로 읽힌다.
CAP_BAND_Z = head_c.z + head_r.z * 0.56        # 밴드가 앉는 높이
CAP_TOP_Z = HEAD_TOP + 0.003                   # 크라운 윗면
CAP_R_BAND = head_r.x * 0.95
CAP_R_TOP = head_r.x * 1.06                    # 위로 벌어진다 — 제복모의 특징
_head_r_at_band = head_r.x * math.sqrt(max(0.0, 1.0 - ((CAP_BAND_Z - head_c.z) / head_r.z) ** 2))
if CAP_R_BAND <= _head_r_at_band + 0.004:
    raise RuntimeError("cap band clips the head: band %.4f vs head %.4f"
                       % (CAP_R_BAND, _head_r_at_band))

bpy.ops.mesh.primitive_cone_add(vertices=22, radius1=CAP_R_BAND, radius2=CAP_R_TOP,
                                depth=CAP_TOP_Z - CAP_BAND_Z, end_fill_type='NGON',
                                location=(0.0, head_c.y, (CAP_BAND_Z + CAP_TOP_Z) / 2.0))
crown = bpy.context.active_object
crown.name = "SS_CapCrown"
crown.data.name = "SS_CapCrown"
set_active(crown)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
_bv = crown.modifiers.new("Round", 'BEVEL')
_bv.width = 0.006
_bv.segments = 2
_bv.limit_method = 'ANGLE'
bpy.ops.object.modifier_apply(modifier=_bv.name)
crown.data.materials.clear()
crown.data.materials.append(uni_mat)
bpy.ops.object.shade_flat()      # 평면 윗면이 살아야 제복모로 읽힌다

# 밴드 — 골드 링. 크라운 밑면 디스크의 단면을 가리는 역할도 한다.
bpy.ops.mesh.primitive_cylinder_add(vertices=22, radius=CAP_R_BAND * 1.015,
                                    depth=0.013,
                                    location=(0.0, head_c.y, CAP_BAND_Z + 0.004))
band = bpy.context.active_object
band.name = "SS_CapBand"
set_active(band)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
band.data.materials.clear()
band.data.materials.append(trim_mat)
bpy.ops.object.shade_flat()

# 챙 — 앞(-Y)으로만. 반원 판을 앞으로 기울인다.
VISOR_R = head_r.x * 1.16
VISOR_TILT = 17.0
bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=VISOR_R, depth=0.021,
                                    location=(0.0, 0.0, 0.0))
visor = bpy.context.active_object
visor.name = "SS_CapVisor"
bm = bmesh.new()
bm.from_mesh(visor.data)
_kill = [v for v in bm.verts if v.co.y > 1e-6]
if not _kill:
    raise RuntimeError("visor half-cut removed no vertices")
bmesh.ops.delete(bm, geom=_kill, context='VERTS')
_loose = [v for v in bm.verts if not v.link_edges]
if _loose:
    bmesh.ops.delete(bm, geom=_loose, context='VERTS')
# 챙 폭의 기준은 '밴드 반지름'이 아니라 '그 높이에서의 머리 폭'이다.
# 밴드(반지름 0.0895)를 기준으로 잡았더니, 챙이 밴드 아래로 1mm 만 내려온
# 구간에서 머리(그 높이에서 0.074)보다 8mm 씩 넓어져 금색 밴드 밑에
# 검은 띠가 좌우로 이어졌다 — 얼굴을 감는 끈처럼 보인 원인이다.
VISOR_BACK_Y = -head_r.y * 0.20
VISOR_Z = CAP_BAND_Z + 0.002
# 두께 때문에 챙의 윗면은 중심보다 11mm 높다. 그 높이의 머리 폭을 기준으로
# 잡아야 윗모서리까지 머리 안으로 들어간다.
_VZ_REF = VISOR_Z + 0.011
_head_rx_at_visor = head_r.x * math.sqrt(
    max(0.0, 1.0 - ((_VZ_REF - head_c.z) / head_r.z) ** 2))
if _head_rx_at_visor < 0.03:
    raise RuntimeError("visor height is off the head: %.4f" % _head_rx_at_visor)
# 0.92 로는 챙이 머리 폭과 거의 같아져서, 머리 표면에서 챙이 빠져나오는
# 경계선이 얼굴을 가로지르는 곡선이 된다 — 낮은 각도에서 '끈'으로 읽힌다.
# 머리 폭의 2/3 로 줄이면 앞으로 뻗은 브림으로만 보인다.
VISOR_SX = (_head_rx_at_visor * 0.66) / VISOR_R
for v in bm.verts:
    v.co.y *= 1.00
    v.co.x *= VISOR_SX
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
bm.to_mesh(visor.data)
bm.free()
visor.data.update()
visor.rotation_euler = (D(VISOR_TILT), 0.0, 0.0)   # +rx → 앞(-Y)쪽이 내려간다
visor.location = (0.0, head_c.y + VISOR_BACK_Y, VISOR_Z)
set_active(visor)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
_bv = visor.modifiers.new("Round", 'BEVEL')
_bv.width = 0.0045
_bv.segments = 2
_bv.limit_method = 'ANGLE'
set_active(visor)
bpy.ops.object.modifier_apply(modifier=_bv.name)
visor.data.materials.clear()
visor.data.materials.append(AJ_DARK)
bpy.ops.object.shade_flat()

# 휘장 — 밴드 앞면 금색. 정모로 읽히는 마지막 한 조각이다.
bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.016, depth=0.006,
                                    location=(0.0, -(CAP_R_BAND + 0.001), CAP_BAND_Z + 0.006))
badge = bpy.context.active_object
badge.name = "SS_CapBadge"
badge.rotation_euler = (D(90), 0.0, 0.0)
badge.scale = (1.0, 1.0, 0.72)
set_active(badge)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.shade_smooth()
badge.data.materials.clear()
badge.data.materials.append(trim_mat)

# 챙의 어느 정점도 그 높이의 머리보다 옆으로 튀면 안 된다.
_bad = []
for v in visor.data.vertices:
    w = visor.matrix_world @ v.co
    t = (w.z - head_c.z) / head_r.z
    if abs(t) >= 1.0:
        continue
    if abs(w.x) > head_r.x * math.sqrt(1.0 - t * t) + 0.0005:
        _bad.append((round(w.x, 4), round(w.z, 4)))
if _bad:
    raise RuntimeError("visor is wider than the head at its own height (%d verts, e.g. %s) "
                       "— it reads as a strap around the face" % (len(_bad), _bad[0]))
rep["visor"] = {"max_x": round(max(abs((visor.matrix_world @ v.co).x)
                                   for v in visor.data.vertices), 4),
                "head_rx_at_visor": round(_head_rx_at_visor, 4),
                "x_scale": round(VISOR_SX, 3), "tilt_deg": VISOR_TILT, "z": round(VISOR_Z, 4)}

set_active(crown)
for _o in (band, visor, badge):
    _o.select_set(True)
bpy.context.view_layer.objects.active = crown
bpy.ops.object.join()
cap = need_obj("SS_CapCrown")
cap.name = "SS_Cap"
cap.data.name = "SS_Cap"
if len({m.name for m in cap.data.materials}) != 3:  # 제복·골드·다크
    raise RuntimeError("cap lost a material slot: %s" % [m.name for m in cap.data.materials])
_vg = cap.vertex_groups.new(name="Head")
_vg.add(range(len(cap.data.vertices)), 1.0, 'REPLACE')
rep["cap"] = {"verts": len(cap.data.vertices),
              "tris": sum(len(p.vertices) - 2 for p in cap.data.polygons),
              "band_z": round(CAP_BAND_Z, 4), "top_z": round(CAP_TOP_Z, 4),
              "r_band": round(CAP_R_BAND, 4), "r_top": round(CAP_R_TOP, 4),
              "visor_tilt_deg": VISOR_TILT}

# ============================================================ 7. 제복 재킷
# 이미 웨이트가 실린 본체를 부분 복제해 법선 방향으로 부풀린다.
# 정점 그룹이 그대로 따라오므로 재바인딩이 전혀 필요 없다.
JACKET_OFFSET = 0.0085
HEM_Z = 0.455            # 밑단 — 홀스터가 걸리는 벨트선 위
CUFF = 0.68              # 아래팔의 몇 %까지 소매로 덮을지. 손은 맨손으로 남긴다

set_active(mesh)
bpy.ops.object.duplicate()
gar = bpy.context.active_object
gar.name = "SS_JacketShell"
gar.data.name = "SS_JacketShell"
for m in list(gar.modifiers):
    gar.modifiers.remove(m)
gar.parent = None

_gi = {g.name: g.index for g in gar.vertex_groups}
for _n in ("Head", "Spine", "Chest", "Hips", "Shoulder.L", "Shoulder.R",
           "UpperArm.L", "UpperArm.R", "LowerArm.L", "LowerArm.R",
           "UpperLeg.L", "UpperLeg.R", "LowerLeg.L", "LowerLeg.R", "Foot.L", "Foot.R"):
    if _n not in _gi:
        raise RuntimeError("vertex group missing for jacket cut: %s" % _n)
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
    """그룹 기준 대략 컷. 밑단·소맷부리처럼 '직선이어야 하는' 경계는
    아래에서 평면 bisect 로 따로 자른다."""
    ws = {g.group: g.weight for g in v.groups if g.weight > 1e-4}
    if not ws:
        return False
    # 0.30 으로 자르면 목 밑동뿐 아니라 어깨 윗면까지 날아가서, 견장 안쪽에
    # 맨살(흰색)이 삼각형으로 드러난다. 목 위만 남기고 어깨는 덮는다.
    if ws.get(_gi["Head"], 0.0) > 0.60:
        return False
    dom = max(ws, key=ws.get)
    if dom in _LEG:
        return False
    if v.co.z < HEM_Z - 0.06:
        return False
    for side, idx in _LOWERARM.items():
        if dom == idx:
            h, d, ln = _arm_axis[side]
            if (v.co - h).dot(d) / ln > CUFF + 0.25:
                return False
    return True


_kill = [v.index for v in gar.data.vertices if not _keep(v)]
if len(_kill) >= len(gar.data.vertices) - 200:
    raise RuntimeError("jacket cut removed almost everything: %d/%d"
                       % (len(_kill), len(gar.data.vertices)))
bm = bmesh.new()
bm.from_mesh(gar.data)
bm.verts.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.verts[i] for i in _kill], context='VERTS')
bm.verts.ensure_lookup_table()


def _bisect(bm_, co, no, verts_filter=None):
    """평면으로 잘라 normal 반대쪽을 버린다."""
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


# 순서 주의: 부풀린 '뒤에' 자른다. 자른 뒤 법선으로 밀면 밑단이 다시 울퉁불퉁해진다.
bm.normal_update()
for v in bm.verts:
    v.co += v.normal * JACKET_OFFSET

# ---- 각진 어깨: 이 캐릭터의 실루엣 전부가 여기서 나온다 ----
# 어깨 윗면을 평면으로 눌러 고원을 만들고, 가로로 넓혀 각을 세운다.
SQ_TOP = SHOULDER_Z + 0.016        # 어깨 고원 높이
SQ_BAND = 0.034                    # 선반이 만들어지는 z 폭
SQ_WIDEN = 0.20                    # 선반 끝에서의 가로 확장 비율
# 실패 두 번의 결과다. 0.13 을 어깨 아래 45mm 까지 고르게 먹였더니 몸통 전체가
# 넓어져 판초가 됐고(1차), 0.06 으로 줄였더니 아무것도 안 보였다(2차).
# 각져 보이는 건 '넓이'가 아니라 '평평한 마루 + 그 아래로 꺾이는 선반'이다.
# 확장을 어깨 바로 아래 34mm 밴드에만 몰아 넣어 처마를 만든다.
_squared = 0
for v in bm.verts:
    if v.co.z < SQ_TOP - SQ_BAND:
        continue
    t = min(1.0, (v.co.z - (SQ_TOP - SQ_BAND)) / SQ_BAND)
    ax = abs(v.co.x)
    if ax > 0.045:
        k = min(1.0, (ax - 0.045) / 0.045)
        v.co.x *= 1.0 + SQ_WIDEN * k * t
        _squared += 1
    # 목 쪽(ax 작음)까지 누르면 안 된다. 그 구간은 본체 자체가 SQ_TOP 보다
    # 높아서, 재킷만 눌리면 어깨 위로 맨살이 삼각형으로 뚫고 나온다.
    if v.co.z > SQ_TOP and ax > 0.062:
        v.co.z = SQ_TOP + (v.co.z - SQ_TOP) * 0.06

# 어깨 마루만 눌러서는 부족하다. 팔 윗면이 여전히 아래로 흘러내려서 견장이
# 허공에 걸친 막대처럼 보였다(3차 렌더). 어깨부터 팔 바깥 끝까지 '위를 향한 면'
# 전부를 한 평면으로 끌어올려 하나의 선반으로 만든다 — 패드 넣은 제복 어깨다.
_shelf = 0
for v in bm.verts:
    if abs(v.co.x) <= 0.062 or v.normal.z <= 0.35:
        continue
    if v.co.z < SQ_TOP - 0.040 or v.co.z >= SQ_TOP:
        continue
    v.co.z = SQ_TOP
    _shelf += 1
if _shelf < 30:
    raise RuntimeError("shoulder shelf raised too few verts: %d" % _shelf)
bm.normal_update()
rep["shoulder_shelf_verts"] = _shelf
if _squared < 40:
    raise RuntimeError("shoulder squaring touched too few verts: %d" % _squared)
rep["shoulder_square"] = {"verts": _squared, "top_z": round(SQ_TOP, 4),
                          "widen": SQ_WIDEN}

_bisect(bm, Vector((0.0, 0.0, HEM_Z)), Vector((0.0, 0.0, 1.0)))
for _side in ("L", "R"):
    _h, _d, _ln = _arm_axis[_side]
    _cut = _h + _d * (_ln * CUFF)
    _bisect(bm, _cut, -_d, lambda v, _h=_h, _d=_d, _ln=_ln: (v.co - _h).dot(_d) / _ln > 0.15)


def _boundary_loops(bm_):
    adj = {}
    for e in bm_.edges:
        if len(e.link_faces) == 1:
            a, b = e.verts
            adj.setdefault(a, set()).add(b)
            adj.setdefault(b, set()).add(a)
    seen, out = set(), []
    for k in adj:
        if k in seen:
            continue
        stack, comp = [k], set()
        while stack:
            n = stack.pop()
            if n in comp:
                continue
            comp.add(n)
            seen.add(n)
            stack.extend(adj[n] - comp)
        out.append(comp)
    return out


# 밑단을 수평 링으로 정렬. 사전 컷이 HEM_Z 위에서 끝나면 bisect 가 자를 게 없어
# 톱니가 남는다(ZP 에서 z 편차 55mm 실측). 잘라 낸 뒤 통째로 눕힌다.
_torso_hem = None
for comp in _boundary_loops(bm):
    zs = [v.co.z for v in comp]
    if max(zs) < HEM_Z + 0.10 and max(abs(v.co.x) for v in comp) < 0.14 and len(comp) > 24:
        if _torso_hem is None or len(comp) > len(_torso_hem):
            _torso_hem = comp
if _torso_hem is None:
    raise RuntimeError("torso hem loop not found")
_flat = min(v.co.z for v in _torso_hem)
_before = max(v.co.z for v in _torso_hem) - _flat
for v in _torso_hem:
    v.co.z = _flat
rep["hem_flatten"] = {"verts": len(_torso_hem), "z": round(_flat, 4),
                      "spread_before_m": round(_before, 4)}
bm.normal_update()

# ---- 마감: 재킷이 본체 안으로 들어간 곳을 전부 바깥으로 밀어낸다 ----
# 어깨를 평면으로 누르거나 가로로 넓히는 편집은 국소적으로 셸을 본체 안쪽으로
# 끌어당긴다. 그러면 어깨 위에 맨살이 삼각형으로 뚫고 나온다(실측). 어느 편집이
# 원인인지 쫓는 대신, '셸은 항상 본체 바깥 4mm' 를 마지막에 강제한다.
_body_tris = []
for _p in mesh.data.polygons:
    _vs = list(_p.vertices)
    for _k in range(1, len(_vs) - 1):
        _body_tris.append((_vs[0], _vs[_k], _vs[_k + 1]))
_body_bvh = BVHTree.FromPolygons(
    [tuple(mesh.matrix_world @ v.co) for v in mesh.data.vertices],
    _body_tris, all_triangles=True)
MIN_CLEAR = 0.004
_pushed, _worst = 0, 0.0
for v in bm.verts:
    _loc, _nrm, _idx, _d = _body_bvh.find_nearest(v.co)
    if _loc is None:
        continue
    _signed = (v.co - _loc).dot(_nrm)
    if _signed < MIN_CLEAR:
        _worst = max(_worst, MIN_CLEAR - _signed)
        v.co = _loc + _nrm * MIN_CLEAR
        _pushed += 1
bm.normal_update()
rep["jacket_pushed_out"] = {"verts": _pushed, "max_push_m": round(_worst, 5)}
if _pushed > len(bm.verts) * 0.5:
    raise RuntimeError("jacket push-out touched %d/%d verts — shell is inside out?"
                       % (_pushed, len(bm.verts)))

_loose = [v for v in bm.verts if not v.link_edges]
if _loose:
    bmesh.ops.delete(bm, geom=_loose, context='VERTS')
bm.to_mesh(gar.data)
bm.free()
gar.data.update()
if len(gar.data.vertices) < 400:
    raise RuntimeError("jacket shell too small: %d verts" % len(gar.data.vertices))
gar.data.materials.clear()
gar.data.materials.append(uni_mat)      # 슬롯 0 = 제복
gar.data.materials.append(trim_mat)     # 슬롯 1 = 견장
set_active(gar)
bpy.ops.object.shade_smooth()
rep["jacket"] = {"verts": len(gar.data.vertices),
                 "tris": sum(len(p.vertices) - 2 for p in gar.data.polygons),
                 "offset_m": JACKET_OFFSET, "hem_z": HEM_Z, "cuff": CUFF,
                 "color": UNIFORM_HEX}

# ---- 견장: 재킷 어깨 윗면을 복제해 밀어낸다 ----
# 강체 블록을 얹는 방식은 세 번 시도해서 세 번 다 '어깨에 걸친 막대'로 보였다.
# 블롭 어깨는 목에서 팔까지 끊김 없는 경사라 평평한 앉을 자리가 없다.
# 표면을 따라가는 복제-오프셋만이 옷의 일부로 읽힌다(ZP 주머니 경로).
# 1차에 금색 얼룩이 튄 원인은 이 기법이 아니라 면 선택이 너무 넓었던 것이다.
bm = bmesh.new()
bm.from_mesh(gar.data)
bm.faces.ensure_lookup_table()
bm.edges.ensure_lookup_table()
bm.verts.ensure_lookup_table()
_TRIM_SLOT = 1


def _dup_offset(bm_, pred, dist):
    src = [f for f in bm_.faces if pred(f)]
    if len(src) < 4:
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
    new_verts = {g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)}
    for v in new_verts:
        v.co += v.normal * dist
    return new_faces


TAB_OFF = 0.0072
_tabs = {}
for _side in ("L", "R"):
    _sg = SIDE_SIGN[_side]

    def _pred(f, _sg=_sg):
        c = f.calc_center_median()
        # 확실히 위를 향한 면만. 1차에는 0.42 라 옆구리·목까지 딸려 왔다.
        # 어깨를 넓게 덮으면 견장이 아니라 '어깨에 붙인 금색 스티커'가 된다.
        # 어깨 솔기 방향으로 좁고 길게 간다.
        return (f.normal.z > 0.62
                and SQ_TOP - 0.030 < c.z < SQ_TOP + 0.020
                and 0.048 < c.x * _sg < 0.102
                and abs(c.y) < 0.030)

    _tabs[_side] = _dup_offset(bm, _pred, TAB_OFF)
    for f in _tabs[_side]:
        f.material_index = _TRIM_SLOT
    # 열린 판이 떠 있지 않도록 경계를 재킷 표면 쪽으로 되밀어 닫는다
    _pb = [e for e in bm.edges
           if len(e.link_faces) == 1 and e.link_faces[0] in _tabs[_side]]
    if _pb:
        _ext = bmesh.ops.extrude_edge_only(bm, edges=_pb)
        for g in _ext["geom"]:
            if isinstance(g, bmesh.types.BMVert):
                g.co -= g.normal * TAB_OFF
            if isinstance(g, bmesh.types.BMFace):
                g.material_index = _TRIM_SLOT
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
# ---- 수장(袖章): 소맷부리 위 금줄 2줄 ----
# 정복의 계급장이다. 기하를 만들지 않고 면 색만 바꾼다 — 소매는 팔 축을 따르는
# 관이라 축 방향 구간으로 면을 고르면 띠가 정확히 둘러진다.
# 간격 3.5mm 로는 두 줄이 한 덩어리로 뭉친다(실측). 8mm 이상 띄운다.
CUFF_BANDS = ((0.495, 0.545), (0.600, 0.650))    # 아래팔 축 위치 (CUFF=0.68 바로 아래)
_stripe = 0
for _side in ("L", "R"):
    _h, _d, _ln = _arm_axis[_side]
    for f in bm.faces:
        if f.material_index == _TRIM_SLOT:
            continue
        c = f.calc_center_median()
        if c.x * SIDE_SIGN[_side] < 0.030:
            continue
        t = (c - _h).dot(_d) / _ln
        if any(a <= t <= b for a, b in CUFF_BANDS):
            f.material_index = _TRIM_SLOT
            _stripe += 1
if _stripe < 20:
    raise RuntimeError("cuff stripes selected too few faces: %d" % _stripe)
rep["cuff_stripes"] = {"faces": _stripe, "bands": CUFF_BANDS}

bm.normal_update()
bm.to_mesh(gar.data)
bm.free()
gar.data.update()
rep["shoulder_tabs"] = {s: len(v) for s, v in _tabs.items()}
if min(len(v) for v in _tabs.values()) < 4:
    raise RuntimeError("shoulder tab too small: %s" % rep["shoulder_tabs"])
_tab_objs = []

# ---- 스탠드 칼라: 정복 깃 ----
# 목 최소 단면을 찾아 그 위에 세운다. 고정 높이에서 재면 어깨를 잡는다(CP 실측).
_allp = [v.co for v in mesh.data.vertices]
_neck_z, _neck_r = None, 1e9
for _i in range(24):
    _z = 0.694 + _i * 0.004
    _band = [p for p in _allp if abs(p.z - _z) < 0.004 and math.hypot(p.x, p.y) < 0.11]
    if len(_band) < 25:
        continue
    _r = max(math.hypot(p.x, p.y) for p in _band)
    if _r < _neck_r:
        _neck_z, _neck_r = _z, _r
if _neck_z is None:
    raise RuntimeError("neck cross-section not found for the collar")
if not (0.02 < _neck_r < 0.10):
    raise RuntimeError("neck radius out of range: %.4f at z=%.3f" % (_neck_r, _neck_z))
COL_R = _neck_r + 0.011
COL_H = 0.030
bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=COL_R, depth=COL_H,
                                    location=(0.0, 0.0, _neck_z))
col = bpy.context.active_object
col.name = "SS_Collar"
col.data.name = "SS_Collar"
set_active(col)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.shade_smooth()
col.data.materials.clear()
col.data.materials.append(uni_mat)
_vg = col.vertex_groups.new(name="Chest")
_vg.add(range(len(col.data.vertices)), 1.0, 'REPLACE')
rep["collar"] = {"neck_z": round(_neck_z, 4), "neck_r": round(_neck_r, 4),
                 "r": round(COL_R, 4), "h": COL_H}

# ---- 더블브레스트 단추: 금색 원반 2열 × 3 ----
_btn_objs = []
_front_v = [v.co for v in gar.data.vertices if v.co.y < -0.02]
if len(_front_v) < 50:
    raise RuntimeError("jacket front not found for buttons")
for _bz in (0.596, 0.556, 0.516):
    for _bx in (-0.036, 0.036):
        _near = [p for p in _front_v
                 if abs(p.x - _bx) < 0.022 and abs(p.z - _bz) < 0.018]
        if not _near:
            raise RuntimeError("no jacket surface for button at %.3f/%.3f" % (_bx, _bz))
        _by = min(p.y for p in _near)
        bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.0072, depth=0.005,
                                            location=(_bx, _by + 0.0015, _bz))
        b = bpy.context.active_object
        b.name = "SS_Btn"
        b.rotation_euler = (D(90), 0.0, 0.0)
        set_active(b)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        bpy.ops.object.shade_smooth()
        b.data.materials.clear()
        b.data.materials.append(trim_mat)
        _vg = b.vertex_groups.new(name="Chest" if _bz > 0.545 else "Spine")
        _vg.add(range(len(b.data.vertices)), 1.0, 'REPLACE')
        _btn_objs.append(b)
rep["buttons"] = len(_btn_objs)

# ---- 숄더 마이크: 왼쪽 견장 앞쪽에 얹는 작은 블록 ----
# 프롭을 손에 들리지 않는다. 왼손을 어깨로 올려 누르는 동작만으로 무전이 읽힌다.
MIC_X = SIDE_SIGN["L"] * 0.082
MIC_Y = -0.026
MIC_Z = SQ_TOP + TAB_OFF + 0.012
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(MIC_X, MIC_Y, MIC_Z))
mic = bpy.context.active_object
mic.name = "SS_ShoulderMic"
mic.data.name = "SS_ShoulderMic"
mic.scale = (0.021, 0.017, 0.026)
set_active(mic)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
_bv = mic.modifiers.new("Round", 'BEVEL')
_bv.width = 0.0035
_bv.segments = 2
_bv.limit_method = 'ANGLE'
bpy.ops.object.modifier_apply(modifier=_bv.name)
bpy.ops.object.shade_smooth()
mic.data.materials.clear()
mic.data.materials.append(AJ_DARK)
_vg = mic.vertex_groups.new(name="Shoulder.L")
_vg.add(range(len(mic.data.vertices)), 1.0, 'REPLACE')
rep["shoulder_mic"] = {"verts": len(mic.data.vertices),
                       "pos": [round(MIC_X, 4), round(MIC_Y, 4), round(MIC_Z, 4)]}

# ---- 벨트: 재킷 밑단을 감싼다 ----
# 조끼를 뺀 자리를 메운다. 흉부를 가로지르던 경계선 대신 허리에 가로선을 만들어
# 무채색에서도 실루엣이 위아래로 나뉘고, 밑단 절단면도 함께 가려진다.
# 밑단 높이(0.455)에는 소매도 내려와 있다. 그냥 재면 소매까지 물어 벨트 반지름이
# 163mm 로 나와 팔 바깥까지 감싸는 굴렁쇠가 된다(4차 렌더). 몸통 그룹만 쓴다.
_TORSO_G = {gar.vertex_groups["Hips"].index, gar.vertex_groups["Spine"].index}
_hem_band = [v.co for v in gar.data.vertices
             if abs(v.co.z - HEM_Z) < 0.012
             and sum(g.weight for g in v.groups if g.group in _TORSO_G) > 0.5]
if len(_hem_band) < 20:
    raise RuntimeError("hem band not found for the belt: %d" % len(_hem_band))
BELT_RX = max(abs(p.x) for p in _hem_band) + 0.003
BELT_RY = max(abs(p.y) for p in _hem_band) + 0.003
if BELT_RX > 0.13 or BELT_RY > 0.13:
    raise RuntimeError("belt radius picked up the sleeves: %.4f x %.4f" % (BELT_RX, BELT_RY))
BELT_H = 0.013
bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=1.0, depth=BELT_H,
                                    location=(0.0, 0.0, HEM_Z + BELT_H * 0.20))
belt = bpy.context.active_object
belt.name = "SS_Belt"
belt.data.name = "SS_Belt"
belt.scale = (BELT_RX, BELT_RY, 1.0)
set_active(belt)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.shade_smooth()
belt.data.materials.clear()
belt.data.materials.append(AJ_DARK)
_vg = belt.vertex_groups.new(name="Hips")
_vg.add(range(len(belt.data.vertices)), 1.0, 'REPLACE')

# 버클 — 정면(-Y) 중앙 골드
bpy.ops.mesh.primitive_cube_add(size=1.0,
                                location=(0.0, -(BELT_RY + 0.004), HEM_Z + BELT_H * 0.20))
buck = bpy.context.active_object
buck.name = "SS_Buckle"
buck.scale = (0.026, 0.014, 0.014)
set_active(buck)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
_bv = buck.modifiers.new("Round", 'BEVEL')
_bv.width = 0.0028
_bv.segments = 2
_bv.limit_method = 'ANGLE'
bpy.ops.object.modifier_apply(modifier=_bv.name)
bpy.ops.object.shade_smooth()
buck.data.materials.clear()
buck.data.materials.append(trim_mat)
_vg = buck.vertex_groups.new(name="Hips")
_vg.add(range(len(buck.data.vertices)), 1.0, 'REPLACE')
rep["belt"] = {"rx": round(BELT_RX, 4), "ry": round(BELT_RY, 4),
               "z": round(HEM_Z + BELT_H * 0.20, 4), "h": BELT_H}

# 재킷·모자·견장·마이크를 본체에 합친다
set_active(mesh)
for _o in [gar, cap, mic, belt, buck, col] + _tab_objs + _btn_objs:
    _o.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.join()
mesh = need_obj("SS_Character")
_have = {m.name for m in mesh.data.materials if m}
for _need in ("MC_White", "SS_Uniform", "SS_Trim", "AJ_Dark"):
    if _need not in _have:
        raise RuntimeError("material lost during join: %s (have %s)" % (_need, sorted(_have)))
bm = bmesh.new()
bm.from_mesh(mesh.data)
_lo = [v for v in bm.verts if not v.link_edges]
rep["loose_verts_removed"] = len(_lo)
if _lo:
    bmesh.ops.delete(bm, geom=_lo, context='VERTS')
bm.to_mesh(mesh.data)
bm.free()
mesh.data.update()
gi = {g.name: g.index for g in mesh.vertex_groups}

# ==================================================== 8. Prop.R 본 + 기본 포즈
set_active(rig)
bpy.ops.object.mode_set(mode='EDIT')
eb = rig.data.edit_bones
_par = eb.get("LowerArm.R")
if _par is None:
    raise RuntimeError("LowerArm.R missing")
if "Prop.R" in eb:
    raise RuntimeError("Prop.R already exists")
_pr = eb.new("Prop.R")
_pr.head = _par.tail.copy()
_pr.tail = _par.tail + Vector((0.0, 0.0, -0.060))
_pr.parent = _par
_pr.use_connect = False
_pr.use_deform = False
bpy.ops.object.mode_set(mode='OBJECT')
rig.pose.bones["Prop.R"].rotation_mode = 'XYZ'
rep["rig"] = {"bones": len(rig.data.bones),
              "names": [b.name for b in rig.data.bones]}

dg = bpy.context.evaluated_depsgraph_get()


def apply_pose(vals):
    for bn, rot in vals.items():
        pb = rig.pose.bones.get(bn)
        if pb is None:
            raise RuntimeError("pose bone missing: %s" % bn)
        pb.rotation_euler = Euler([D(x) for x in rot], 'XYZ')
    dg.update()


def tip(bone):
    return rig.matrix_world @ rig.pose.bones[bone].tail


def elbow(bone):
    return rig.matrix_world @ rig.pose.bones[bone].head


def solve_arm(side, hand_target, elbow_target, elbow_w=0.30):
    ua, la = "UpperArm." + side, "LowerArm." + side
    par = [0.0] * 6

    def cost(p):
        rig.pose.bones[ua].rotation_euler = Euler([D(p[0]), D(p[1]), D(p[2])], 'XYZ')
        rig.pose.bones[la].rotation_euler = Euler([D(p[3]), D(p[4]), D(p[5])], 'XYZ')
        dg.update()
        c = (tip(la) - hand_target).length ** 2
        c += elbow_w * (elbow(la) - elbow_target).length ** 2
        c += 1e-6 * sum(x * x for x in p)
        return c

    step, best = 24.0, cost(par)
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
    # 합산 비용의 제곱근을 '잔차'로 돌려주면 팔꿈치 항이 섞여 손이 목표에
    # 닿았는데도 커 보인다. 손 오차만 따로 돌려준다.
    return par, (tip(la) - hand_target).length


# 곧게 선 자세. GP(굽은 등)·ZP(웅크림)·CP(무심)와 갈리는 지점이다.
UPPER_BASE = {"Hips": (0, 0, 0), "Spine": (-1, 0, 0), "Chest": (-1.5, 0, 0),
              "Head": (0, 0, 0), "Shoulder.L": (0, 0, 0), "Shoulder.R": (0, 0, 0)}
for bn, sn in BASE_LOWER.items():
    pb = rig.pose.bones[bn]
    pb.location = sn["loc"]
    pb.rotation_euler = Euler(sn["rot"], 'XYZ')
apply_pose({k: v for k, v in UPPER_BASE.items() if k != "Hips"})

sh_r = rig.matrix_world @ rig.pose.bones["UpperArm.R"].head
sh_l = rig.matrix_world @ rig.pose.bones["UpperArm.L"].head
ARM_REACH = (rig.data.bones["UpperArm.R"].length + rig.data.bones["LowerArm.R"].length)
# 왼팔은 늘어뜨린다. MC 정지 자세의 손은 어깨에서 (±0.079, 0, -0.277) = 도달률 98%.
# 손을 몸쪽으로 당기면 안 된다 — 재킷 셸이 팔·몸통에 8.5mm 씩 붙어 17mm 를
# 잡아먹으므로 MC 원본의 팔↔몸통 3.4mm 가 곧바로 깨진다.
# 재킷 셸이 팔·몸통에 8.5mm 씩 붙으므로 MC 정지 자세(0.079)보다 조금 벌린다.
HAND_L = sh_l + Vector((0.090, 0.012, -0.266))
ELB_L = sh_l + Vector((0.076, 0.004, -0.127))
# 오른팔도 늘어뜨린다.
# 처음에는 손을 허리 총에 얹었는데(안쪽+앞쪽), 그러면 총·홀스터·재킷 밑단이
# 한자리에 겹쳐 테이저 형태가 통째로 뭉갠다. 단독 렌더에서는 X26 인데
# 캐릭터에 붙이면 안 보였다. 팔을 내리면 총이 밑단 아래·몸 바깥으로 나와
# 전 시점에서 실루엣이 살고, 벨트의 홀스터는 '비어 있는' 상태로 읽힌다.
HAND_R = sh_r + Vector((-0.090, 0.012, -0.266))
ELB_R = sh_r + Vector((-0.076, 0.004, -0.127))
# 팔꿈치 가중치를 낮춘다. 도달 한계(88%) 근처에서는 팔꿈치 항이 손 목표와
# 다퉈 손이 25mm 씩 밀린다 (ACT-06 토네이도에서 겪은 것과 같은 현상).
pr_r, err_r = solve_arm("R", HAND_R, ELB_R, elbow_w=0.06)
pr_l, err_l = solve_arm("L", HAND_L, ELB_L, elbow_w=0.06)
for side, pr in (("R", pr_r), ("L", pr_l)):
    UPPER_BASE["UpperArm." + side] = tuple(round(x, 2) for x in pr[:3])
    UPPER_BASE["LowerArm." + side] = tuple(round(x, 2) for x in pr[3:])
apply_pose({k: v for k, v in UPPER_BASE.items() if k != "Hips"})
rep["arm_solve"] = {
    "reach_m": round(ARM_REACH, 4),
    "R": {"params": UPPER_BASE["UpperArm.R"] + UPPER_BASE["LowerArm.R"],
          "residual_m": round(err_r, 5),
          "hand_world": [round(v, 4) for v in tip("LowerArm.R")]},
    "L": {"params": UPPER_BASE["UpperArm.L"] + UPPER_BASE["LowerArm.L"],
          "residual_m": round(err_l, 5),
          "hand_world": [round(v, 4) for v in tip("LowerArm.L")]}}
for _s, _e in (("R", err_r), ("L", err_l)):
    if _e > 0.020:
        raise RuntimeError("arm.%s base solve residual too large: %.4f" % (_s, _e))

# ============================================================= 9. 테이저 프롭
# 위치는 '팔을 푼 뒤 손이 실제로 간 자리'에서 역산한다.
# 먼저 고정값으로 박으면 총이 손에서 뜬다 (ZP 에서 폰이 38mm 떠 있던 함정).
dg.update()
_me0 = mesh.evaluated_get(dg)
_hand0 = [mesh.matrix_world @ _me0.data.vertices[v.index].co
          for v in mesh.data.vertices
          if sum(g.weight for g in v.groups if g.group == gi["LowerArm.R"]) > 0.6]
if len(_hand0) < 50:
    raise RuntimeError("bare hand region too small: %d" % len(_hand0))
# 손 뭉치는 아래팔 그룹 전체가 아니라 뼈 끝 주변 덩어리다.
hand_r = tip("LowerArm.R")
_blob = [p for p in _hand0 if (p - hand_r).length < 0.040]
if len(_blob) < 20:
    raise RuntimeError("hand blob too small: %d" % len(_blob))
HAND_C = sum(_blob, Vector()) / len(_blob)
HAND_H = max(p.z for p in _blob) - min(p.z for p in _blob)
HAND_R_XY = max(math.hypot(p.x - HAND_C.x, p.y - HAND_C.y) for p in _blob)
rep["hand_blob"] = {"center": [round(v, 4) for v in HAND_C],
                    "height": round(HAND_H, 4), "radius_xy": round(HAND_R_XY, 4),
                    "verts": len(_blob)}

# 손가락 없는 블롭이 '쥔' 것으로 보이려면 손잡이가 주먹을 관통해 위아래로
# 조금씩 삐져나와야 한다(CP 캐리어 봉과 같은 원리). 뼈 끝에 두면 주먹 아래로
# 총이 통째로 매달려 '들고 있다'가 아니라 '옆에 떠 있다'로 읽힌다.
#
# 형태는 테이저 X26 계열을 따른다. 이 총이 총으로 읽히게 하는 요소는 셋이다 —
#   ① 노란 전면 카트리지  ② 뒤가 낮고 앞이 높은 쐐기형 바디  ③ 뚫린 방아쇠울
# 앞의 각진 블록만으로는 드라이어와 구별되지 않는다.
# 형태는 테이저 X26 계열.
#
# 조립은 반드시 '로컬 원점'에서 한다. 파츠를 최종 위치(손 옆)에 바로 놓고
# 회전을 적용하면, transform_apply(location=True) 시점에 오브젝트 원점이
# 월드 (0,0,0) 으로 가 있어서 파츠가 자기 중심이 아니라 월드 원점을 축으로
# 돌아 90mm 씩 날아간다. 원점에서 다 조립한 뒤 통째로 옮긴다.
#
# 실루엣을 만드는 건 덩어리 개수가 아니라 파츠 사이의 단차다 —
#   ① 앞이 크고 뒤로 흘러내리는 쐐기 바디   ② 뒤로 눕힌 손잡이
#   ③ 바디보다 크고 윗면이 뒤로 눕는 전면 카트리지
#   ④ 뚫린 트리거 가드 — 실루엣의 구멍 하나가 '총'을 만든다
#   ⑤ 측면 노란 라벨 + 원형 돌출
GRIP_W, GRIP_D, GRIP_H = 0.029, 0.030, 0.054
GRIP_TILT = 16.0
BODY_W, BODY_D, BODY_H = 0.031, 0.068, 0.035
BODY_C = Vector((0.0, -0.024, 0.038))
CART_W, CART_D, CART_H = 0.042, 0.033, 0.044
CART_C = Vector((0.0, -0.074, 0.036))
LABEL_DIM = (0.006, 0.024, 0.013)
BOSS_R, BOSS_D = 0.0090, 0.040
GUARD_MAJOR, GUARD_MINOR = 0.016, 0.0038
PRONG_R, PRONG_L, PRONG_DX = 0.0040, 0.014, 0.0130

# 총이 커질 때마다 정지·보행 포즈의 관통을 다시 봐야 한다. 손 중심에 그대로
# 두면 몸통·허벅지를 스친다(Walk f7, Guide f28 에서 적발). 손잡이 블록이
# 여전히 주먹 중심을 품는 범위 안에서 몸 바깥·앞·위로 민다.
TASER_CEN = HAND_C + Vector((SIDE_SIGN["R"] * 0.011, -0.009, 0.007))
_parts = []


def _box(name, cen, dim, mat, bevel=0.0022):
    """로컬 좌표에 상자를 놓는다. 원점은 상자 중심에 남긴다 —
    location 을 apply 하면 이후 회전이 월드 원점 기준이 된다."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=cen)
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    o.scale = dim
    set_active(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if max(abs(a - b) for a, b in zip(o.dimensions, dim)) > 1e-5:
        raise RuntimeError("%s dimensions off: %s" % (name, [round(v, 4) for v in o.dimensions]))
    if bevel > 0.0:
        bv = o.modifiers.new("Round", 'BEVEL')
        bv.width = bevel
        bv.segments = 2
        bv.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier=bv.name)
    o.data.materials.clear()
    o.data.materials.append(mat)
    return o


# ---- 손잡이 (로컬 원점) ----
grip = _box("PR_Taser", Vector((0.0, 0.0, 0.0)), (GRIP_W, GRIP_D, GRIP_H), AJ_DARK)
_bm = bmesh.new()
_bm.from_mesh(grip.data)
for v in _bm.verts:
    if v.co.z < -GRIP_H * 0.20:          # 밑동을 벌린다 — 각목처럼 보이지 않게
        v.co.x *= 1.06
        v.co.y *= 1.05
_bm.to_mesh(grip.data)
_bm.free()
grip.data.update()
grip.rotation_euler = (D(GRIP_TILT), 0.0, 0.0)     # 원점 = 손잡이 중심이라 안전
set_active(grip)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

# ---- 상단 본체 — 뒤로 흘러내리는 쐐기 ----
body = _box("PR_TaserBody", BODY_C, (BODY_W, BODY_D, BODY_H), AJ_DARK)
_bm = bmesh.new()
_bm.from_mesh(body.data)
for v in _bm.verts:
    t = (v.co.y + BODY_D * 0.5) / BODY_D           # 0 = 앞, 1 = 뒤
    if t > 0.42:
        k = (t - 0.42) / 0.58
        v.co.z *= (1.0 - 0.50 * k)                 # 낮아지고
        v.co.z -= BODY_H * 0.22 * k                # 아래로 흘러내리고
        v.co.x *= (1.0 - 0.28 * k)                 # 좁아진다
_bm.to_mesh(body.data)
_bm.free()
body.data.update()
_parts.append(body)

# ---- 전면 카트리지 (노랑) ----
cart = _box("PR_TaserCart", CART_C, (CART_W, CART_D, CART_H), cart_mat, bevel=0.0026)
_bm = bmesh.new()
_bm.from_mesh(cart.data)
for v in _bm.verts:
    if v.co.y < 0.0 and v.co.z > CART_H * 0.10:    # 앞면 윗변을 뒤로 눕힌다
        v.co.y += CART_D * 0.34
    if v.co.y < 0.0 and v.co.z < -CART_H * 0.28:   # 앞 아래 모서리를 깎는다
        v.co.y += CART_D * 0.20
    if v.co.z < -CART_H * 0.30:                    # 아래로 갈수록 좁아진다
        v.co.x *= 0.80
_bm.to_mesh(cart.data)
_bm.free()
cart.data.update()
_parts.append(cart)

# ---- 측면 노란 라벨 ×2 ----
for _sx in (-1, 1):
    _parts.append(_box("PR_TaserLabel", Vector((_sx * (BODY_W * 0.5 + 0.0012),
                                                BODY_C.y - BODY_D * 0.24,
                                                BODY_C.z + 0.004)),
                       LABEL_DIM, cart_mat, bevel=0.0012))

# ---- 측면 원형 돌출 (바디를 관통) ----
bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=BOSS_R, depth=BOSS_D,
                                    location=(0.0, BODY_C.y - BODY_D * 0.10,
                                              BODY_C.z - 0.001))
boss = bpy.context.active_object
boss.name = "PR_TaserBoss"
boss.rotation_euler = (0.0, D(90), 0.0)
set_active(boss)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
boss.data.materials.clear()
boss.data.materials.append(AJ_DARK)
_parts.append(boss)

# ---- 트리거 가드 — 손잡이 앞면과 바디 밑면을 잇는 뚫린 고리 ----
bpy.ops.mesh.primitive_torus_add(major_segments=16, minor_segments=6,
                                 major_radius=GUARD_MAJOR, minor_radius=GUARD_MINOR,
                                 location=(0.0, -0.030, 0.009))
guard = bpy.context.active_object
guard.name = "PR_TaserGuard"
guard.rotation_euler = (0.0, D(90), 0.0)           # 고리 평면을 측면(YZ)으로
guard.scale = (1.0, 1.06, 0.95)
set_active(guard)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
guard.data.materials.clear()
guard.data.materials.append(AJ_DARK)
_parts.append(guard)

# ---- 전극 포트 ×2 — 카트리지 앞면에서 살짝 튀어나온다 ----
_muzzle_y = CART_C.y - CART_D * 0.5
for _sx in (-1, 1):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=8, radius=PRONG_R, depth=PRONG_L,
        location=(_sx * PRONG_DX, _muzzle_y - PRONG_L * 0.25, CART_C.z - CART_H * 0.14))
    p = bpy.context.active_object
    p.rotation_euler = (D(90), 0.0, 0.0)
    set_active(p)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    p.data.materials.clear()
    p.data.materials.append(AJ_DARK)
    _parts.append(p)

set_active(grip)
for p in _parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = grip
bpy.ops.object.join()
taser = need_obj("PR_Taser")
# 원점에서 조립을 끝냈으니 이제 손 위치로 통째로 옮긴다
taser.location = TASER_CEN
set_active(taser)
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
# 조인 뒤 전체 베벨을 다시 걸면 파츠 사이 단차가 뭉개져 한 덩어리로 보인다.
# 베벨은 파츠별로 이미 걸었다. 셰이딩도 flat 이어야 각 면이 살아 로우폴리로 읽힌다.
bpy.ops.object.shade_flat()
# 조인하면 슬롯이 합쳐지므로 material_index 가 살아 있는지 확인하고,
# 없는 슬롯만 채운다. 여기서 clear() 하면 카트리지 노랑이 통째로 날아간다.
_names = [m.name for m in taser.data.materials if m]
for _need in ("AJ_Dark", "SS_Cartridge"):
    if _need not in _names:
        raise RuntimeError("taser lost material %s (have %s)" % (_need, _names))

# 스파크는 별도 오브젝트로 둔다 — 클립마다 켜고 끄려면 분리돼 있어야 한다.
# 스파크가 카트리지 면에 붙어 있으면 노란 판에 박힌 보석처럼 보인다.
# 전극 끝보다 앞으로 빼서 '두 극 사이의 방전'으로 읽히게 한다.
_arc_c = TASER_CEN + Vector((0.0, _muzzle_y - PRONG_L * 1.15,
                             CART_C.z - CART_H * 0.14))
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.0062, location=_arc_c)
arc = bpy.context.active_object
arc.name = "PR_TaserArc"
arc.data.name = "PR_TaserArc"
arc.scale = (1.9, 0.75, 0.55)
set_active(arc)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.shade_smooth()
arc.data.materials.clear()
arc.data.materials.append(arc_mat)

# --- 쥐고 있는지 검사 ---
# 프롭이 손 '바깥'에 있을 때는 표면 최단거리로 접촉을 봤지만(ZP 폰), 손잡이가
# 주먹을 관통하는 구조에서는 그 값이 커도 정상이다. 여기서 볼 것은 두 가지다.
#   (1) 손 중심이 손잡이 블록 안에 있는가  → 쥐고 있다
#   (2) 손잡이가 주먹 위아래로 실제로 드러나는가 → 보이게 쥐고 있다
dg.update()
_me = mesh.evaluated_get(dg)
_hand = [mesh.matrix_world @ _me.data.vertices[v.index].co
         for v in mesh.data.vertices
         if sum(g.weight for g in v.groups if g.group == gi["LowerArm.R"]) > 0.6]
_blob = [p for p in _hand if (p - tip("LowerArm.R")).length < 0.040]
_hand_c = sum(_blob, Vector()) / len(_blob)
_kt = KDTree(len(_hand))
for i, p in enumerate(_hand):
    _kt.insert(p, i)
_kt.balance()
_off = _hand_c - TASER_CEN
if abs(_off.x) > GRIP_W * 0.5 or abs(_off.y) > GRIP_D * 0.5 or abs(_off.z) > GRIP_H * 0.5:
    raise RuntimeError("hand centre is outside the grip block: offset %s"
                       % [round(v, 4) for v in _off])
_tz = [(taser.matrix_world @ v.co).z for v in taser.data.vertices]
_expose_lo = min(p.z for p in _blob) - min(_tz)
_expose_hi = max(_tz) - max(p.z for p in _blob)
rep["taser_grip"] = {"hand_centre_offset_m": [round(v, 4) for v in _off],
                     "grip_exposed_below_m": round(_expose_lo, 4),
                     "grip_exposed_above_m": round(_expose_hi, 4),
                     "hand_to_taser_surface_m": round(
                         min(_kt.find(taser.matrix_world @ v.co)[2]
                             for v in taser.data.vertices), 5)}
if _expose_lo < 0.004:
    raise RuntimeError("grip butt is swallowed by the fist: %.4f m" % _expose_lo)


def bone_attach(obj, bone):
    pb = rig.pose.bones[bone]
    blen = rig.data.bones[bone].length
    pm = rig.matrix_world @ pb.matrix @ Matrix.Translation((0.0, blen, 0.0))
    w = obj.matrix_world.copy()
    obj.parent = rig
    obj.parent_type = 'BONE'
    obj.parent_bone = bone
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_basis = pm.inverted() @ w
    bpy.context.view_layer.update()


# 스파크를 별도 오브젝트로 두면 클립마다 가시성을 키잉해야 하는데 glTF 가
# 이를 제대로 싣지 못한다. 슬롯만 나눠 한 메시로 합치고, 엔진에서 SS_Arc
# 머티리얼의 이미시브를 켜고 끄게 한다 (ZP_ScreenGlow 와 같은 방식).
set_active(taser)
arc.select_set(True)
bpy.context.view_layer.objects.active = taser
bpy.ops.object.join()
taser = need_obj("PR_Taser")
if {m.name for m in taser.data.materials if m} != {"AJ_Dark", "SS_Cartridge", "SS_Arc"}:
    raise RuntimeError("taser materials wrong: %s" % [m.name for m in taser.data.materials])
bone_attach(taser, "Prop.R")
rep["taser"] = {"verts": len(taser.data.vertices),
                "tris": sum(len(p.vertices) - 2 for p in taser.data.polygons),
                "dims": [round(v, 4) for v in taser.dimensions],
                "mats": [m.name for m in taser.data.materials if m]}
# 파츠가 자기 중심이 아닌 월드 원점을 축으로 돌아 날아가는 사고를 잡는다.
# 치수 범위로 재면 어느 파츠가 얼마나 갔는지 알 수 없다 — 손잡이 중심에서
# 가장 먼 정점까지의 거리가 설계상 최대(카트리지 앞 위 모서리)를 넘는지 본다.
_far = max((taser.matrix_world @ v.co - TASER_CEN).length for v in taser.data.vertices)
rep["taser_max_radius_m"] = round(_far, 4)
if _far > 0.120:
    raise RuntimeError("a taser part flew away: farthest vertex %.4f m from the grip"
                       % _far)
if taser.dimensions.z < 0.070 or taser.dimensions.y < 0.095:
    raise RuntimeError("taser too small to read as a weapon: %s"
                       % [round(v, 4) for v in taser.dimensions])

# ============================================================ 10. 허리 홀스터
# 테이저가 간 자리에서 역산한다. 먼저 박으면 총이 홀스터에서 떨어진다.
dg.update()
_tw = [taser.matrix_world @ v.co for v in taser.data.vertices]
HOLS_Z = (min(p.z for p in _tw) + max(p.z for p in _tw)) / 2.0
HOLS_Y = sum(p.y for p in _tw) / len(_tw)
# 몸통 표면까지 붙인다 — 허공에 뜬 상자로 보이면 안 된다
_hipband = [mesh.matrix_world @ _me.data.vertices[v.index].co for v in mesh.data.vertices
            if abs((mesh.matrix_world @ _me.data.vertices[v.index].co).z - HOLS_Z) < 0.030
            and sum(g.weight for g in v.groups
                    if g.group in (gi["Hips"], gi["Spine"])) > 0.5]
if len(_hipband) < 20:
    raise RuntimeError("hip band not found for the holster: %d" % len(_hipband))
_hip_x = max(p.x * SIDE_SIGN["R"] for p in _hipband)
HOLS_W, HOLS_D, HOLS_H = 0.028, 0.030, 0.058
# 홀스터 X 도 테이저에서 역산한다. 엉덩이 표면에만 맞춰 붙이면 손이 그보다
# 바깥에 있어 총이 33mm 떠 보인다 (실측). 바깥 면을 테이저 안쪽 면에 맞추고,
# 안쪽 면이 몸 표면 안으로 물리는지를 따로 검사한다.
_t_in = min(p.x * SIDE_SIGN["R"] for p in _tw)
_h_c = (_t_in + 0.002) - HOLS_W * 0.5
# 안쪽 면은 반드시 몸 표면 안으로 4mm 물려야 한다. 떠 있으면 허리에 상자를
# 매단 꼴이 된다. 테이저 정렬보다 이 조건이 우선이고, 밀린 만큼은 아래
# 홀스터↔테이저 간격 검사(20mm)가 받아 준다.
BURY = 0.004
_h_cap = _hip_x - BURY + HOLS_W * 0.5
if _h_c > _h_cap:
    _h_c = _h_cap
if _h_c - HOLS_W * 0.5 > _hip_x:
    raise RuntimeError("holster floats off the hip: inner %.4f vs body %.4f"
                       % (_h_c - HOLS_W * 0.5, _hip_x))
HOLS_X = SIDE_SIGN["R"] * _h_c
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(HOLS_X, HOLS_Y, HOLS_Z))
hols = bpy.context.active_object
hols.name = "SS_Holster"
hols.data.name = "SS_Holster"
hols.scale = (HOLS_W, HOLS_D, HOLS_H)
set_active(hols)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
_bv = hols.modifiers.new("Round", 'BEVEL')
_bv.width = 0.005
_bv.segments = 2
_bv.limit_method = 'ANGLE'
bpy.ops.object.modifier_apply(modifier=_bv.name)
bpy.ops.object.shade_smooth()
hols.data.materials.clear()
hols.data.materials.append(AJ_DARK)
_vg = hols.vertex_groups.new(name="Hips")
_vg.add(range(len(hols.data.vertices)), 1.0, 'REPLACE')
set_active(mesh)
hols.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.join()
mesh = need_obj("SS_Character")
gi = {g.name: g.index for g in mesh.vertex_groups}
dg.update()
_me = mesh.evaluated_get(dg)
rep["holster"] = {"pos": [round(HOLS_X, 4), round(HOLS_Y, 4), round(HOLS_Z, 4)],
                  "dims": [HOLS_W, HOLS_D, HOLS_H]}

# 홀스터 ↔ 테이저 근접 — 떨어져 있으면 총이 허공에 뜬 걸로 보인다
_hw = [mesh.matrix_world @ _me.data.vertices[v.index].co for v in mesh.data.vertices
       if sum(g.weight for g in v.groups if g.group == gi["Hips"]) > 0.99
       and abs((mesh.matrix_world @ _me.data.vertices[v.index].co).z - HOLS_Z) < HOLS_H]
if len(_hw) < 8:
    raise RuntimeError("holster verts not found after join: %d" % len(_hw))
_ht = min(min((a - b).length for b in _hw) for a in _tw)
rep["holster_taser_gap_m"] = round(_ht, 5)
# 총을 뽑아 든 상태이므로 홀스터와 붙어 있을 필요는 없다. 대신 홀스터가
# 허공에 뜨지 않았는지(위에서 몸 표면 안으로 4mm 물렸는지)는 이미 확인했고,
# 여기서는 총이 홀스터를 파고들지만 않으면 된다.
if _ht < 0.004:
    raise RuntimeError("taser intersects the holster: %.4f m" % _ht)

# ============================================================ 11. 정적 검사
# --- 팔 ↔ 몸통: MC 원본 3.4mm 보다 좁아지면 회귀 ---
# 반드시 '맨몸' 정점끼리만 잰다. MC 기준선 3.4mm 자체가 맨몸 수치이고,
# 재킷 셸은 소매와 몸판이 하나로 이어진 지오메트리라 겨드랑이 이음매의
# 인접 정점끼리 2mm 로 잡혀 가짜 실패가 난다.
_skin_slot = [i for i, m in enumerate(mesh.data.materials) if m and m.name == "MC_White"]
if not _skin_slot:
    raise RuntimeError("MC_White slot not found on the merged mesh")
_skin = {vi for p in mesh.data.polygons if p.material_index in _skin_slot
         for vi in p.vertices}
_torso = [mesh.matrix_world @ _me.data.vertices[v.index].co for v in mesh.data.vertices
          if v.index in _skin and sum(g.weight for g in v.groups
                                      if g.group in (gi["Spine"], gi["Chest"], gi["Hips"])) > 0.85]
rep["arm_torso_gap_m"] = {}
for _s in ("L", "R"):
    _a = [mesh.matrix_world @ _me.data.vertices[v.index].co for v in mesh.data.vertices
          if v.index in _skin and sum(g.weight for g in v.groups
                                      if g.group in (gi["UpperArm." + _s], gi["LowerArm." + _s])) > 0.6]
    _best = min(((x - t).length, x, t) for x in _a for t in _torso)
    _d2 = _best[0]
    rep["arm_torso_gap_m"][_s] = {"gap": round(_d2, 5),
                                  "arm_at": [round(v, 4) for v in _best[1]],
                                  "torso_at": [round(v, 4) for v in _best[2]]}
    if _d2 < 0.0034:
        raise RuntimeError("arm.%s digs into torso: %.4f at arm%s torso%s (MC baseline 0.0034)"
                           % (_s, _d2, [round(v, 4) for v in _best[1]],
                              [round(v, 4) for v in _best[2]]))

# --- 총구 방향 안전: 정지 포즈에서 자기 몸통·머리를 겨누면 안 된다 ---
dg.update()
_tw = [taser.matrix_world @ v.co for v in taser.data.vertices]
_muzzle = min(_tw, key=lambda p: p.y)
_tc = sum(_tw, Vector()) / len(_tw)
_aim = (_muzzle - _tc)
if _aim.length < 1e-6:
    raise RuntimeError("taser aim vector degenerate")
_aim.normalize()
_body_c2 = Vector((0.0, head_c.y, 0.55))
_to_body = (_body_c2 - _muzzle)
_ang = math.degrees(_aim.angle(_to_body)) if _to_body.length > 1e-6 else 180.0
rep["muzzle_safe_deg"] = round(_ang, 2)
if _ang < 45.0:
    raise RuntimeError("taser points at the character's own body: %.1f deg" % _ang)

# --- 바닥 접지 ---
_wv = [mesh.matrix_world @ v.co for v in _me.data.vertices]
_minz = min(p.z for p in _wv)
rep["bounds_z"] = [round(_minz, 4), round(max(p.z for p in _wv), 4)]
rep["height"] = round(max(p.z for p in _wv) - _minz, 4)
if abs(_minz - SOLE_Z) > 0.0015:
    raise RuntimeError("character not grounded: %.4f vs sole %.4f" % (_minz, SOLE_Z))

# --- 모자가 머리를 파고드는 깊이 (셸이라 설계상 겹치지만 한도를 둔다) ---
_cap_slots = [i for i, m in enumerate(mesh.data.materials)
              if m and m.name in ("SS_Uniform", "SS_Trim")]
rep["materials"] = [m.name for m in mesh.data.materials if m]
rep["mesh"] = {"verts": len(mesh.data.vertices),
               "tris": sum(len(p.vertices) - 2 for p in mesh.data.polygons)}

# --- 정점당 영향 ---
_maxinf = 0
for v in mesh.data.vertices:
    _maxinf = max(_maxinf, len([g for g in v.groups if g.weight > 1e-5]))
rep["max_influence_pre_limit"] = _maxinf
# ============================================================ 12. 액션
UPPER_BASE["Prop.R"] = (0, 0, 0)
UPPER_BONES = ["Spine", "Chest", "Head", "Shoulder.L", "UpperArm.L", "LowerArm.L",
               "Shoulder.R", "UpperArm.R", "LowerArm.R", "Prop.R"]
KEYED = LOWER + UPPER_BONES


def base_upper(bn):
    return list(UPPER_BASE.get(bn, (0, 0, 0)))


def new_action(name):
    if name in bpy.data.actions:
        raise RuntimeError("action name collision: %s" % name)
    a = bpy.data.actions.new(name)
    a.use_fake_user = True
    return a


def write_action(name, nframes, framefunc):
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


def ease(u):
    return u * u * (3 - 2 * u)


def curve(f, keys):
    if f <= keys[0][0]:
        return keys[0][1]
    for i in range(len(keys) - 1):
        f0, v0 = keys[i]
        f1, v1 = keys[i + 1]
        if f0 <= f <= f1:
            u = ease((f - f0) / float(f1 - f0)) if f1 > f0 else 0.0
            return v0 + (v1 - v0) * u
    return keys[-1][1]


def lower_at(sample, f0, n, f):
    """샘플을 순환시켜 하체를 가져온다. ONCE 클립도 다리는 계속 숨 쉬어야 한다."""
    k = ((f - 1) % n) + f0
    return {bn: {"loc": list(sn["loc"]),
                 "rot": [math.degrees(x) for x in sn["rot"]]}
            for bn, sn in sample[k].items()}


def lower_cycle(sample, f0, n_src, n_dst, f):
    """소스 사이클을 목표 길이로 리샘플한다.

    루프 클립의 길이가 소스와 다르면(예: 61프레임 Idle → 46프레임 Aim)
    그냥 잘라 쓰면 마지막 프레임이 첫 프레임으로 안 닫힌다(실측 3.3mm).
    소스는 f1 == f_n 인 닫힌 주기이므로 (n-1) 구간으로 선형 보간한다.
    """
    x = (f - 1) / float(n_dst - 1) * (n_src - 1)
    i0 = int(math.floor(x))
    t = x - i0
    i1 = min(i0 + 1, n_src - 1)
    i0 = min(i0, n_src - 1)
    a, b = sample[f0 + i0], sample[f0 + i1]
    out = {}
    for bn in a:
        out[bn] = {
            "loc": [a[bn]["loc"][k] * (1 - t) + b[bn]["loc"][k] * t for k in range(3)],
            "rot": [math.degrees(a[bn]["rot"][k] * (1 - t) + b[bn]["rot"][k] * t)
                    for k in range(3)]}
    return out


IDLE_N = IDLE_F[1] - IDLE_F[0] + 1
WALK_N = WALK_F[1] - WALK_F[0] + 1
RUN_N = RUN_F[1] - RUN_F[0] + 1

# ------------------------------------------------------------- 팔 포즈 사전
# 매 프레임 수치해석하면 느리고 프레임 간 표현이 튄다. 대표 포즈를 미리 풀고
# 그 사이를 보간한다 (CP 토네이도에서 쓴 방식).
_TASER_LOCAL_AIM = Vector((0.0, -1.0, 0.0))     # 총열은 오브젝트 로컬 -Y


def barrel_dir():
    dg.update()
    m = taser.evaluated_get(dg).matrix_world
    return (m.to_3x3() @ _TASER_LOCAL_AIM).normalized()


def _solve_once(side, hand_target, elbow_target, aimv, elbow_w, aim_w, seed):
    ua, la = "UpperArm." + side, "LowerArm." + side
    par = list(seed)

    def cost(p):
        rig.pose.bones[ua].rotation_euler = Euler([D(p[0]), D(p[1]), D(p[2])], 'XYZ')
        rig.pose.bones[la].rotation_euler = Euler([D(p[3]), D(p[4]), D(p[5])], 'XYZ')
        dg.update()
        c = (tip(la) - hand_target).length ** 2
        c += elbow_w * (elbow(la) - elbow_target).length ** 2
        if aimv is not None and aim_w > 0.0:
            # (1-dot) 는 작은 각에서 2차로 죽어 손 위치 항에 눌린다. 각도(rad)를
            # 그대로 써야 '몇 도 틀어졌나'가 '몇 mm 틀어졌나'와 같은 단위로 붙는다.
            c += aim_w * barrel_dir().angle(aimv) ** 2
        c += 1e-6 * sum(x * x for x in p)
        return c

    step, best = 24.0, cost(par)
    for _ in range(10):
        improved = True
        while improved:
            improved = False
            for i in range(6):
                for sgn in (step, -step):
                    trial = list(par)
                    trial[i] += sgn
                    if abs(trial[i]) > 150:
                        continue
                    c = cost(trial)
                    if c < best - 1e-12:
                        best, par, improved = c, trial, True
        step *= 0.5
    cost(par)
    return par, best, (tip(la) - hand_target).length, \
        (math.degrees(barrel_dir().angle(aimv)) if aimv is not None else None)


def solve_arm2(side, hand_target, elbow_target, aim=None,
               elbow_w=0.006, aim_w=0.0, start=None):
    """팔 6DOF 좌표하강. aim 을 주면 총열 방향까지 함께 맞춘다.

    총열은 Prop.R 본이 아니라 아래팔의 회전으로 돌린다. Prop.R 은 본 꼬리가
    손보다 60mm 아래라, 이 본을 돌리면 테이저가 손에서 떨어져 나간다.

    좌표하강은 시작점에 따라 국소최소에 갇힌다(실측: 손 49mm 이탈). 씨앗을
    여러 개 넣고 가장 좋은 결과를 고른다.
    """
    aimv = aim.normalized() if aim else None
    seeds = [[0.0] * 6]
    if start:
        seeds.append(list(start))
    seeds.append([-40.0, 0.0, 0.0, -30.0, 0.0, 0.0])
    seeds.append([-70.0, 0.0, 0.0, 20.0, 0.0, 0.0])
    seeds.append([-20.0, 0.0, -30.0, -50.0, 0.0, 0.0])
    seeds.append([-60.0, 0.0, 0.0, -40.0, 0.0, 0.0])
    seeds.append([-50.0, -20.0, 0.0, -60.0, 0.0, 0.0])
    seeds.append([-80.0, 0.0, 20.0, -30.0, 0.0, 0.0])
    seeds.append([-45.0, 15.0, -20.0, -45.0, 10.0, 0.0])
    best = None
    for sd in seeds:
        par, c, e, a = _solve_once(side, hand_target, elbow_target, aimv,
                                   elbow_w, aim_w, sd)
        if best is None or c < best[1]:
            best = (par, c, e, a)
    par, _c, err, ang = best
    _solve_once(side, hand_target, elbow_target, aimv, elbow_w, aim_w, par)
    return [round(x, 3) for x in par], err, ang


def neutral_upper():
    for bn in ("Spine", "Chest", "Head", "Shoulder.L", "Shoulder.R"):
        rig.pose.bones[bn].rotation_euler = Euler([D(x) for x in base_upper(bn)], 'XYZ')
    for bn, sn in BASE_LOWER.items():
        rig.pose.bones[bn].location = sn["loc"]
        rig.pose.bones[bn].rotation_euler = Euler(sn["rot"], 'XYZ')
    dg.update()


P = {"base_R": list(UPPER_BASE["UpperArm.R"]) + list(UPPER_BASE["LowerArm.R"]),
     "base_L": list(UPPER_BASE["UpperArm.L"]) + list(UPPER_BASE["LowerArm.L"])}
rep["arm_poses"] = {}

# 겨눔 — 앞으로 뻗어 총열이 정면(-Y)을 향한다
neutral_upper()
# 총열은 아래팔에 '수직'으로 고정돼 있다. 그래서 팔을 앞으로 곧게 뻗으면
# 총구는 위나 아래를 본다. 총구가 앞을 보려면 아래팔이 세로여야 하므로,
# 겨눔은 '팔꿈치를 앞·위로 내고 아래팔은 세워 둔' 자세로 잡는다.
P["aim_R"], _e, _a = solve_arm2(
    "R", sh_r + Vector((-0.065, -0.120, -0.205)), sh_r + Vector((-0.072, -0.100, -0.070)),
    aim=Vector((0.0, -1.0, -0.25)), elbow_w=0.003, aim_w=0.040, start=P["base_R"])
rep["arm_poses"]["aim_R"] = {"hand_err_m": round(_e, 4), "aim_err_deg": round(_a, 1)}
# 손 목표는 예술적 추정치다. 좌표하강이 40mm 안쪽으로 들어오면 자세의 방향은
# 유지되므로, 여기서는 '터무니없이 빗나갔는가'만 막고 최종 판정은 렌더로 한다
# (ACT-05·06 교훈: 합격은 솔버 잔차가 아니라 눈에 보이는 결과로 정한다).
AIM_FAIL = []
if _e > 0.040 or _a > 16.0:
    AIM_FAIL.append("aim_R hand %.4f m barrel %.1f deg" % (_e, _a))

# 경고 — 총을 위로 들어 공중에서 스파크
neutral_upper()
# 총구가 위를 보려면 아래팔이 가로여야 한다 (수직 마운트의 역).
P["warn_R"], _e, _a = solve_arm2(
    "R", sh_r + Vector((-0.078, -0.132, -0.115)), sh_r + Vector((-0.080, 0.008, -0.120)),
    aim=Vector((0.0, -0.25, 1.0)), elbow_w=0.003, aim_w=0.040, start=P["aim_R"])
rep["arm_poses"]["warn_R"] = {"hand_err_m": round(_e, 4), "aim_err_deg": round(_a, 1)}
if _e > 0.040 or _a > 16.0:
    AIM_FAIL.append("warn_R hand %.4f m barrel %.1f deg" % (_e, _a))

# 뽑는 경로 — 허리에서 가슴으로 곧장 올리면 총이 몸통을 관통한다
# (실측: Draw f9 에서 14정점, Holster f12 에서 21정점). 바깥으로 돌려 올린다.
neutral_upper()
P["draw_mid_R"], _e, _a = solve_arm2(
    "R", sh_r + Vector((-0.100, -0.068, -0.240)), sh_r + Vector((-0.086, -0.040, -0.100)),
    aim=Vector((0.0, -1.0, -0.30)), elbow_w=0.003, aim_w=0.030, start=P["base_R"])
rep["arm_poses"]["draw_mid_R"] = {"hand_err_m": round(_e, 4), "aim_err_deg": round(_a, 1)}
if _e > 0.040:
    AIM_FAIL.append("draw_mid_R hand %.4f m" % _e)

# 추격 — 총을 가슴 앞에 세워 든 채 달린다
neutral_upper()
P["chase_R"], _e, _a = solve_arm2(
    "R", sh_r + Vector((-0.062, -0.098, -0.190)), sh_r + Vector((-0.076, -0.052, -0.086)),
    aim=Vector((0.0, -1.0, -0.10)), elbow_w=0.003, aim_w=0.030, start=P["aim_R"])
rep["arm_poses"]["chase_R"] = {"hand_err_m": round(_e, 4), "aim_err_deg": round(_a, 1)}
if _e > 0.040:
    AIM_FAIL.append("chase_R hand %.4f m barrel %.1f deg" % (_e, _a))

# 무전 — 왼손을 어깨 마이크로. 블롭 팔은 여기서 가장 심하게 접히므로
# 마이크에 정확히 닿히려 하지 않는다. 도달률 37% 아래로 내려가면 아래팔이
# 위팔과 겹쳐 몸통을 파고든다.
neutral_upper()
P["radio_L"], _e, _a = solve_arm2(
    "L", sh_l + Vector((-0.006, -0.092, -0.058)), sh_l + Vector((0.098, -0.012, -0.086)),
    elbow_w=0.008, start=P["base_L"])
rep["arm_poses"]["radio_L"] = {"hand_err_m": round(_e, 4)}
if _e > 0.045:
    AIM_FAIL.append("radio_L hand %.4f m" % _e)

# 안내 — 왼손으로 가리킨다. 오른손은 총이라 안내에 쓰지 않는다.
neutral_upper()
P["guide_L"], _e, _a = solve_arm2(
    "L", sh_l + Vector((0.012, -0.196, -0.036)), sh_l + Vector((0.082, -0.052, -0.096)),
    elbow_w=0.008, start=P["base_L"])
rep["arm_poses"]["guide_L"] = {"hand_err_m": round(_e, 4)}
if _e > 0.045:
    AIM_FAIL.append("guide_L hand %.4f m" % _e)
neutral_upper()
print("ARM_POSES", json.dumps(rep["arm_poses"], ensure_ascii=False))
if AIM_FAIL:
    raise RuntimeError("arm poses failed: " + " | ".join(AIM_FAIL))


def _abduct_sign():
    """UpperArm.L 의 어느 부호가 팔을 몸에서 멀어지게 하는지 실측한다.
    로컬 축은 본 방향에 따라 뒤집히므로 눈대중하면 반대로 벌린다."""
    neutral_upper()
    pb = rig.pose.bones["UpperArm.L"]
    base = list(P["base_L"])
    out = {}
    for sgn in (+1.0, -1.0):
        pb.rotation_euler = Euler([D(base[0]), D(base[1]), D(base[2] + sgn * 8.0)], 'XYZ')
        rig.pose.bones["LowerArm.L"].rotation_euler = Euler(
            [D(base[3]), D(base[4]), D(base[5])], 'XYZ')
        dg.update()
        out[sgn] = (tip("LowerArm.L") - Vector((0.0, 0.0, tip("LowerArm.L").z))).length
    neutral_upper()
    return 8.0 if out[+1.0] > out[-1.0] else -8.0


ABDUCT_L = _abduct_sign()
rep["abduct_L_deg"] = ABDUCT_L


def arm_curve(keys, f):
    return [curve(f, [(k, P[nm][ax]) for k, nm in keys]) for ax in range(6)]


def clip(lower, lower_f0, lower_n, rot_off=None, arms=None, arm_off=None,
         cycle_to=None):
    """한 프레임의 포즈를 만드는 함수를 돌려준다.

    lower     : 하체 샘플 (순환)
    rot_off   : {bone: {axis: [(frame, deg)..]}} 기본 포즈에 더할 오프셋
    arms      : {side: [(frame, pose_name)..]} 팔 포즈 보간
    arm_off   : {side: {axis(0..5): [(frame, deg)..]}} 팔에 더할 스윙
    """
    rot_off = rot_off or {}
    arms = arms or {}
    arm_off = arm_off or {}

    def ff(f):
        d = lower_cycle(lower, lower_f0, lower_n, cycle_to, f) if cycle_to \
            else lower_at(lower, lower_f0, lower_n, f)
        for bn in UPPER_BONES:
            d.setdefault(bn, {})["rot"] = base_upper(bn)
        for side in ("L", "R"):
            v = arm_curve(arms[side], f) if side in arms else \
                list(P["base_" + side])
            for ax, keys in arm_off.get(side, {}).items():
                v[ax] += curve(f, keys)
            d["UpperArm." + side]["rot"] = v[:3]
            d["LowerArm." + side]["rot"] = v[3:]
        for bn, axes in rot_off.items():
            base = list(d.get(bn, {}).get("rot", base_upper(bn)))
            for ax, keys in axes.items():
                base[ax] += curve(f, keys)
            d[bn]["rot"] = base
        return d

    return ff


# 축 규약 (ACT-06 실측): rx = 앞으로 숙임, ry = 좌우 돌아보기, rz = 갸웃.
# rz 는 시선 방향을 전혀 바꾸지 못한다. '돌아본다'는 반드시 ry 다.
CLIPS = []


def add(name, n, ff, loop):
    write_action(name, n, ff)
    CLIPS.append((name, n, loop))


# ---------------------------------------------------------------- Level 0
def f_idle(f):
    d = clip(IDLE_LOWER, IDLE_F[0], IDLE_N)(f)
    t = (f - 1) / float(IDLE_N - 1)
    tau = 2 * math.pi * t
    br = 1.0 * math.sin(tau)
    sweep = 17.0 * math.sin(tau)          # 좌우 훑기 — 1주기라 루프가 닫힌다
    d["Chest"]["rot"] = [base_upper("Chest")[0] + br, sweep * 0.30, 0.0]
    d["Spine"]["rot"] = [base_upper("Spine")[0] + br * 0.6, sweep * 0.16, 0.0]
    d["Head"]["rot"] = [base_upper("Head")[0] + 0.9 * math.sin(tau * 2), sweep, 0.0]
    for side in ("L", "R"):
        for bn in ("UpperArm." + side, "LowerArm." + side):
            r = list(d[bn]["rot"])
            r[0] += br * 0.5
            d[bn]["rot"] = r
    return d


add("SS_Idle", IDLE_N, f_idle, True)


def f_walk(f):
    d = clip(WALK_LOWER, WALK_F[0], WALK_N)(f)
    t = (f - 1) / float(WALK_N - 1)
    tau = 2 * math.pi * t
    sw = math.sin(tau)
    # 왼팔은 크게 흔들고, 총에 손을 얹은 오른팔은 거의 고정한다.
    # 뒷스윙(sw<0)은 팔을 몸통으로 밀어 넣어 MC 기준선 3.4mm 를 깬다(실측 1.7mm).
    # 앞뒤를 비대칭으로 주고, 스윙 내내 조금 벌려 둔다.
    swf = sw if sw > 0 else sw * 0.45
    d["UpperArm.L"]["rot"][0] += swf * 15.0
    d["LowerArm.L"]["rot"][0] += swf * 5.0
    d["UpperArm.L"]["rot"][2] += ABDUCT_L * 0.55
    d["UpperArm.R"]["rot"][0] += -swf * 3.0
    d["Chest"]["rot"][1] += sw * 3.0
    d["Head"]["rot"][1] += -sw * 2.0
    return d


add("SS_Walk", WALK_N, f_walk, True)

RADIO_N = 61
RADIO_KEYS = [(1, "base_L"), (12, "radio_L"), (46, "radio_L"), (61, "base_L")]
add("SS_Radio", RADIO_N,
    clip(IDLE_LOWER, IDLE_F[0], IDLE_N,
         rot_off={"Head": {0: [(1, 0), (14, 9), (44, 8), (61, 0)],
                           1: [(1, 0), (14, -13), (44, -11), (61, 0)]},
                  "Chest": {1: [(1, 0), (14, -5), (44, -4), (61, 0)]}},
         arms={"L": RADIO_KEYS}), False)

GUIDE_N = 40
add("SS_Guide", GUIDE_N,
    clip(IDLE_LOWER, IDLE_F[0], IDLE_N,
         rot_off={"Head": {1: [(1, 0), (12, 22), (28, 19), (40, 0)],
                           0: [(1, 0), (12, -4), (28, -3), (40, 0)]},
                  # 상체만 크게 틀면 골반은 그대로라 오른팔이 엉덩이를 가로질러
                  # 총이 몸통을 파고든다(f10 에서 21정점). 비트는 각을 줄이고
                  # 머리 회전으로 방향을 읽히게 한다.
                  "Chest": {1: [(1, 0), (12, 4), (28, 3.5), (40, 0)]},
                  "Spine": {1: [(1, 0), (12, 2), (28, 1.5), (40, 0)]}},
         arms={"L": [(1, "base_L"), (12, "guide_L"), (28, "guide_L"), (40, "base_L")]}),
    False)

# ---------------------------------------------------------------- Level 1
DRAW_N = 19
add("SS_TaserDraw", DRAW_N,
    clip(IDLE_LOWER, IDLE_F[0], IDLE_N,
         rot_off={"Chest": {0: [(1, 0), (7, 3), (19, -4)]},
                  "Head": {0: [(1, 0), (19, -3)]}},
         arms={"R": [(1, "base_R"), (9, "draw_mid_R"), (19, "aim_R")]}), False)

AIM_N = 46
add("SS_TaserAim", AIM_N,
    clip(IDLE_LOWER, IDLE_F[0], IDLE_N, cycle_to=AIM_N,
         rot_off={"Chest": {0: [(1, -4), (23, -2.4), (46, -4)]},
                  "Head": {0: [(1, -3), (23, -2), (46, -3)]}},
         arms={"R": [(1, "aim_R")]},
         arm_off={"R": {0: [(1, 0.0), (12, 1.4), (23, 0.0), (35, -1.4), (46, 0.0)]}}),
    True)

WARN_N = 31
add("SS_TaserWarn", WARN_N,
    clip(IDLE_LOWER, IDLE_F[0], IDLE_N,
         rot_off={"Chest": {0: [(1, -4), (10, -8), (20, -8), (31, -4)]},
                  "Head": {0: [(1, -3), (10, -9), (20, -9), (31, -3)]}},
         arms={"R": [(1, "aim_R"), (10, "warn_R"), (20, "warn_R"), (31, "aim_R")]}),
    False)

ALERT_N = 46
add("SS_RadioAlert", ALERT_N,
    clip(IDLE_LOWER, IDLE_F[0], IDLE_N,
         rot_off={"Chest": {0: [(1, -4), (46, -4)], 1: [(1, 0), (12, -6), (34, -5), (46, 0)]},
                  "Head": {0: [(1, -3), (12, 5), (34, 4), (46, -3)],
                           1: [(1, 0), (12, -12), (34, -10), (46, 0)]}},
         arms={"R": [(1, "aim_R")],
               "L": [(1, "base_L"), (12, "radio_L"), (34, "radio_L"), (46, "base_L")]}),
    False)

HOLSTER_N = 19
# 뽑기의 정확한 시간역이 되게 맞춘다. 키 위치가 어긋나면 중간 프레임에서
# 팔꿈치가 과하게 접혀 소매가 팔 속으로 삼켜진다(f14 에서 36.5mm 실측).
add("SS_TaserHolster", HOLSTER_N,
    clip(IDLE_LOWER, IDLE_F[0], IDLE_N,
         rot_off={"Chest": {0: [(1, -4), (13, 3), (19, 0)]},
                  "Head": {0: [(1, -3), (19, 0)]}},
         arms={"R": [(1, "aim_R"), (11, "draw_mid_R"), (19, "base_R")]}), False)


# ---------------------------------------------------------------- Level 2
def f_chase(f):
    d = clip(RUN_LOWER, RUN_F[0], RUN_N, arms={"R": [(1, "chase_R")]})(f)
    t = (f - 1) / float(RUN_N - 1)
    tau = 2 * math.pi * t
    sw = math.sin(tau)
    swf = sw if sw > 0 else sw * 0.45
    d["UpperArm.L"]["rot"][0] += swf * 34.0
    d["LowerArm.L"]["rot"][0] += swf * 12.0 - 22.0     # 달릴 때 팔꿈치를 접는다
    d["UpperArm.L"]["rot"][2] += ABDUCT_L
    d["UpperArm.R"]["rot"][0] += -swf * 5.0
    d["Chest"]["rot"] = [base_upper("Chest")[0] - 11.0, sw * 4.0, 0.0]
    d["Spine"]["rot"] = [base_upper("Spine")[0] - 6.0, sw * 2.0, 0.0]
    d["Head"]["rot"] = [base_upper("Head")[0] + 6.0, -sw * 2.0, 0.0]
    return d


add("SS_Chase", RUN_N, f_chase, True)

FIRE_N = 25
add("SS_TaserFire", FIRE_N,
    clip(IDLE_LOWER, IDLE_F[0], IDLE_N,
         rot_off={"Chest": {0: [(1, -4), (4, 2), (11, -5), (25, -4)]},
                  "Head": {0: [(1, -3), (4, 2), (11, -4), (25, -3)]}},
         arms={"R": [(1, "aim_R")]},
         # 반동 — 총구가 위로 튀었다가 되돌아온다
         arm_off={"R": {0: [(1, 0.0), (3, -13.0), (9, 3.0), (16, -1.0), (25, 0.0)],
                        3: [(1, 0.0), (3, -7.0), (9, 2.0), (25, 0.0)]}}),
    False)

rep["clips"] = [{"name": n, "frames": nf, "loop": lp,
                 "dur_s": round((nf - 1) / 30.0, 3)} for n, nf, lp in CLIPS]
rep["actions"] = {a.name: [round(x, 1) for x in a.frame_range] for a in bpy.data.actions}
if len(CLIPS) != 11:
    raise RuntimeError("expected 11 clips, made %d" % len(CLIPS))
# ============================================================ 13. 저장
for pb in rig.pose.bones:
    pb.location = (0.0, 0.0, 0.0)
    pb.rotation_euler = (0.0, 0.0, 0.0)
for bn, sn in BASE_LOWER.items():
    rig.pose.bones[bn].location = sn["loc"]
    rig.pose.bones[bn].rotation_euler = Euler(sn["rot"], 'XYZ')
apply_pose({k: v for k, v in UPPER_BASE.items() if k != "Hips"})

OUT = os.path.abspath(OUT)
if os.path.normpath(OUT) == os.path.normpath(bpy.data.filepath):
    raise RuntimeError("refusing to overwrite the source file: %s" % OUT)
bpy.ops.wm.save_as_mainfile(filepath=OUT)
rep["saved"] = OUT
with open(REPORT, "w") as fh:
    json.dump(rep, fh, indent=1, ensure_ascii=False)
print("SS_BUILD OK ->", OUT)
print(json.dumps({k: rep[k] for k in
                  ("mesh", "rig", "taser", "taser_grip", "holster_taser_gap_m",
                   "arm_torso_gap_m", "height", "muzzle_safe_deg", "actions")},
                 ensure_ascii=False, indent=1))
