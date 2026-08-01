"""ACT-06 캐리어 승객(CP) 소스 빌드.

mc_character.blend 를 열어 MC 계열만 남기고 CP 로 파생시킨 뒤
assets/cp_character.blend 로 '다른 이름 저장'한다. 원본은 저장하지 않는다.

실행:  blender -b assets/mc_character.blend --python cp_build.py -- <out.blend>

ZP(ACT-05)에서 검증된 파생 경로를 그대로 쓴다 — 베이크 메시 복제로 스킨 웨이트를
상속받고, 본 히트 재바인딩을 하지 않는다.

ACT-06 고유 판단
  * 캐리어는 Prop.R(팔)이 아니라 Root 자식인 Prop.Case 본에 매단다.
    팔에 매달면 팔을 따라 돌아서 바닥에 선 물체가 기울어진다.
  * 블롭 팔은 늘어뜨린 상태가 이미 최대 도달의 98% 라, 손잡이를 바깥으로 빼려면
    반드시 위로 올려야 한다. (-0.215, 0.46) 이 91% 로 여유 있고 z=0.42 면 103% 다.
"""
import bpy, sys, os, json, math, bmesh
from mathutils import Vector, Matrix, Euler
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree

D = math.radians
OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else None
if not OUT:
    raise RuntimeError("output .blend path required after --")
REPORT = os.environ.get("CP_REPORT", "/tmp/cp_build_report.json")

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


def new_mat(name, hexcol, rough):
    if name in bpy.data.materials:
        raise RuntimeError("material already exists: %s" % name)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = principled(m)
    b.inputs["Base Color"].default_value = hex_lin(hexcol) + (1.0,)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.0
    m.diffuse_color = hex_lin(hexcol) + (1.0,)
    return m


# ---------------------------------------------------------------- 0. 사전 검증
MC_MESH = need_obj("MC_Character")
MC_RIG = need_obj("MC_Rig")
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
# ACT-06 은 고정 액터라 Walk 는 필요 없다. Idle 하체만 가져온다.
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


IDLE_LOWER = sample_action(ACT_IDLE, 1, 61, LOWER)
BASE_LOWER = {k: dict(v) for k, v in IDLE_LOWER[1].items()}
for f, sn in IDLE_LOWER.items():
    for bn in ("Root", "Hips"):
        if abs(sn[bn]["loc"][0]) > 1e-4 or abs(sn[bn]["loc"][2]) > 1e-4:
            raise RuntimeError("horizontal root motion in Idle f%d %s" % (f, bn))
rep["lower_body_source"] = {"Idle": [1, 61], "bones": LOWER}

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
rig.name = "CP_Rig"
rig.data.name = "CP_Rig"
mesh.name = "CP_Character"
mesh.data.name = "CP_Character"
for o in (rig, mesh):
    o.location = (0.0, 0.0, 0.0)
    o.rotation_euler = (0.0, 0.0, 0.0)
    o.scale = (1.0, 1.0, 1.0)
bpy.context.view_layer.update()

# ------------------------------------------------- 4. 캐리어 배치 기준값
# 캐리어 좌표는 고정값이 아니라 '팔을 푼 뒤 손이 실제로 간 자리'에서 역산한다.
# 먼저 박아 두면 손이 손잡이에 안 닿는다 (ZP 에서 폰이 38mm 떠 있던 것과 같은 함정).
SOLE_Z = 0.0351          # MC 발바닥 높이 — 캐리어도 같은 바닥에 세운다

# --------------------------------------------------------------- 5. 머티리얼
CASE_HEX = "#C97A2E"        # 캐리어 셸 — 기존 파랑/마젠타/회색과 겹치지 않는 앰버
PILLOW_HEX = "#4C5670"      # 넥필로우 — 어두운 슬레이트 블루
case_mat = new_mat("CP_Case", CASE_HEX, 0.48)
pillow_mat = new_mat("CP_Pillow", PILLOW_HEX, 0.78)

# --------------------------------------------- 6. 머리·목 실측 → 넥필로우
gi = {g.name: g.index for g in mesh.vertex_groups}
for n in ("Head", "Chest", "LowerArm.R", "Spine", "Hips"):
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
# 목 굵기 — 고정된 높이에서 재면 안 된다. z=0.706 은 이미 어깨라 0.1178 이
# 나오고 목베개가 머리보다 커진다. 머리~가슴 사이에서 '최소 단면'을 찾는다.
_allp = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
neck_z, neck_r = None, 1e9
for _i in range(30):
    _z = 0.660 + _i * 0.006
    _band = [p for p in _allp if abs(p.z - _z) < 0.004]
    if len(_band) < 40:
        continue
    _r = max(math.hypot(p.x, p.y) for p in _band)
    if _r < neck_r:
        neck_z, neck_r = _z, _r
if neck_z is None:
    raise RuntimeError("neck cross-section not found")
if not (0.02 < neck_r < 0.09):
    raise RuntimeError("neck radius out of range: %.4f at z=%.3f" % (neck_r, neck_z))
rep["head"] = {"center": [round(v, 4) for v in head_c],
               "radii": [round(v, 4) for v in head_r],
               "neck_z": round(neck_z, 4), "neck_radius": round(neck_r, 4)}

PIL_MINOR = 0.026
# 목 밴드 정중앙에 두면 튜브 아랫면이 어깨 플레어(z=0.710 에서 반지름 0.107)
# 안으로 12mm 파묻힌다. 튜브 밑면이 어깨보다 위에 오도록 올린다.
PIL_Z = neck_z + 0.012
# 안쪽 구멍을 목보다 10mm 크게 — 고개를 돌릴 때 목이 튜브를 파고들지 않게.
PIL_MAJOR = neck_r + PIL_MINOR + 0.010
bpy.ops.mesh.primitive_torus_add(major_segments=24, minor_segments=10,
                                 major_radius=PIL_MAJOR, minor_radius=PIL_MINOR,
                                 location=(0.0, 0.006, PIL_Z))
pil = bpy.context.active_object
pil.name = "CP_PillowShell"
pil.data.name = "CP_PillowShell"
# 앞쪽을 터서 U 자로 — 닫힌 도넛은 목에 낀 튜브처럼 보인다
bm = bmesh.new()
bm.from_mesh(pil.data)
cen = Vector((0.0, 0.006, PIL_Z))
# 개구부 반각. 끝단 캡이 호를 15도쯤 되메우므로(반구 높이 25mm / 반지름 95mm)
# 자를 때는 그만큼 더 열어야 최종 개구부가 30도쯤 된다.
OPEN_HALF = 46.0
TAPER_TO = 52.0         # 끝단 테이퍼가 시작되는 각


def _pil_ang(v):
    return abs(math.degrees(math.atan2(v.co.x - cen.x, -(v.co.y - cen.y))))


kill = [v for v in bm.verts if (v.co - cen).y < 0.0 and _pil_ang(v) < OPEN_HALF]
if not kill:
    raise RuntimeError("pillow front opening cut removed no vertices")
bmesh.ops.delete(bm, geom=kill, context='VERTS')
loose = [v for v in bm.verts if not v.link_edges]
if loose:
    bmesh.ops.delete(bm, geom=loose, context='VERTS')

# 끝단을 가늘게 좁힌다. 자른 단면이 그대로 남으면 잘린 파이프처럼 보인다.
for v in bm.verts:
    if (v.co - cen).y >= 0.0:
        continue
    a = _pil_ang(v)
    if a >= TAPER_TO:
        continue
    t = (a - OPEN_HALF) / (TAPER_TO - OPEN_HALF)
    k = 0.72 + 0.28 * max(0.0, min(1.0, t))
    rad = Vector((v.co.x - cen.x, v.co.y - cen.y, 0.0))
    if rad.length < 1e-6:
        continue
    ring = cen + rad.normalized() * PIL_MAJOR
    v.co = ring + (v.co - ring) * k

# 뚫린 양 끝을 둥글게 막는다. 열린 경계 20개가 '잘린 파이프'로 보이던 원인이다.
# 한 번에 poke 로 막으면 꼭짓점 하나가 뾰족한 원뿔로 튀어나와 부리처럼 보인다.
# 링을 두 단계로 좁혀 가며 덮어야 둥근 마감이 된다.
bm.edges.ensure_lookup_table()
_all_c = sum((v.co for v in bm.verts), Vector()) / len(bm.verts)
caps = 0
for _ in range(4):
    bnd = [e for e in bm.edges if len(e.link_faces) == 1]
    if not bnd:
        break
    adj = {}
    for e in bnd:
        a, b = e.verts
        adj.setdefault(a, set()).add(b)
        adj.setdefault(b, set()).add(a)
    start = next(iter(adj))
    comp, stack = set(), [start]
    while stack:
        n = stack.pop()
        if n in comp:
            continue
        comp.add(n)
        stack.extend(adj[n] - comp)
    ring = [e for e in bnd if e.verts[0] in comp and e.verts[1] in comp]
    ctr = sum((v.co for v in comp), Vector()) / len(comp)
    # 끝단이 향하는 방향 = 링 평면의 법선. Newell 법은 정점이 '루프 순서'로
    # 들어와야 한다. set 에서 그냥 꺼내면 순서가 없어 법선이 쓰레기가 되고
    # 캡이 엉뚱한 방향으로 뾰족하게 튀어나온다.
    ring_v = [start]
    prev = None
    while True:
        nxt = [x for x in adj[ring_v[-1]] if x is not prev]
        if not nxt:
            break
        nxt = nxt[0] if len(nxt) == 1 else [x for x in nxt if x is not ring_v[0]][0]
        if nxt is ring_v[0]:
            break
        prev = ring_v[-1]
        ring_v.append(nxt)
        if len(ring_v) > len(comp):
            raise RuntimeError("pillow cap: loop walk did not close")
    if len(ring_v) != len(comp):
        raise RuntimeError("pillow cap: loop walk covered %d of %d"
                           % (len(ring_v), len(comp)))
    nrm = Vector((0.0, 0.0, 0.0))
    for a in range(len(ring_v)):
        p1 = ring_v[a].co - ctr
        p2 = ring_v[(a + 1) % len(ring_v)].co - ctr
        nrm += p1.cross(p2)
    if nrm.length < 1e-9:
        raise RuntimeError("pillow cap: degenerate ring")
    nrm.normalize()
    if nrm.dot(ctr - _all_c) < 0:
        nrm = -nrm
    # 끝단을 정확한 반구 프로파일로 덮는다. 링을 임의 비율로 줄이면
    # 정으로 깎은 듯 각진 팁이 남는다. sin/cos 로 반구를 그려야 둥글다.
    base_ctr = ctr.copy()
    h_prev, s_prev = 0.0, 1.0
    for a_deg in (30.0, 60.0, 78.0):
        h_new = PIL_MINOR * math.sin(D(a_deg))
        s_new = math.cos(D(a_deg))
        ext = bmesh.ops.extrude_edge_only(bm, edges=ring)
        nv = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
        for v in nv:
            off = (v.co - base_ctr - nrm * h_prev) / s_prev
            v.co = base_ctr + nrm * h_new + off * s_new
        ring = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMEdge)
                and len(g.link_faces) == 1]
        h_prev, s_prev = h_new, s_new
        bm.edges.ensure_lookup_table()
    res = bmesh.ops.contextual_create(bm, geom=ring)
    if not res["faces"]:
        raise RuntimeError("pillow end cap failed")
    caps += 1
    bm.edges.ensure_lookup_table()
if caps != 2:
    raise RuntimeError("pillow: expected 2 end caps, made %d" % caps)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
rep["pillow_caps"] = caps
bm.to_mesh(pil.data)
bm.free()
pil.data.update()
if len(pil.data.vertices) < 60:
    raise RuntimeError("pillow collapsed: %d verts" % len(pil.data.vertices))
set_active(pil)
bpy.ops.object.shade_smooth()
pil.data.materials.clear()
pil.data.materials.append(pillow_mat)
# 목베개는 Head 에 싣는다. Z축 토러스라 고개를 좌우로 돌리면(ry) 제자리에서
# 돌 뿐 형상이 바뀌지 않아 목을 파고들지 않는다. Chest 에 실으면 목이 튜브를
# 옆으로 쓸고 지나가 30mm 씩 파묻힌다 (실측).
vgp = pil.vertex_groups.new(name="Head")
vgp.add(range(len(pil.data.vertices)), 1.0, 'REPLACE')
rep["pillow"] = {"verts": len(pil.data.vertices),
                 "tris": sum(len(p.vertices) - 2 for p in pil.data.polygons),
                 "major_r": round(PIL_MAJOR, 4), "minor_r": PIL_MINOR,
                 "z": round(PIL_Z, 4),
                 "color": PILLOW_HEX}

set_active(mesh)
pil.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.join()
mesh = need_obj("CP_Character")
if "CP_Pillow" not in [m.name for m in mesh.data.materials]:
    raise RuntimeError("pillow material lost during join")
# 기존 캐릭터 4종에 공통으로 남아 있던 고립 정점 2개를 CP 에서는 정리한다
bm = bmesh.new()
bm.from_mesh(mesh.data)
lo = [v for v in bm.verts if not v.link_edges]
rep["loose_verts_removed"] = len(lo)
if lo:
    bmesh.ops.delete(bm, geom=lo, context='VERTS')
bm.to_mesh(mesh.data)
bm.free()
mesh.data.update()

# ------------------------------------------------ 8. 포즈 — 팔 수치 해석
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
    return par, math.sqrt(max(best, 0.0))


# 서 있는 기본 자세 — 에스컬레이터 좌측을 점거하고 무심하게 서 있다
UPPER_BASE = {"Hips": (0, 0, 0), "Spine": (2, 0, 0), "Chest": (3, 0, 0),
              "Head": (2, 0, 0), "Shoulder.L": (0, 0, 0), "Shoulder.R": (0, 0, 0),
              }
for bn, sn in BASE_LOWER.items():
    pb = rig.pose.bones[bn]
    pb.location = sn["loc"]
    pb.rotation_euler = Euler(sn["rot"], 'XYZ')
apply_pose({k: v for k, v in UPPER_BASE.items() if k != "Hips"})

# 도달률 93% 지점 — 늘어뜨린 자세가 이미 98% 라 바깥으로 빼려면 위로 올려야 한다
sh_r = rig.matrix_world @ rig.pose.bones["UpperArm.R"].head
sh_l = rig.matrix_world @ rig.pose.bones["UpperArm.L"].head
HAND_R = sh_r + Vector((-0.135, 0.030, -0.235))
ELB_R = sh_r + Vector((-0.058, 0.006, -0.126))
# MC 원본의 팔↔몸통 간격이 3.4mm 다. 이보다 좁으면 회귀다.
HAND_L = sh_l + Vector((0.047, 0.016, -0.256))
ELB_L = sh_l + Vector((0.064, 0.004, -0.128))
pr_r, err_r = solve_arm("R", HAND_R, ELB_R)
pr_l, err_l = solve_arm("L", HAND_L, ELB_L)
for side, pr in (("R", pr_r), ("L", pr_l)):
    UPPER_BASE["UpperArm." + side] = tuple(round(x, 2) for x in pr[:3])
    UPPER_BASE["LowerArm." + side] = tuple(round(x, 2) for x in pr[3:])
apply_pose({k: v for k, v in UPPER_BASE.items() if k != "Hips"})
rep["arm_solve"] = {
    "R": {"params": UPPER_BASE["UpperArm.R"] + UPPER_BASE["LowerArm.R"],
          "residual_m": round(err_r, 5),
          "hand_world": [round(v, 4) for v in tip("LowerArm.R")],
          "handle_target": [round(v, 4) for v in HAND_R]},
    "L": {"params": UPPER_BASE["UpperArm.L"] + UPPER_BASE["LowerArm.L"],
          "residual_m": round(err_l, 5),
          "hand_world": [round(v, 4) for v in tip("LowerArm.L")]}}
if err_r > 0.035:
    raise RuntimeError("right hand cannot reach the handle (residual %.4f)" % err_r)


# ------------------------------- 8-b. 손 위치에서 캐리어 좌표 역산 → Prop.Case
hand_r = tip("LowerArm.R")
# 캐리어를 끌고 가는 구조로 보이게 하려면 손잡이가 '사람 쪽 면'에 있어야 한다.
# 뒤쪽 면(±Y)에 달면 옆에 선 사람과 방향이 어긋나 비틀려 보인다.
HANDLE_OUT = 0.030                       # 케이스 중심 → 손잡이까지 (사람 쪽)
CASE_X = round(hand_r.x - HANDLE_OUT, 4)
CASE_Y = round(hand_r.y, 4)
# 손 뭉치는 뼈 끝이 곧 최하단이다(아래로 0.2mm 뿐). 그래서 봉 축을 뼈 끝에 두면
# 위쪽 절반이 손에 묻히고 아래쪽 절반이 드러나 '위에서 쥔' 모양이 된다.
# 여기서 더 내리면 봉이 손에서 완전히 떨어진다 (내려 봤다가 15mm 벌어짐).
GRIP_R = 0.0115
HANDLE_TOP = round(hand_r.z, 4)
rep["carrier_anchor"] = {"hand": [round(v, 4) for v in hand_r],
                         "case_x": CASE_X, "case_y": CASE_Y,
                         "handle_top_z": HANDLE_TOP}
if HANDLE_TOP - SOLE_Z < 0.34:
    raise RuntimeError("hand too low for a carrier handle: z=%.4f" % HANDLE_TOP)

set_active(rig)
bpy.ops.object.mode_set(mode='EDIT')
eb = rig.data.edit_bones
if "Root" not in eb:
    raise RuntimeError("Root bone missing")
if "Prop.Case" in eb:
    raise RuntimeError("Prop.Case already exists")
pc = eb.new("Prop.Case")
pc.head = Vector((CASE_X, CASE_Y, SOLE_Z))
pc.tail = Vector((CASE_X, CASE_Y, SOLE_Z + 0.080))
pc.parent = eb["Root"]
pc.use_connect = False
pc.use_deform = False
bpy.ops.object.mode_set(mode='OBJECT')
rig.pose.bones["Prop.Case"].rotation_mode = 'XYZ'
rep["rig"] = {"bones": len(rig.data.bones),
              "names": [b.name for b in rig.data.bones]}
dg.update()

# ----------------------------------------------------------- 7. 캐리어 프롭
CASE_W, CASE_D, CASE_H = 0.155, 0.108, 0.235      # 폭 · 깊이 · 높이
WHEEL_R = 0.025                                    # 바퀴 반지름
CASE_BOTTOM = SOLE_Z + 0.030                       # 케이스 밑면 — 바퀴가 떠받친다
# HANDLE_TOP 은 8-b 에서 손 위치로 역산해 둔 값을 그대로 쓴다.
# 여기서 다시 상수로 박으면 손이 손잡이에 안 닿는다.
case_top = CASE_BOTTOM + CASE_H
if HANDLE_TOP <= case_top + 0.05:
    raise RuntimeError("handle too short: top %.4f vs case top %.4f" % (HANDLE_TOP, case_top))

bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
case = bpy.context.active_object
case.name = "PR_Carrier"
case.data.name = "PR_Carrier"
case.scale = (CASE_D, CASE_W, CASE_H)   # 긴 면을 앞뒤(Y)로 — 끌고 가는 방향
set_active(case)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bev = case.modifiers.new("Round", 'BEVEL')
bev.width = 0.014
bev.segments = 2
bev.limit_method = 'ANGLE'
bpy.ops.object.modifier_apply(modifier=bev.name)
bpy.ops.object.shade_smooth()
case.location = (CASE_X, CASE_Y, CASE_BOTTOM + CASE_H / 2.0)
set_active(case)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
case.data.materials.clear()
case.data.materials.append(case_mat)
case.data.materials.append(AJ_DARK)        # 슬롯 1 = 바퀴 · 손잡이

parts = []
# 바퀴 4개
for sx in (-1, 1):
    for sy in (-1, 1):
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=12, radius=WHEEL_R, depth=0.018,
            location=(CASE_X + sx * (CASE_D * 0.30),
                      CASE_Y + sy * (CASE_W * 0.30),
                      SOLE_Z + WHEEL_R))          # 바퀴 밑면이 정확히 바닥에 닿는다
        w = bpy.context.active_object
        w.rotation_euler = (0.0, math.radians(90), 0.0)
        set_active(w)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        bpy.ops.object.shade_smooth()
        w.data.materials.clear()
        w.data.materials.append(AJ_DARK)
        parts.append(w)
# 텔레스코픽 손잡이 — 세로 봉 2 + 가로 그립 1
for sx in (-1, 1):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=8, radius=0.0075, depth=HANDLE_TOP - case_top,
        location=(CASE_X + HANDLE_OUT, CASE_Y + sx * 0.038,
                  (case_top + HANDLE_TOP) / 2.0))
    r = bpy.context.active_object
    set_active(r)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_smooth()
    r.data.materials.clear()
    r.data.materials.append(AJ_DARK)
    parts.append(r)
bpy.ops.mesh.primitive_cylinder_add(
    vertices=10, radius=GRIP_R, depth=0.100,
    location=(CASE_X + HANDLE_OUT, CASE_Y, HANDLE_TOP))
grip = bpy.context.active_object
grip.rotation_euler = (math.radians(90), 0.0, 0.0)   # 봉을 앞뒤(Y)로
set_active(grip)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.shade_smooth()
grip.data.materials.clear()
grip.data.materials.append(AJ_DARK)
parts.append(grip)

set_active(case)
for p in parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = case
bpy.ops.object.join()
case = need_obj("PR_Carrier")
_cd = list(case.dimensions)
if not (abs(_cd[1] - CASE_W) < 0.008 and abs(_cd[2] - (HANDLE_TOP + 0.012 - SOLE_Z)) < 0.030):
    raise RuntimeError("carrier dimensions off: %s" % [round(v, 4) for v in _cd])
rep["carrier"] = {"verts": len(case.data.vertices),
                  "tris": sum(len(p.vertices) - 2 for p in case.data.polygons),
                  "dims": [round(v, 4) for v in _cd],
                  "mats": [m.name for m in case.data.materials],
                  "case_top_z": round(case_top, 4), "handle_top_z": HANDLE_TOP}

# 캐리어를 Prop.Case 본에 부착 (본 부모의 원점은 본 꼬리다)
pb_case = rig.pose.bones["Prop.Case"]
bone_len = rig.data.bones["Prop.Case"].length
parent_mat = rig.matrix_world @ pb_case.matrix @ Matrix.Translation((0.0, bone_len, 0.0))
case.parent = rig
case.parent_type = 'BONE'
case.parent_bone = "Prop.Case"
case.matrix_parent_inverse = Matrix.Identity(4)
case.matrix_basis = parent_mat.inverted() @ Matrix.Identity(4)
bpy.context.view_layer.update()
rep["carrier_attach"] = {"parent_bone": "Prop.Case",
                         "loc": [round(v, 5) for v in case.location],
                         "rot_deg": [round(math.degrees(v), 3) for v in case.rotation_euler]}

# 손 ↔ 손잡이 실제 표면 거리 검사.
# ZP 에서 '본 꼬리 기준 거리'만 봤다가 폰이 38mm 떠 있었다. 표면끼리 재야 한다.
dg.update()
_me = mesh.evaluated_get(dg)
_hand = [mesh.matrix_world @ _me.data.vertices[v.index].co
         for v in mesh.data.vertices
         if sum(g.weight for g in v.groups if g.group == gi["LowerArm.R"]) > 0.6]
if len(_hand) < 50:
    raise RuntimeError("bare hand region too small: %d" % len(_hand))
_kt = KDTree(len(_hand))
for i, p in enumerate(_hand):
    _kt.insert(p, i)
_kt.balance()
_cw = [case.matrix_world @ v.co for v in case.data.vertices]
_gap = min(_kt.find(p)[2] for p in _cw)
if _gap > 0.010:
    raise RuntimeError("hand does not touch the carrier handle: %.4f m" % _gap)
rep["grip"] = {"hand_to_carrier_m": round(_gap, 5)}

# 팔이 캐리어 본체를 파고들지 않는지
_arm = [mesh.matrix_world @ _me.data.vertices[v.index].co
        for v in mesh.data.vertices
        if sum(g.weight for g in v.groups
               if g.group in (gi["LowerArm.R"], gi["UpperArm.R"])) > 0.6]
_shell = [case.matrix_world @ v.co for v in case.data.vertices
          if (case.matrix_world @ v.co).z < case_top - 0.005]
_clear = min(min((a - s).length for s in _shell) for a in _arm)
if _clear < 0.012:
    raise RuntimeError("arm intersects the case shell: %.4f m" % _clear)
rep["arm_case_clearance_m"] = round(_clear, 5)

# --- 접지: 바퀴 밑면이 발바닥과 같은 바닥에 닿아야 한다 ---
_cz = [p.z for p in _cw]
if abs(min(_cz) - SOLE_Z) > 0.0015:
    raise RuntimeError("carrier not grounded: lowest z %.4f vs sole %.4f"
                       % (min(_cz), SOLE_Z))
_shell_z = [(case.matrix_world @ v.co).z for v in case.data.vertices
            if abs((case.matrix_world @ v.co).x - CASE_X) < CASE_W * 0.28]
rep["ground"] = {"carrier_min_z": round(min(_cz), 5), "sole_z": SOLE_Z,
                 "case_bottom_z": round(CASE_BOTTOM, 4), "wheel_r": WHEEL_R}

# --- 팔 ↔ 몸통: MC 원본 3.4mm 보다 좁아지면 회귀 ---
_torso = [mesh.matrix_world @ _me.data.vertices[v.index].co for v in mesh.data.vertices
          if sum(g.weight for g in v.groups
                 if g.group in (gi["Spine"], gi["Chest"], gi["Hips"])) > 0.85]
rep["arm_torso_gap_m"] = {}
for _s in ("L", "R"):
    _a = [mesh.matrix_world @ _me.data.vertices[v.index].co for v in mesh.data.vertices
          if sum(g.weight for g in v.groups
                 if g.group in (gi["UpperArm." + _s], gi["LowerArm." + _s])) > 0.6]
    _dg2 = min(min((x - t).length for t in _torso) for x in _a)
    rep["arm_torso_gap_m"][_s] = round(_dg2, 5)
    if _dg2 < 0.0034:
        raise RuntimeError("arm.%s digs into torso: %.4f (MC baseline 0.0034)" % (_s, _dg2))

# --- 넥필로우가 머리·어깨에 묻히는 깊이 ---
_pslot = [i for i, m in enumerate(mesh.data.materials) if m and m.name == "CP_Pillow"][0]
_pverts = sorted({vi for p in mesh.data.polygons if p.material_index == _pslot
                  for vi in p.vertices})
_btris = []
for _p in _me.data.polygons:
    if _p.material_index == _pslot:
        continue
    _iv = list(_p.vertices)
    for _k in range(1, len(_iv) - 1):
        _btris.append((_iv[0], _iv[_k], _iv[_k + 1]))
_bw = [mesh.matrix_world @ v.co for v in _me.data.vertices]
_bbvh = BVHTree.FromPolygons([tuple(v) for v in _bw], _btris, all_triangles=True)


def _in_body(pt):
    o = Vector(pt)
    d = Vector((1.0, 0.0, 0.0))
    h = 0
    for _ in range(64):
        r = _bbvh.ray_cast(o, d)
        if r[0] is None:
            break
        h += 1
        o = r[0] + d * 1e-4
    return h % 2 == 1


_pdep = 0.0
for _vi in _pverts:
    _q = _bw[_vi]
    if _in_body(_q):
        _n = _bbvh.find_nearest(_q)
        if _n[0] is not None:
            _pdep = max(_pdep, (_q - _n[0]).length)
rep["pillow_depth_m"] = round(_pdep, 5)
if _pdep > 0.007:
    raise RuntimeError("neck pillow buried in the body: %.4f m" % _pdep)

# ------------------------------------------------------------- 9. 액션 생성
UPPER_BASE["Prop.Case"] = (0, 0, 0)
UPPER_BONES = ["Spine", "Chest", "Head", "Shoulder.L", "UpperArm.L", "LowerArm.L",
               "Shoulder.R", "UpperArm.R", "LowerArm.R", "Prop.Case"]
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


def lower_from(sample, f):
    return {bn: {"loc": list(sn["loc"]),
                 "rot": [math.degrees(x) for x in sn["rot"]]}
            for bn, sn in sample[f].items()}


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


def blend(d, f, rot_off, loc_off=None):
    for bn in UPPER_BONES:
        d.setdefault(bn, {})["rot"] = base_upper(bn)
    for bn, axes in rot_off.items():
        base = d["Hips"]["rot"] if bn == "Hips" else list(d.get(bn, {}).get("rot", base_upper(bn)))
        for ax, keys in axes.items():
            base[ax] += curve(f, keys)
        d.setdefault(bn, {})["rot"] = base
    if loc_off:
        for bn, axes in loc_off.items():
            base = list(d.get(bn, {}).get("loc", (0.0, 0.0, 0.0)))
            for ax, keys in axes.items():
                base[ax] += curve(f, keys)
            d.setdefault(bn, {})["loc"] = base
    return d


IDLE_N, ASIDE_N, ASIDEIDLE_N = 61, 46, 61


def f_idle(f):
    d = lower_from(IDLE_LOWER, f)
    t = (f - 1) / 60.0
    tau = 2 * math.pi * t
    d = blend(d, f, {})
    br = 1.1 * math.sin(tau)
    d["Chest"]["rot"] = [base_upper("Chest")[0] + br, 0.0, 0.0]
    d["Spine"]["rot"] = [base_upper("Spine")[0] + br * 0.6, 0.0, 0.0]
    d["Head"]["rot"] = [base_upper("Head")[0] + 1.2 * math.sin(tau) + 0.8 * math.sin(tau * 3),
                        2.2 * math.sin(tau * 2), 0.0]
    for bn in ("UpperArm.L", "LowerArm.L"):
        r = list(base_upper(bn)); r[0] += br * 0.7
        d[bn]["rot"] = r
    # 손잡이를 잡은 오른팔은 거의 고정 — 캐리어에서 손이 떨어지면 안 된다
    for bn in ("UpperArm.R", "LowerArm.R"):
        r = list(base_upper(bn)); r[0] += br * 0.15
        d[bn]["rot"] = r
    return d


# 비켜서기 — 뒤를 돌아보고, 캐리어를 몸쪽으로 당기고, 오른쪽으로 물러선다.
# 실제 횡이동은 ZP 와 같이 게임 코드가 준다. 여기서는 '비키는 자세'만 만든다.
# 축 규약 (실측 확인)
#   rx = 앞으로 숙임(pitch)   ry = 좌우 돌아보기(yaw)   rz = 옆으로 갸웃(roll)
# rz 는 시선 방향을 전혀 바꾸지 못한다. '돌아본다'는 반드시 ry 다.
ASIDE_ROT = {
    "Head":  {0: [(1, 0), (10, -6), (18, -4), (30, 0), (46, 0)],
              1: [(1, 0), (10, 30), (18, 26), (30, 10), (46, 6)]},
    "Chest": {1: [(1, 0), (10, 10), (18, 12), (30, 5), (46, 4)]},
    "Spine": {1: [(1, 0), (10, 6), (18, 7), (30, 3), (46, 2)]},
    "Hips":  {1: [(1, 0), (18, 0), (28, 5), (46, 4)]},
    "UpperArm.L": {2: [(1, 0), (14, -8), (24, -5), (46, -3)]},
}
R_ARM = ("UpperArm.R", "LowerArm.R")
# 오른다리를 캐리어 쪽으로 크게 벌리면 발·종아리가 캐리어 하단 모서리를
# 2~5mm 스친다(검사기가 f31 에서 4정점 적발). 실제 횡이동은 코드가 주므로
# 다리는 무게중심만 옮기는 정도면 된다.
ASIDE_LEG = {
    "UpperLeg.R": {2: [(1, 0), (20, 0), (30, 4), (46, 3)]},
    "UpperLeg.L": {2: [(1, 0), (20, 0), (30, 3), (46, 2)]},
}
# 캐리어를 몸쪽(+X)·앞쪽(-Y)으로 당긴다. Prop.Case 본은 +Z 를 향하므로
# 본 로컬 X = 월드 X, 본 로컬 Z = 월드 -Y 다.
# 캐리어는 거의 움직이지 않는다. 블롭 팔이 짧아서, 앞으로 85mm 만 당겨도
# 손잡이가 팔 최대 도달(0.2928)을 넘어가 손이 떨어진다. 실제 횡이동은 ZP 와
# 마찬가지로 게임 코드가 주고, 이 클립은 '비키는 자세'만 만든다.
ASIDE_CASE = {"Prop.Case": {2: [(1, 0.0), (20, 0.0), (32, 0.013), (46, 0.012)]}}


def _aside_frame(f):
    d = {bn: {"loc": list(sn["loc"]),
              "rot": [math.degrees(x) for x in sn["rot"]]}
         for bn, sn in BASE_LOWER.items()}
    for bn, axes in ASIDE_LEG.items():
        for ax, keys in axes.items():
            d[bn]["rot"][ax] += curve(f, keys)
    return blend(d, f, ASIDE_ROT, ASIDE_CASE)


def _apply_frame(d):
    for bn, v in d.items():
        pb = rig.pose.bones.get(bn)
        if pb is None:
            raise RuntimeError("pose bone missing: %s" % bn)
        pb.location = v.get("loc", (0.0, 0.0, 0.0))
        pb.rotation_euler = Euler([D(x) for x in v.get("rot", (0, 0, 0))], 'XYZ')
    dg.update()


# 몸을 틀면 어깨가 움직이므로 오른팔을 그대로 두면 손이 손잡이를 떠난다(실측 22mm).
# 샘플 프레임마다 손잡이 위치로 다시 풀고 그 사이는 보간한다.
HANDLE_W = Vector((CASE_X + HANDLE_OUT, CASE_Y, HANDLE_TOP))
ARM_KEYS = [1, 10, 18, 28, 36, 46]
_arm_solved = {}
for _kf in ARM_KEYS:
    _d = _aside_frame(_kf)
    _case_dz = curve(_kf, ASIDE_CASE["Prop.Case"][2])
    _apply_frame(_d)
    _pr, _err = solve_arm("R", HANDLE_W + Vector((0.0, -_case_dz, 0.0)), ELB_R)
    if _err > 0.040:
        raise RuntimeError("right arm lost the handle at f%d (residual %.4f)" % (_kf, _err))
    _arm_solved[_kf] = ([round(x, 3) for x in _pr[:3]], [round(x, 3) for x in _pr[3:]])
rep["aside_arm_resolve"] = {str(k): v for k, v in _arm_solved.items()}


def make_once(f):
    d = _aside_frame(f)
    for _i, bn in enumerate(R_ARM):
        d[bn]["rot"] = [curve(f, [(k, _arm_solved[k][_i][ax]) for k in ARM_KEYS])
                        for ax in range(3)]
    return d


ASIDE_END = make_once(ASIDE_N)


def f_asideidle(f):
    """비켜선 자세를 유지한다. MoveAside 마지막 프레임에서 이어받는다."""
    d = lower_from(IDLE_LOWER, f)
    for bn, axes in ASIDE_LEG.items():
        for ax, keys in axes.items():
            d[bn]["rot"][ax] += curve(ASIDE_N, keys)
    d = blend(d, ASIDE_N, ASIDE_ROT, ASIDE_CASE)
    for _i, bn in enumerate(R_ARM):
        d[bn]["rot"] = list(_arm_solved[ASIDE_N][_i])
    t = (f - 1) / 60.0
    tau = 2 * math.pi * t
    br = 0.9 * math.sin(tau)
    for bn, k in (("Chest", 1.0), ("Spine", 0.6), ("UpperArm.L", 0.7), ("LowerArm.L", 0.7),
                  ("UpperArm.R", 0.15), ("LowerArm.R", 0.15)):
        r = list(d[bn]["rot"]); r[0] += br * k
        d[bn]["rot"] = r
    r = list(d["Head"]["rot"]); r[0] += 1.0 * math.sin(tau)
    d["Head"]["rot"] = r
    return d


# ------------------------------------------- CP_CarrierTornado (코믹 액션)
# 캐리어를 축으로 몸이 도는 동작. 캐리어는 제자리에서 수직축 yaw 만 돌아
# 바퀴가 계속 바닥에 붙어 있고, 몸은 Hips 를 궤도 이동시킨다.
# Root 는 건드리지 않으므로 루트 모션이 없고, 720도(2바퀴)라 시작/종료가 일치한다.
TOR_N = 76
TOR_F0, TOR_F1 = 18, 64        # 회전 구간
TOR_TURNS = 2.0                # 한 바퀴 이상 (=720도)
# 궤도 반지름. 0.16 은 정지 회전 자세에서도 어깨→손잡이가 0.316 이라 팔 최대
# 도달(0.293)을 넘는다. 상체를 46도 숙이면 어깨가 0.12 앞으로 나와 여유가 생긴다.
# 안쪽 다리는 캐리어 축에서 R-0.066 만큼 떨어진다. 케이스 반폭 0.0775 +
# 다리 반경 0.028 + 여유 0.010 = 0.1155 이상이어야 다리가 케이스를 안 지난다.
TOR_R = 0.198
TOR_PITCH = 52.0               # 더 숙일수록 어깨가 앞으로 나와 팔이 닿는다
CASE_XY = Vector((CASE_X, CASE_Y, 0.0))
HIPS_R3I = rig.data.bones["Hips"].matrix_local.to_3x3().inverted()


def _tor_w(f):
    """기본 자세(0) ↔ 회전 자세(1) 혼합비"""
    if f <= TOR_F0:
        return ease((f - 1) / float(TOR_F0 - 1))
    if f >= TOR_F1:
        return 1.0 - ease((f - TOR_F1) / float(TOR_N - TOR_F1))
    return 1.0


def _tor_theta(f):
    """궤도각(도). 회전 구간에서만 0 → 720 으로 진행한다."""
    if f <= TOR_F0:
        return 0.0
    if f >= TOR_F1:
        return TOR_TURNS * 360.0
    return TOR_TURNS * 360.0 * ease((f - TOR_F0) / float(TOR_F1 - TOR_F0))


def _tor_state(f):
    """진입/이탈에서 '위치'는 먼저, '회전'은 나중에 간다.

    동시에 가면 몸이 캐리어를 향해 도는 순간 오른쪽 어깨가 바깥으로 스윙해
    손잡이가 팔 도달(0.293) 밖으로 나간다. 먼저 다가붙고 나서 돌면 닿는다.
    """
    w = _tor_w(f)
    th = _tor_theta(f)
    w_pos = w ** 0.55                       # 앞서 간다
    w_rot = w ** 2.0                        # 뒤따라 간다
    yaw = th - 90.0 * w_rot
    phi = th                                # 봉이 이미 접선 방향이다
    tgt = CASE_XY + Vector((math.cos(D(th)), math.sin(D(th)), 0.0)) * TOR_R
    return w, th, yaw, phi, tgt * w_pos


def _tor_lower(f):
    """하체 = Idle 1프레임 + 궤도 이동/방향 + 무릎 굽힘"""
    w, th, yaw, phi, pos = _tor_state(f)
    d = {bn: {"loc": list(sn["loc"]),
              "rot": [math.degrees(x) for x in sn["rot"]]}
         for bn, sn in BASE_LOWER.items()}
    d["Hips"]["loc"] = list(HIPS_R3I @ pos)
    d["Hips"]["rot"][1] += yaw
    for side in ("L", "R"):
        d["UpperLeg." + side]["rot"][0] += -13.0 * w
        d["LowerLeg." + side]["rot"][0] += 21.0 * w
        d["Foot." + side]["rot"][0] += -8.0 * w
    d["Prop.Case"] = {"rot": [0.0, phi, 0.0]}
    return d


def _tor_upper_offsets(f):
    w, th, yaw, phi, pos = _tor_state(f)
    return {"Spine": {0: [(1, TOR_PITCH * 0.40 * w)]},
            "Chest": {0: [(1, TOR_PITCH * 0.60 * w)]},
            "Head":  {0: [(1, 16.0 * w)]}}


def _tor_bar(f):
    """현재 프레임의 손잡이 봉 중심과 방향(월드)"""
    w, th, yaw, phi, pos = _tor_state(f)
    c = math.cos(D(phi)); sn = math.sin(D(phi))
    off = Vector((HANDLE_OUT * c, HANDLE_OUT * sn, 0.0))   # 손잡이는 사람 쪽 면
    center = Vector((CASE_X, CASE_Y, HANDLE_TOP)) + off
    bar = Vector((-sn, c, 0.0))                            # 봉 방향 = 접선
    return center, bar


# 회전 구간 중간(φ=90/180/270도)을 반드시 포함한다. f18·f64 는 둘 다 φ≡0 이라
# 캐리어가 아예 안 도는 버그를 못 잡는다 (실제로 놓쳤다).
TOR_KEYS = [1, 4, 7, 10, 13, 16, 18, 29, 40, 52, 64, 66, 69, 72, 74, 76]
_tor_arm = {}
for _kf in TOR_KEYS:
    _d = _tor_lower(_kf)
    for _bn in UPPER_BONES:
        if _bn == "Prop.Case":
            continue
        _d.setdefault(_bn, {})["rot"] = base_upper(_bn)
    for _bn, _axes in _tor_upper_offsets(_kf).items():
        _r = list(_d[_bn]["rot"])
        for _ax, _keys in _axes.items():
            _r[_ax] += _keys[0][1]
        _d[_bn]["rot"] = _r
    _apply_frame(_d)
    _cn, _rt = _tor_bar(_kf)
    _w = _tor_w(_kf)
    _shR = rig.matrix_world @ rig.pose.bones["UpperArm.R"].head
    _shL = rig.matrix_world @ rig.pose.bones["UpperArm.L"].head
    # 진입 구간에는 두 손을 봉 중앙에 모았다가 w=1 에서 좌우로 벌린다.
    # 처음부터 벌려 두면 진입 중 봉의 먼 쪽 끝이 팔 도달 밖으로 나간다.
    _sep = 0.038 * _w
    _tR = _cn + _rt * _sep
    # 손잡이가 팔 도달의 99% 지점까지 가므로 팔꿈치 페널티를 거의 끈다.
    # 켜 두면 팔꿈치가 손을 끌어당겨 잔차가 50mm 씩 남는다.
    _pr, _er = solve_arm("R", _tR, _shR + Vector((0.0, 0.0, -0.13)) - _rt * 0.05,
                         elbow_w=0.05)
    _entry = {"R": ([round(x, 3) for x in _pr[:3]], [round(x, 3) for x in _pr[3:]])}
    # 왼손은 몸이 캐리어 앞까지 온 뒤에야 봉에 닿는다(w=1 구간). 진입·이탈은
    # 오일러 보간으로 손이 봉까지 이동하는 것처럼 보이게 한다.
    if _w >= 0.999:
        _tL = _cn - _rt * _sep
        _pl, _el = solve_arm("L", _tL, _shL + Vector((0.0, 0.0, -0.13)) + _rt * 0.05,
                             elbow_w=0.05)
        _entry["L"] = ([round(x, 3) for x in _pl[:3]], [round(x, 3) for x in _pl[3:]])
    # 판정은 솔버 잔차가 아니라 '손 표면 ↔ 봉 표면' 최단거리로 한다.
    dg.update()
    _mev = mesh.evaluated_get(dg)
    _cev = case.evaluated_get(dg)
    _barw = [case.matrix_world @ v.co for v in _cev.data.vertices
             if (case.matrix_world @ v.co).z > HANDLE_TOP - 0.020]
    if len(_barw) < 8:
        raise RuntimeError("tornado: grip bar verts not found at f%d" % _kf)
    _sides = ["R", "L"] if "L" in _entry else ["R"]
    for _sd in _sides:
        _hw = [mesh.matrix_world @ _mev.data.vertices[v.index].co
               for v in mesh.data.vertices
               if sum(g.weight for g in v.groups if g.group == gi["LowerArm." + _sd]) > 0.6]
        _gd = min(min((b - h).length for h in _hw) for b in _barw)
        if _gd > 0.016:
            raise RuntimeError("tornado: %s hand off the bar at f%d (%.4f m)"
                               % (_sd, _kf, _gd))
        _entry.setdefault("gap", {})[_sd] = round(_gd, 5)
    _tor_arm[_kf] = _entry
_TOR_L_KEYS = [k for k in TOR_KEYS if "L" in _tor_arm[k]]
if len(_TOR_L_KEYS) < 2:
    raise RuntimeError("tornado: left hand never reached the bar")
_TOR_L_BASE = ([base_upper("UpperArm.L")[i] for i in range(3)],
               [base_upper("LowerArm.L")[i] for i in range(3)])
_TOR_L_FULL = [(1, _TOR_L_BASE)] + [(k, _tor_arm[k]["L"]) for k in _TOR_L_KEYS] \
              + [(TOR_N, _TOR_L_BASE)]
rep["tornado_arm"] = {str(k): v for k, v in _tor_arm.items()}


def f_tornado(f):
    d = _tor_lower(f)
    for bn in UPPER_BONES:
        if bn == "Prop.Case":
            continue        # _tor_lower 가 넣은 캐리어 회전을 덮어쓰면 안 된다
        d.setdefault(bn, {})["rot"] = base_upper(bn)
    for bn, axes in _tor_upper_offsets(f).items():
        r = list(d[bn]["rot"])
        for ax, keys in axes.items():
            r[ax] += keys[0][1]
        d[bn]["rot"] = r
    for i, bn in enumerate(("UpperArm.R", "LowerArm.R")):
        d[bn]["rot"] = [curve(f, [(k, _tor_arm[k]["R"][i][ax]) for k in TOR_KEYS])
                        for ax in range(3)]
    for i, bn in enumerate(("UpperArm.L", "LowerArm.L")):
        d[bn]["rot"] = [curve(f, [(k, v[i][ax]) for k, v in _TOR_L_FULL])
                        for ax in range(3)]
    return d


a_idle = write_action("CP_Idle", IDLE_N, f_idle)
a_aside = write_action("CP_MoveAside", ASIDE_N, make_once)
a_aidle = write_action("CP_AsideIdle", ASIDEIDLE_N, f_asideidle)
a_tor = write_action("CP_CarrierTornado", TOR_N, f_tornado)

rep["actions"] = []
for a in (a_idle, a_aside, a_aidle, a_tor):
    nf = sum(len(cb.fcurves) for layer in a.layers for strip in layer.strips
             for cb in strip.channelbags)
    if nf == 0:
        raise RuntimeError("action %s has no fcurves" % a.name)
    rep["actions"].append({"name": a.name, "range": list(a.frame_range), "fcurves": nf})

ad = rig.animation_data or rig.animation_data_create()
ad.action = a_idle
scene.frame_set(1)
bpy.context.view_layer.update()

# ------------------------------------------------------------- 10. 정리 & 저장
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
                   "tris": sum(len(p.vertices) - 2 for p in o.data.polygons)
                   if o.type == 'MESH' else None}
                  for o in bpy.data.objects]

bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(OUT), copy=False)
rep["saved"] = os.path.abspath(OUT)
with open(REPORT, "w") as fh:
    json.dump(rep, fh, indent=1, ensure_ascii=False)
print("CP BUILD OK ->", OUT)
