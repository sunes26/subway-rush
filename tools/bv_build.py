"""ACT-12 붕어빵 노점상(BV) 소스 빌드.

mc_character.blend 를 열어 MC 계열만 남기고 BV 로 파생시킨 뒤
assets/bv_character.blend 로 '다른 이름 저장'한다. 원본은 저장하지 않는다.

실행:  blender -b assets/mc_character.blend --python bv_build.py -- <out.blend>

ZP·CP·SS 에서 검증된 파생 경로를 그대로 쓴다 — 베이크 메시 복제로 스킨
웨이트를 상속받고, 본 히트 재바인딩을 하지 않는다.

ACT-12 고유 판단
  * **이 액터는 움직이지 않는다.** 매니페스트상 Z1 노점(14,16)에 고정된
    정적 액터다. 그래서 하체는 6개 클립 내내 MC 정지 자세 하나뿐이고,
    다른 캐릭터에서 하던 Walk·Run 리샘플이 통째로 없다. 대신 상체와
    팔에 동작이 몰린다.
  * **노점 카트는 이미 맵에 있다** (Z1_CART_* 69부품, 2.30×1.56×2.25m).
    만드는 것은 그 뒤에 서 있는 사람이다. 그래서 기본 자세는 카트 상판을
    내려다보며 앞으로 살짝 숙인 자세다 — 곧게 선 자세면 카트와 겹칠 때
    허공을 보고 서 있는 것처럼 보인다.
  * 실루엣은 **앞치마**가 만든다. 기존 6종이 전부 상의로 갈리는데, 허리
    아래로 내려오는 앞치마는 아직 없다. 벽돌색으로 잡아 ZP(회색)·
    CP(주황갈색)·SS(남색)와 멀리서도 갈린다.
  * 프롭은 뒤집개(오른손)와 붕어빵 봉지(왼손)다. 봉지는 건네는 클립에서만
    손에 있고 나머지는 카트에 놓인 상태로 둔다 — SS 테이저와 같은 방식.
"""
import bpy, sys, os, json, math, bmesh
from mathutils import Vector, Euler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib.blend import (need_obj, need_action, need_mat, set_active,     # noqa: E402
                       principled, new_mat)
from lib.rigging import (sample_action, act_span, bone_attach,          # noqa: E402
                         arm_solver, abduct_sign, rotate_mesh_about)
from lib.meshops import (bisect, boundary_loops, dup_offset, box,       # noqa: E402
                         close_holes, push_out_of_body, open_edge_count)
from lib.anim import (ease, curve, lower_at, lower_cycle,               # noqa: E402
                      new_action, write_action)

D = math.radians
OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else None
if not OUT:
    raise RuntimeError("output .blend path required after --")
REPORT = os.environ.get("BV_REPORT", "/tmp/bv_build_report.json")

rep = {}

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
                 "blender": bpy.app.version_string}

# ------------------------------------------- 1. 하체 모션 샘플링 (정지 하나뿐)
LOWER = ["Root", "Hips", "UpperLeg.L", "LowerLeg.L", "Foot.L",
         "UpperLeg.R", "LowerLeg.R", "Foot.R"]
IDLE_F = act_span(ACT_IDLE)
IDLE_N = IDLE_F[1] - IDLE_F[0] + 1
IDLE_LOWER = sample_action(MC_RIG, ACT_IDLE, IDLE_F[0], IDLE_F[1], LOWER)
rep["lower_body_source"] = {"Idle": list(IDLE_F), "bones": LOWER,
                            "note": "정적 액터 — 하체는 이것 하나뿐"}

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
for _attr in ("grease_pencils_v3", "grease_pencils"):
    _c = getattr(bpy.data, _attr, None)
    if _c is not None:
        for gp in list(_c):
            _c.remove(gp)

# ------------------------------------------------------------------ 3. 이름/원점
rig = need_obj("MC_Rig")
mesh = need_obj("MC_Character")
rig.name = "BV_Rig"
rig.data.name = "BV_Rig"
mesh.name = "BV_Character"
mesh.data.name = "BV_Character"
for o in (rig, mesh):
    o.location = (0.0, 0.0, 0.0)
    o.rotation_euler = (0.0, 0.0, 0.0)
    o.scale = (1.0, 1.0, 1.0)
bpy.context.view_layer.update()
for pb in rig.pose.bones:
    pb.rotation_mode = 'XYZ'

dg = bpy.context.evaluated_depsgraph_get()
solve_arm = arm_solver(rig, dg)
tip, elbow = solve_arm.tip, solve_arm.elbow

# ------------------------------------------------------------------ 4. 머티리얼
# 기존 6종과 멀리서도 갈리게 잡는다 — ZP 회색 #7C7F84 · CP 주황갈색 #C97A2E ·
# SS 남색 #0E1730. 노점상의 정체 색은 앞치마다.
BV_APRON = new_mat("BV_Apron", "B2443F", 0.72)        # 벽돌색 앞치마
BV_PADDED = new_mat("BV_Padded", "4A5A63", 0.78)      # 누빔 조끼
BV_SLEEVE = new_mat("BV_Sleeve", "C9A227", 0.70)      # 토시 — 작은 면적 포인트
_slots = [m.name for m in mesh.data.materials if m]
if "MC_White" not in _slots:
    raise RuntimeError("BV_Character lost MC_White slot: %s" % _slots)
for m in (BV_PADDED, BV_APRON, BV_SLEEVE):
    mesh.data.materials.append(m)
SLOT = {m.name: i for i, m in enumerate(mesh.data.materials) if m}
rep["material_slots"] = SLOT

# 옷을 합치면 정점당 영향 본이 4를 넘고(실측 5), 잘라낸 자리에 고립 정점이
# 남는다(2개). glTF 는 정점당 4개까지고 재임포트 검사가 둘 다 잡는다.
set_active(mesh)
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
bpy.ops.object.vertex_group_limit_total(limit=4)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.delete_loose(use_verts=True, use_edges=True, use_faces=False)
bpy.ops.object.mode_set(mode='OBJECT')
mesh.select_set(False)
_inf = max((len([g for g in v.groups if g.weight > 1e-5])
            for v in mesh.data.vertices), default=0)
if _inf > 4:
    raise RuntimeError("max influence %d > 4 after limiting" % _inf)
rep["max_influence"] = _inf


def body_z(frac):
    """전신 높이 비율 → 월드 z. 치수를 손으로 적지 않는다."""
    wv = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    lo, hi = min(p.z for p in wv), max(p.z for p in wv)
    return lo + (hi - lo) * frac


BODY_LO = min((mesh.matrix_world @ v.co).z for v in mesh.data.vertices)
BODY_HI = max((mesh.matrix_world @ v.co).z for v in mesh.data.vertices)
BODY_H = BODY_HI - BODY_LO
rep["height"] = round(BODY_H, 4)

# ------------------------------------------------------------------ 5. 기본 자세
# 카트 상판을 내려다보는 자세. 곧게 세우면 허공을 보고 선 사람이 된다.
# sample_action 은 **프레임**으로 키가 잡힌다 (본이 아니다).
BASE_LOWER = {bn: {"loc": tuple(sn["loc"]), "rot": tuple(sn["rot"])}
              for bn, sn in IDLE_LOWER[IDLE_F[0]].items()}
UPPER_BASE = {"Hips": (0, 0, 0), "Spine": (4.0, 0, 0), "Chest": (5.0, 0, 0),
              "Head": (7.0, 0, 0), "Shoulder.L": (0, 0, 0), "Shoulder.R": (0, 0, 0)}


def apply_pose(d):
    for bn, rot in d.items():
        rig.pose.bones[bn].rotation_euler = Euler([D(v) for v in rot], 'XYZ')
    dg.update()


for bn, sn in BASE_LOWER.items():
    pb = rig.pose.bones[bn]
    pb.location = sn["loc"]
    pb.rotation_euler = Euler(sn["rot"], 'XYZ')
apply_pose({k: v for k, v in UPPER_BASE.items() if k != "Hips"})

SH = {s: rig.matrix_world @ rig.pose.bones["UpperArm." + s].head for s in ("L", "R")}
ARM_REACH = (rig.data.bones["UpperArm.R"].length + rig.data.bones["LowerArm.R"].length)
# 양손을 카트 상판 높이(허리 앞)로. 앞으로 숙인 자세와 짝이 맞아야 한다.
HAND = {"R": SH["R"] + Vector((-0.055, -0.150, -0.205)),
        "L": SH["L"] + Vector((0.062, -0.140, -0.212))}
ELB = {"R": SH["R"] + Vector((-0.082, -0.030, -0.128)),
       "L": SH["L"] + Vector((0.086, -0.026, -0.130))}
_pr = {}
for s in ("R", "L"):
    _pr[s], _err, _ = solve_arm(s, HAND[s], ELB[s], elbow_w=0.06)
    if _err > 0.020:
        raise RuntimeError("arm.%s base solve residual too large: %.4f" % (s, _err))
    UPPER_BASE["UpperArm." + s] = tuple(round(x, 2) for x in _pr[s][:3])
    UPPER_BASE["LowerArm." + s] = tuple(round(x, 2) for x in _pr[s][3:])
apply_pose({k: v for k, v in UPPER_BASE.items() if k != "Hips"})


def _restore_base():
    apply_pose({k: v for k, v in UPPER_BASE.items() if k != "Hips"})


# 팔을 몸에서 멀어지게 하는 부호는 눈대중하지 않고 실측한다 — 본 로컬 축은
# 본 방향에 따라 뒤집힌다. 기본 팔 각도가 정해진 뒤라야 잴 수 있다.
ABD = {s: abduct_sign(rig, dg, s,
                      list(UPPER_BASE["UpperArm." + s]) + list(UPPER_BASE["LowerArm." + s]),
                      _restore_base)
       for s in ("L", "R")}
rep["abduct_sign"] = ABD
rep["arm_solve"] = {
    "reach_m": round(ARM_REACH, 4),
    **{s: {"params": UPPER_BASE["UpperArm." + s] + UPPER_BASE["LowerArm." + s],
           "hand_world": [round(v, 4) for v in tip("LowerArm." + s)]}
       for s in ("R", "L")}}

# ------------------------------------------------------------- 6. 옷 셸 도우미
def garment(name, mat, inflate, keep, cuts=()):
    """본체를 통째로 복제해 부풀린 뒤 필요한 면만 남긴다.

    dup_offset 으로 본체 **안에** 융기를 만드는 방식은 작은 장식(견장 같은)에나
    맞는다. 옷은 밑단이 열린 셸이라 그 방식으로는 닫히지 않는다 — 조끼에서
    경계 에지 21개가 남아 close_holes 가 실패했다.
    SS 재킷과 같은 경로로 간다: 복제 → 부풀리기 → 잘라내기 → 마지막에 본체로 합침.
    정점 그룹이 복제와 함께 따라오므로 재바인딩이 필요 없다.

    **부풀린 뒤에 자른다.** 자르고 부풀리면 경계 정점의 법선이 잘린 면 때문에
    틀어져 밑단이 나팔처럼 벌어진다.
    """
    set_active(mesh)
    bpy.ops.object.duplicate()
    g = bpy.context.active_object
    g.name = name
    g.data.name = name
    for m in list(g.modifiers):
        g.modifiers.remove(m)
    g.parent = None
    bm = bmesh.new()
    bm.from_mesh(g.data)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * inflate
    bm.faces.ensure_lookup_table()
    drop = [f for f in bm.faces if not keep(f)]
    if drop:
        bmesh.ops.delete(bm, geom=drop, context='FACES')
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces],
                     context='VERTS')
    for co, no in cuts:
        bisect(bm, co, no)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces],
                     context='VERTS')
    if len(bm.faces) < 12:
        raise RuntimeError("%s: too few faces (%d)" % (name, len(bm.faces)))
    bm.normal_update()
    bm.to_mesh(g.data)
    bm.free()
    g.data.materials.clear()
    g.data.materials.append(mat)
    return g


def _mid(f):
    return f.calc_center_median()


def flat_hem(g, z, band=0.045):
    """밑단을 수평으로 눕힌다. 다리를 따라 물결치면 천이 아니라 페인트로 보인다.

    **루프 전체를 눕히면 안 된다.** 조끼처럼 위아래가 뚫린 띠는 경계 루프가
    둘이라 아래쪽만 고르면 되지만, 앞치마는 사방이 열린 한 장이라 경계
    루프가 외곽 전체다. 통째로 눕히면 위쪽 모서리까지 끌려 내려온다
    (실측: z 편차 329mm — 앞치마가 납작하게 무너졌다).
    그래서 루프가 아니라 **바닥 근처 경계 정점만** 고른다.
    """
    bm = bmesh.new()
    bm.from_mesh(g.data)
    bnd = {v for e in bm.edges if len(e.link_faces) == 1 for v in e.verts}
    hem = [v for v in bnd if v.co.z < z + band]
    if len(hem) < 6:
        bm.free()
        raise RuntimeError("%s: hem has only %d boundary verts below %.3f"
                           % (g.name, len(hem), z + band))
    spread = max(v.co.z for v in hem) - min(v.co.z for v in hem)
    for v in hem:
        v.co.z = z
    bm.normal_update()
    bm.to_mesh(g.data)
    bm.free()
    return {"verts": len(hem), "z": round(z, 4), "spread_before_m": round(spread, 4)}


# ------------------------------------------------------------------ 7. 누빔 조끼
VEST_LO, VEST_HI = body_z(0.44), body_z(0.755)
# 면 단위로 지우면 경계가 면 모양을 따라 톱니가 된다. 거칠게 지운 뒤
# 평면으로 다시 잘라 밑단·윗단을 곧게 만든다.
VEST_HX = 0.104
vest = garment("BV_Vest", BV_PADDED, 0.0090,
               lambda f: VEST_LO - 0.06 < _mid(f).z < VEST_HI + 0.06
               and abs(_mid(f).x) < VEST_HX + 0.06,
               cuts=[(Vector((0, 0, VEST_LO)), Vector((0, 0, 1))),
                     (Vector((0, 0, VEST_HI)), Vector((0, 0, -1))),
                     (Vector((VEST_HX, 0, 0)), Vector((-1, 0, 0))),
                     (Vector((-VEST_HX, 0, 0)), Vector((1, 0, 0)))])
rep["vest"] = {"verts": len(vest.data.vertices),
               "tris": sum(len(p.vertices) - 2 for p in vest.data.polygons),
               "z": [round(VEST_LO, 4), round(VEST_HI, 4)],
               "hem": flat_hem(vest, VEST_LO)}

# ------------------------------------------------------------------ 8. 앞치마
# **본체를 복제해 만들지 않는다.** 그러면 앞치마가 다리 앞면을 따라가며
# 가랑이로 파고들어 반바지로 보인다(실측). 앞치마는 매달린 천이라 몸을
# 따라가지 않는다 — 허리에서 아래로 곧게 떨어지는 판으로 짠다.
# 정점 그룹은 Hips 하나로 준다. 정적 액터라 이걸로 충분하고, 다리를 따라
# 접히지 않아 오히려 천처럼 보인다.
APRON_LO, APRON_HI = body_z(0.21), body_z(0.545)


def front_y(zlo, zhi, xlim=0.10):
    """그 높이 구간에서 몸의 가장 앞쪽 y. 앞치마를 띄울 기준이다."""
    ys = [(mesh.matrix_world @ v.co).y for v in mesh.data.vertices
          if zlo < (mesh.matrix_world @ v.co).z < zhi
          and abs((mesh.matrix_world @ v.co).x) < xlim]
    if not ys:
        raise RuntimeError("front_y: no verts in z[%.3f %.3f]" % (zlo, zhi))
    return min(ys)


AP_Y = front_y(APRON_HI - 0.05, APRON_HI) - 0.013
AP_NC, AP_NR = 9, 11
_vs, _fs = [], []
for ri in range(AP_NR):
    t = ri / (AP_NR - 1.0)                      # 0 = 허리, 1 = 밑단
    z = APRON_HI + (APRON_LO - APRON_HI) * t
    hw = 0.088 + 0.020 * t                      # 아래로 갈수록 살짝 넓어진다
    for ci in range(AP_NC):
        u = ci / (AP_NC - 1.0) - 0.5
        # 허리 쪽은 몸을 감싸고 아래로 갈수록 평평해진다
        wrap = (1.0 - t) ** 1.6 * 0.026 * (u / 0.5) ** 2
        _vs.append((u * 2 * hw, AP_Y + wrap + 0.008 * t, z))
for ri in range(AP_NR - 1):
    for ci in range(AP_NC - 1):
        i = ri * AP_NC + ci
        _fs.append((i, i + 1, i + AP_NC + 1, i + AP_NC))
_am = bpy.data.meshes.new("BV_ApronMesh")
_am.from_pydata(_vs, [], _fs)
_am.update()
apron = bpy.data.objects.new("BV_ApronMesh", _am)
bpy.context.collection.objects.link(apron)
apron.data.materials.append(BV_APRON)
set_active(apron)
_sol = apron.modifiers.new("Solidify", 'SOLIDIFY')
_sol.thickness = 0.0045
_sol.offset = 0.0
bpy.ops.object.modifier_apply(modifier=_sol.name)
bpy.ops.object.shade_flat()
_vg = apron.vertex_groups.new(name="Hips")
_vg.add(range(len(apron.data.vertices)), 1.0, 'REPLACE')
rep["apron"] = {"verts": len(apron.data.vertices),
                "tris": sum(len(p.vertices) - 2 for p in apron.data.polygons),
                "z": [round(APRON_LO, 4), round(APRON_HI, 4)],
                "front_y": round(AP_Y, 4), "weight": "Hips"}

# ------------------------------------------------------------------ 9. 토시
# 팔뚝을 감싸는 짧은 통. 본체 복제로 만들면 면 경계를 따라 톱니가 남는다.
# 팔 축을 따라 원통을 세우고 정점 그룹을 LowerArm 에 준다.
_sl = {}
_sleeves = []
for _s in ("L", "R"):
    # **레스트 좌표**를 쓴다. 메시는 레스트 공간이고 아마추어가 나중에 포즈를
    # 먹인다 — 포즈된 손 위치로 만들면 변형이 두 번 걸려 팔에서 떠 버린다
    # (실측: 팔뚝과 무관한 자리에 통이 떴다).
    _b = rig.data.bones["LowerArm." + _s]
    _e = rig.matrix_world @ _b.head_local
    _w = rig.matrix_world @ _b.tail_local
    _ax = (_w - _e)
    _len = _ax.length
    _ax = _ax.normalized()
    _a0 = _e + _ax * (_len * 0.08)
    _a1 = _e + _ax * (_len * 0.84)          # 손은 맨손으로 남긴다
    _up = Vector((0, 0, 1))
    _u = _ax.cross(_up if abs(_ax.dot(_up)) < 0.95 else Vector((1, 0, 0))).normalized()
    _v = _ax.cross(_u).normalized()
    SEG, RINGS = 10, 4
    _vs, _fs = [], []
    for k in range(RINGS):
        tt = k / (RINGS - 1.0)
        c = _a0 + (_a1 - _a0) * tt
        r = 0.0355 + 0.004 * tt
        for j in range(SEG):
            ang = 2 * math.pi * j / SEG
            _vs.append(tuple(c + (_u * math.cos(ang) + _v * math.sin(ang)) * r))
    for k in range(RINGS - 1):
        for j in range(SEG):
            i0, i1 = k * SEG + j, k * SEG + (j + 1) % SEG
            _fs.append((i0, i1, i1 + SEG, i0 + SEG))
    _sm = bpy.data.meshes.new("BV_Sleeve" + _s)
    _sm.from_pydata(_vs, [], _fs)
    _sm.update()
    _so = bpy.data.objects.new("BV_Sleeve" + _s, _sm)
    bpy.context.collection.objects.link(_so)
    _so.data.materials.append(BV_SLEEVE)
    set_active(_so)
    bpy.ops.object.shade_flat()
    _g = _so.vertex_groups.new(name="LowerArm." + _s)
    _g.add(range(len(_so.data.vertices)), 1.0, 'REPLACE')
    _sleeves.append(_so)
    _sl[_s] = {"verts": len(_so.data.vertices),
               "tris": sum(len(p.vertices) - 2 for p in _so.data.polygons)}
rep["sleeves"] = _sl

# ------------------------------- 9b. 옷이 살을 뚫은 곳을 바깥으로 밀어낸다
# **합치기 전에** 해야 한다. 합친 뒤에 부르면 기준 본체가 옷을 포함한
# 메시라 자기 자신과 비교하게 되고, 거의 모든 정점이 '안쪽'으로 잡힌다
# (실측: 9,787/9,789 개가 밀려 예외).
_parts = [vest, apron] + _sleeves
# **토시는 제외한다.** 이 보정은 본체를 부풀려 만든 셸(조끼)에 필요한 것이지,
# 팔 반경을 실측해 여유 4~5mm 로 세운 파라메트릭 통에는 해당이 없다.
# 팔꿈치 근처에서는 팔보다 몸통이 더 가까워서, 통의 안쪽 정점이 몸통 표면
# 기준으로 '안쪽'으로 잡힌다 — 40개 중 25개가 밀려 예외가 났다.
_pushed = {}
for _o in (vest, apron):
    _bm = bmesh.new()
    _bm.from_mesh(_o.data)
    try:
        _pushed[_o.name] = push_out_of_body(_bm, mesh, clear=0.0035)
    except RuntimeError as e:
        raise RuntimeError("%s: %s" % (_o.name, e))
    _bm.to_mesh(_o.data)
    _bm.free()
rep["push_out"] = _pushed

# --------------------------------------------- 9c. 옷을 본체로 합친다
bpy.ops.object.select_all(action='DESELECT')
for _o in _parts:
    _o.select_set(True)
mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.join()
mesh = need_obj("BV_Character")
_have = {m.name for m in mesh.data.materials if m}
for _need in ("MC_White", "BV_Padded", "BV_Apron", "BV_Sleeve"):
    if _need not in _have:
        raise RuntimeError("material lost during join: %s (have %s)"
                           % (_need, sorted(_have)))
SLOT = {m.name: i for i, m in enumerate(mesh.data.materials) if m}
rep["material_slots"] = SLOT

# 옷을 합치면 정점당 영향 본이 4를 넘고(실측 5), 잘라낸 자리에 고립 정점이
# 남는다(2개). glTF 는 정점당 4개까지고 재임포트 검사가 둘 다 잡는다.
set_active(mesh)
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
bpy.ops.object.vertex_group_limit_total(limit=4)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.delete_loose(use_verts=True, use_edges=True, use_faces=False)
bpy.ops.object.mode_set(mode='OBJECT')
mesh.select_set(False)
_inf = max((len([g for g in v.groups if g.weight > 1e-5])
            for v in mesh.data.vertices), default=0)
if _inf > 4:
    raise RuntimeError("max influence %d > 4 after limiting" % _inf)
rep["max_influence"] = _inf

# 옷은 밑단이 열린 셸이라 열린 에지가 남는 게 정상이다. 세어서 기록만 한다.
rep["mesh_open_edges"] = open_edge_count(mesh.data)

# ------------------------------------------------------------------ 10. 프롭
# 뒤집개 — 오른손. 붕어빵 틀을 뒤집는 도구라 이 캐릭터의 정체다.
TURN_L = 0.115
turner = box("PR_Turner", (0, 0, 0), (0.010, 0.010, TURN_L), AJ_DARK, bevel=0.0012)
# 머리를 손잡이 **아래쪽 끝**에 둔다. 가운데에 두면 주먹 안에 묻혀 안 보인다.
_head = box("PR_TurnerHead", (0, 0.006, -TURN_L * 0.40),
            (0.044, 0.005, 0.048), BV_SLEEVE, bevel=0.0010)
for o in (turner, _head):
    o.select_set(True)
bpy.context.view_layer.objects.active = turner
bpy.ops.object.join()
turner = bpy.context.active_object
turner.name = "PR_Turner"
turner.data.name = "PR_Turner"
bpy.ops.object.shade_flat()

# 봉지 — 왼손에 들리는 클립에서만 보인다.
bag = box("PR_Bag", (0, 0, 0), (0.052, 0.030, 0.062), BV_SLEEVE, bevel=0.0016)
_lip = box("PR_BagLip", (0, 0, 0.034), (0.048, 0.026, 0.008), BV_APRON, bevel=0.0010)
for o in (bag, _lip):
    o.select_set(True)
bpy.context.view_layer.objects.active = bag
bpy.ops.object.join()
bag = bpy.context.active_object
bag.name = "PR_Bag"
bag.data.name = "PR_Bag"
bpy.ops.object.shade_flat()

for _p, _bone, _side in ((turner, "Prop.R", "R"), (bag, "Prop.L", "L")):
    if _bone not in rig.data.bones:
        # MC 리그에는 프롭 본이 없다. 손 끝에 하나 만든다.
        bpy.ops.object.mode_set(mode='OBJECT')
        set_active(rig)
        bpy.ops.object.mode_set(mode='EDIT')
        _par = rig.data.edit_bones["LowerArm." + _side]
        _nb = rig.data.edit_bones.new(_bone)
        _nb.head = _par.tail
        _nb.tail = _par.tail + Vector((0, 0, -0.055))
        _nb.parent = _par
        _nb.use_connect = False
        bpy.ops.object.mode_set(mode='OBJECT')
        dg.update()

# **프롭을 손 위치로 옮긴 뒤 붙인다.** bone_attach 는 현재 월드 위치를
# 그대로 유지하므로, 원점에서 만든 채 붙이면 발밑에 매달린다(실측).
_HAND = {"R": tip("LowerArm.R"), "L": tip("LowerArm.L")}
# 뒤집개는 손에서 아래로 뻗어 카트 상판을 향한다.
turner.rotation_euler = Euler((D(-28.0), 0.0, D(-8.0)), 'XYZ')
turner.location = _HAND["R"] + Vector((0.0, -0.016, -0.014))
# 봉지는 손 아래에 매달린다.
bag.rotation_euler = Euler((D(6.0), 0.0, 0.0), 'XYZ')
bag.location = _HAND["L"] + Vector((0.006, -0.012, -0.040))
bpy.context.view_layer.update()
for _p, _bone in ((turner, "Prop.R"), (bag, "Prop.L")):
    bone_attach(rig, _p, _bone)
rep["prop_place"] = {o.name: [round(v, 4) for v in o.matrix_world.translation]
                     for o in (turner, bag)}
rep["bones"] = len(rig.data.bones)
rep["props"] = {o.name: {"tris": sum(len(p.vertices) - 2 for p in o.data.polygons),
                         "bone": o.parent_bone,
                         "dim": [round(v, 4) for v in o.dimensions]}
                for o in (turner, bag)}
bag.hide_render = True

# ------------------------------------------------------------------ 11. 클립
KEYED = (LOWER + ["Spine", "Chest", "Head", "Shoulder.L", "Shoulder.R",
                  "UpperArm.L", "LowerArm.L", "UpperArm.R", "LowerArm.R"])
CLIPS = []


def base(f, n=None):
    """n 을 주면 정지 사이클을 그 길이로 리샘플한다.

    루프 클립인데 하체를 원본 길이 그대로 순환시키면 마지막 프레임이 첫
    프레임으로 돌아오지 않아 이음매가 튄다 (실측: BV_Bake 0.00498).
    """
    d = {}
    src = (lower_cycle(IDLE_LOWER, IDLE_F[0], IDLE_N, n, f) if n
           else lower_at(IDLE_LOWER, IDLE_F[0], IDLE_N, f))
    for bn in LOWER:
        s = src[bn]
        d[bn] = {"loc": s["loc"], "rot": list(s["rot"])}
    for bn, rot in UPPER_BASE.items():
        d.setdefault(bn, {})["rot"] = list(rot)
    return d


def add(name, n, ff, loop):
    write_action(rig, KEYED, name, n, ff)
    CLIPS.append((name, n, loop))


def _breathe(d, f, n, amp=1.1):
    t = 2 * math.pi * (f - 1) / float(n - 1)
    d["Spine"]["rot"][0] += amp * math.sin(t)
    d["Chest"]["rot"][0] += amp * 0.7 * math.sin(t)
    return d


def f_idle(f):
    d = base(f, 61)
    d = _breathe(d, f, 61)
    t = 2 * math.pi * (f - 1) / 60.0
    d["Head"]["rot"][2] += 6.0 * math.sin(t)          # 지나가는 사람을 훑는다
    return d


add("BV_Idle", 61, f_idle, True)


def f_bake(f):
    """틀 뒤집기 — 오른팔이 아래로 눌렀다가 손목을 젖히듯 올린다."""
    n = 41
    d = base(f, n)                       # 루프 클립이라 하체도 n 으로 닫는다
    u = (f - 1) / float(n - 1)
    k = curve(u, [(0.0, 0.0), (0.30, 1.0), (0.55, 1.0), (0.80, -0.55), (1.0, 0.0)])
    d["UpperArm.R"]["rot"][0] += 16.0 * k
    d["LowerArm.R"]["rot"][0] += -26.0 * k
    d["Spine"]["rot"][0] += 3.5 * abs(k)
    d["Head"]["rot"][0] += 4.0 * abs(k)
    return d


add("BV_Bake", 41, f_bake, True)


def f_serve(f):
    """봉지를 건넨다 — 왼팔이 앞으로 뻗었다가 돌아온다."""
    n = 45
    d = base(f)
    u = (f - 1) / float(n - 1)
    k = curve(u, [(0.0, 0.0), (0.35, 1.0), (0.62, 1.0), (1.0, 0.0)])
    d["UpperArm.L"]["rot"][0] += -30.0 * k
    d["LowerArm.L"]["rot"][0] += -18.0 * k
    d["Shoulder.L"]["rot"][0] += -5.0 * k
    d["Spine"]["rot"][0] += -4.0 * k
    d["Head"]["rot"][0] += -6.0 * k
    return d


add("BV_Serve", 45, f_serve, False)


def f_call(f):
    """손님 부르기 — 오른손을 들어 흔든다."""
    n = 37
    d = base(f)
    u = (f - 1) / float(n - 1)
    up = curve(u, [(0.0, 0.0), (0.22, 1.0), (0.78, 1.0), (1.0, 0.0)])
    wave = math.sin(2 * math.pi * u * 2.0) * up
    d["UpperArm.R"]["rot"][0] += -52.0 * up
    # 들면서 몸에서 벌린다. 안 벌리면 팔이 몸통을 파고든다(실측 0.0006).
    d["UpperArm.R"]["rot"][2] += (1.7 * up + 1.2 * wave) * ABD["R"]
    d["LowerArm.R"]["rot"][0] += -22.0 * up
    d["Head"]["rot"][0] += -5.0 * up
    d["Spine"]["rot"][0] += -2.5 * up
    return d


add("BV_Call", 37, f_call, False)


def f_take(f):
    """돈 받기 — 오른손을 앞으로 내밀었다 거둔다."""
    n = 33
    d = base(f)
    u = (f - 1) / float(n - 1)
    k = curve(u, [(0.0, 0.0), (0.38, 1.0), (0.60, 1.0), (1.0, 0.0)])
    d["UpperArm.R"]["rot"][0] += -20.0 * k
    d["LowerArm.R"]["rot"][0] += -30.0 * k
    d["Spine"]["rot"][0] += -3.0 * k
    return d


add("BV_Take", 33, f_take, False)


def f_soldout(f):
    """품절 — 양손을 들어 가로젓는다."""
    n = 41
    d = base(f)
    u = (f - 1) / float(n - 1)
    up = curve(u, [(0.0, 0.0), (0.25, 1.0), (0.75, 1.0), (1.0, 0.0)])
    sway = math.sin(2 * math.pi * u * 1.5) * up
    for s in ("L", "R"):
        d["UpperArm." + s]["rot"][0] += -34.0 * up
        d["UpperArm." + s]["rot"][2] += (2.0 * up + 1.3 * sway) * ABD[s]
        d["LowerArm." + s]["rot"][0] += -34.0 * up
    d["Head"]["rot"][2] += 7.0 * sway
    d["Spine"]["rot"][0] += -2.0 * up
    return d


add("BV_SoldOut", 41, f_soldout, False)

rep["actions"] = {n: {"frames": f, "loop": l} for n, f, l in CLIPS}

# ------------------------------------------------------------------ 12. 정지 자세
for bn, sn in BASE_LOWER.items():
    rig.pose.bones[bn].location = sn["loc"]
    rig.pose.bones[bn].rotation_euler = Euler(sn["rot"], 'XYZ')
apply_pose({k: v for k, v in UPPER_BASE.items() if k != "Hips"})

SUMMARY = ("mesh", "rig", "bones", "height", "material_slots", "vest", "apron",
           "sleeves", "push_out", "props", "actions")
rep["mesh"] = mesh.name
rep["rig"] = rig.name
_missing = [k for k in SUMMARY if k not in rep]
if _missing:
    raise RuntimeError("report is missing summary keys: %s" % _missing)

OUT = os.path.abspath(OUT)
if os.path.normpath(OUT) == os.path.normpath(bpy.data.filepath):
    raise RuntimeError("refusing to overwrite the source file: %s" % OUT)
bpy.ops.wm.save_as_mainfile(filepath=OUT)
rep["saved"] = OUT
with open(REPORT, "w") as fh:
    json.dump(rep, fh, indent=1, ensure_ascii=False)
print("BV_BUILD OK ->", OUT)
print(json.dumps({k: rep[k] for k in SUMMARY}, ensure_ascii=False, indent=1))
