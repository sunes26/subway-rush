"""소스 .blend 검증 — 정적 + 애니메이션 전 프레임.

ACT-05·06·08 에서 실제로 겪은 실패 모드를 전부 여기 모았다. 세 벌에 흩어져
있던 탓에 ACT-08 에서 찾은 것들이 ZP·CP 에는 없었다.

**지표를 고르는 원칙 — 잘못된 결과로도 만족될 수 있는 지표는 쓰지 않는다.**
ACT-05 는 '본 꼬리 ↔ 프롭 원점' 거리로 모든 검사를 통과한 채 폰이 38mm 떠
있었다. 그런 지표는 없는 것만 못하다.
"""
import bpy
import bmesh
import math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

# MC 원본 실측 기준선 — 절대값이 아니라 '원본 대비'로 판정한다.
MC_ARM_TORSO = 0.0034          # 맨몸 기준 팔↔몸통 최소 간격
MC_SLIDE = {"Idle": {"L": 0.0, "R": 0.0},
            "Walk": {"L": 0.0312, "R": 0.0294},
            "Run": {"L": 0.0, "R": 0.0}}
SOLE_Z = 0.0351

SAMPLE_EVERY = 3               # 관통 검사 샘플 간격 (짧은 클립은 매 프레임)


class Report(object):
    def __init__(self, code):
        self.d = {"code": code, "fail": [], "warn": []}

    def fail(self, m):
        self.d["fail"].append(m)

    def warn(self, m):
        self.d["warn"].append(m)

    @property
    def ok(self):
        return not self.d["fail"]


# ------------------------------------------------------------------ 정적
def static(spec, R):
    rig = bpy.data.objects[spec["rig"]]
    mesh = bpy.data.objects[spec["mesh"]]
    props = [(bpy.data.objects[n], b) for n, b, _ in spec["props"]]
    sc = bpy.context.scene
    d = R.d

    d["scene"] = {"fps": sc.render.fps, "blender": bpy.app.version_string}
    if sc.render.fps != 30:
        R.fail("fps != 30")

    d["transforms"] = {}
    for o in [rig, mesh] + [p[0] for p in props]:
        d["transforms"][o.name] = {"loc": [round(v, 6) for v in o.location],
                                   "scale": [round(v, 6) for v in o.scale]}
    for o in (rig, mesh):
        if max(abs(v) for v in o.location) > 1e-6:
            R.fail("%s location not zero" % o.name)
        if max(abs(v - 1.0) for v in o.scale) > 1e-6:
            R.fail("%s scale not 1" % o.name)
        if max(abs(v) for v in o.rotation_euler) > 1e-6:
            R.fail("%s rotation not zero" % o.name)

    for o, bone in props:
        if o.parent is not rig or o.parent_type != 'BONE' or o.parent_bone != bone:
            R.fail("%s not bone-parented to %s (got %r)" % (o.name, bone, o.parent_bone))
        if o.vertex_groups:
            R.warn("%s has vertex groups (should be bone-parented only)" % o.name)
        if o.modifiers:
            R.fail("%s has modifiers: %s" % (o.name, [m.name for m in o.modifiers]))
        # 잘라 만든 프롭은 열린 경계가 남기 쉽다. ACT-06 넥필로우(에지 20개)와
        # ACT-08 모자 챙(면 6 / 에지 16)이 그래서 '잘린 파이프'·'머리를 감는
        # 고리'로 보였다. 눈으로는 폭 문제로 오진하기 쉬우니 세어서 잡는다.
        bmp = bmesh.new()
        bmp.from_mesh(o.data)
        open_e = len([e for e in bmp.edges if len(e.link_faces) != 2])
        bmp.free()
        d.setdefault("prop_open_edges", {})[o.name] = open_e
        if open_e:
            R.fail("%s has %d open/non-manifold edges" % (o.name, open_e))

    mods = [(m.name, m.type) for m in mesh.modifiers]
    d["modifiers"] = {mesh.name: mods}
    if [t for _, t in mods] != ['ARMATURE']:
        R.fail("%s modifiers != [ARMATURE]: %s" % (mesh.name, mods))

    bones = [b.name for b in rig.data.bones]
    d["bones"] = {"n": len(bones), "names": bones}
    if len(bones) != spec["bones"]:
        R.fail("bone count %d != %d" % (len(bones), spec["bones"]))
    for _, bone in props:
        if bone not in bones:
            R.fail("prop parent bone %s missing from armature" % bone)

    me = mesh.data
    gnames = [g.name for g in mesh.vertex_groups]
    if set(gnames) - set(bones):
        R.fail("vertex groups not in armature: %s" % sorted(set(gnames) - set(bones)))

    maxinf = unnorm = unassigned = 0
    hist = {}
    for v in me.vertices:
        gs = [g for g in v.groups if g.weight > 1e-5]
        n = len(gs)
        maxinf = max(maxinf, n)
        hist[n] = hist.get(n, 0) + 1
        if n == 0:
            unassigned += 1
        elif abs(sum(g.weight for g in gs) - 1.0) > 1e-3:
            unnorm += 1
    # 다리 정점에 실린 팔 웨이트 — 정상이면 0.000. 0이 아니면 팔 회전이
    # 하반신을 끌고 간다(최근접 세그먼트 바인딩의 전형적 실패).
    armg = [i for i, g in enumerate(gnames) if 'Arm' in g or 'Shoulder' in g]
    legg = [i for i, g in enumerate(gnames) if 'Leg' in g or 'Foot' in g]
    bad_leg, worst = 0, 0.0
    for v in me.vertices:
        wl = sum(g.weight for g in v.groups if g.group in legg)
        wa = sum(g.weight for g in v.groups if g.group in armg)
        if wl > 0.5 and wa > 1e-4:
            bad_leg += 1
            worst = max(worst, wa)
    d["weights"] = {"verts": len(me.vertices), "max_influence": maxinf, "hist": hist,
                    "unnormalized": unnorm, "unassigned": unassigned,
                    "leg_verts_with_arm_weight": bad_leg,
                    "worst_arm_w_on_leg": round(worst, 5)}
    if maxinf > 4:
        R.fail("max bone influence %d > 4" % maxinf)
    if unnorm:
        R.fail("%d unnormalized verts" % unnorm)
    if unassigned:
        R.fail("%d unassigned verts" % unassigned)
    if bad_leg:
        R.fail("%d leg verts carry arm weight (worst %.3f)" % (bad_leg, worst))

    bm = bmesh.new()
    bm.from_mesh(me)
    loose = [v for v in bm.verts if not v.link_edges]
    flipped = sum(1 for f in bm.faces if f.normal.length < 1e-9)
    d["geometry"] = {"verts": len(bm.verts),
                     "tris": sum(len(f.verts) - 2 for f in bm.faces),
                     "loose_verts": len(loose),
                     "non_manifold_edges": len([e for e in bm.edges if not e.is_manifold]),
                     "zero_normals": flipped,
                     "materials": [m.name for m in me.materials if m]}
    bm.free()
    if loose:
        R.fail("%d loose vertices" % len(loose))
    if flipped:
        R.fail("%d zero-area/degenerate normals" % flipped)

    acts = sorted(a.name for a in bpy.data.actions)
    d["actions_in_file"] = acts
    if set(acts) != set(spec["clips"]):
        R.fail("action set mismatch: %s" % acts)


# --------------------------------------------------------------- 지오메트리 도우미
def _skin_verts(mesh, skin_mat="MC_White"):
    """맨몸 정점 인덱스.

    팔↔몸통 간격은 **반드시 맨몸끼리** 잰다. MC 기준선 3.4mm 자체가 맨몸
    수치이고, 의상 셸은 소매와 몸판이 이어진 하나의 지오메트리라 겨드랑이
    이음매의 인접 정점끼리 2mm 로 잡혀 가짜 실패가 난다(ACT-08 에서 두 번).
    """
    me = mesh.data
    slots = [i for i, m in enumerate(me.materials) if m and m.name == skin_mat]
    if not slots:
        return None
    return {vi for p in me.polygons if p.material_index in slots for vi in p.vertices}


def _group_verts(mesh, names, thr, restrict=None):
    gi = {g.name: g.index for g in mesh.vertex_groups}
    idx = [gi[n] for n in names if n in gi]
    out = []
    for v in mesh.data.vertices:
        if restrict is not None and v.index not in restrict:
            continue
        if sum(g.weight for g in v.groups if g.group in idx) > thr:
            out.append(v.index)
    return out


def _body_bvh(mesh, ev, garment_slots):
    """의상 셸을 제외한 본체 표면의 BVH (월드)."""
    m = mesh.matrix_world
    verts = [m @ v.co for v in ev.data.vertices]
    tris = []
    for p in ev.data.polygons:
        if p.material_index in garment_slots:
            continue
        vs = list(p.vertices)
        for k in range(1, len(vs) - 1):
            tris.append((vs[0], vs[k], vs[k + 1]))
    return BVHTree.FromPolygons([tuple(v) for v in verts], tris, all_triangles=True)


def _inside(bvh, p):
    """+X 레이 히트 수가 홀수면 내부."""
    o = Vector(p)
    d = Vector((1.0, 0.0, 0.0))
    hits = 0
    for _ in range(64):
        hit = bvh.ray_cast(o, d)
        if hit[0] is None:
            break
        hits += 1
        o = hit[0] + d * 1e-5
    return hits % 2 == 1


def _kd(points):
    t = KDTree(len(points))
    for i, p in enumerate(points):
        t.insert(p, i)
    t.balance()
    return t
