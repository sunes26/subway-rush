"""SS 소스 정적/애니메이션 검증. blender -b ss_character.blend --python ss_verify.py -- <report.json>"""
import bpy, sys, os, math, json, bmesh
from mathutils import Vector
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree

OUT = sys.argv[sys.argv.index("--") + 1]
R = {"fail": [], "warn": []}


def need(name, coll=None):
    o = (coll or bpy.data.objects).get(name)
    if o is None:
        raise RuntimeError("missing: %s" % name)
    return o


def fail(msg):
    R["fail"].append(msg)


def warn(msg):
    R["warn"].append(msg)


rig = need("SS_Rig")
mesh = need("SS_Character")
prop = need("PR_Taser")
sc = bpy.context.scene
dg = bpy.context.evaluated_depsgraph_get()

# ---------------------------------------------------------------- 정적 검증
R["scene"] = {"fps": sc.render.fps, "blender": bpy.app.version_string}
if sc.render.fps != 30:
    fail("fps != 30")

R["transforms"] = {}
for o in (rig, mesh, prop):
    R["transforms"][o.name] = {"loc": [round(v, 6) for v in o.location],
                               "rot": [round(math.degrees(v), 4) for v in o.rotation_euler],
                               "scale": [round(v, 6) for v in o.scale]}
for o in (rig, mesh):
    if max(abs(v) for v in o.location) > 1e-6:
        fail("%s location not zero" % o.name)
    if max(abs(v - 1.0) for v in o.scale) > 1e-6:
        fail("%s scale not 1" % o.name)
    if max(abs(v) for v in o.rotation_euler) > 1e-6:
        fail("%s rotation not zero" % o.name)

if prop.parent is not rig or prop.parent_type != 'BONE' or prop.parent_bone != "Prop.R":
    fail("PR_Taser not bone-parented to Prop.R")
if prop.vertex_groups:
    warn("PR_Taser has vertex groups (should be bone-parented only)")

mods = [(m.name, m.type) for m in mesh.modifiers]
R["modifiers"] = {"SS_Character": mods, "PR_Taser": [(m.name, m.type) for m in prop.modifiers]}
if [t for _, t in mods] != ['ARMATURE']:
    fail("SS_Character modifiers != [ARMATURE]: %s" % mods)
if prop.modifiers:
    fail("PR_Taser has modifiers: %s" % [m.name for m in prop.modifiers])

bones = [b.name for b in rig.data.bones]
R["bones"] = {"n": len(bones), "names": bones,
              "deform": [b.name for b in rig.data.bones if b.use_deform]}
if len(bones) != 18:
    fail("bone count %d != 18" % len(bones))
me = mesh.data
gnames = [g.name for g in mesh.vertex_groups]
if set(gnames) - set(bones):
    fail("vertex groups not in armature: %s" % sorted(set(gnames) - set(bones)))
maxinf, unnorm, unassigned, hist = 0, 0, 0, {}
for v in me.vertices:
    gs = [g for g in v.groups if g.weight > 1e-5]
    n = len(gs)
    maxinf = max(maxinf, n)
    hist[n] = hist.get(n, 0) + 1
    if n == 0:
        unassigned += 1
    elif abs(sum(g.weight for g in gs) - 1.0) > 1e-3:
        unnorm += 1
armg = [i for i, g in enumerate(gnames) if 'Arm' in g or 'Shoulder' in g]
legg = [i for i, g in enumerate(gnames) if 'Leg' in g or 'Foot' in g]
bad_leg, worst = 0, 0.0
for v in me.vertices:
    wl = sum(g.weight for g in v.groups if g.group in legg)
    wa = sum(g.weight for g in v.groups if g.group in armg)
    if wl > 0.5 and wa > 1e-4:
        bad_leg += 1
        worst = max(worst, wa)
R["weights"] = {"verts": len(me.vertices), "max_influence": maxinf, "hist": hist,
                "unnormalized": unnorm, "unassigned": unassigned,
                "leg_verts_with_arm_weight": bad_leg, "worst_arm_w_on_leg": round(worst, 5),
                "groups": gnames}
if maxinf > 4:
    fail("max bone influence %d > 4" % maxinf)
if unnorm:
    fail("%d unnormalized verts" % unnorm)
if unassigned:
    fail("%d unassigned verts" % unassigned)
if bad_leg:
    fail("%d leg verts carry arm weight (worst %.3f)" % (bad_leg, worst))

bm = bmesh.new()
bm.from_mesh(me)
loose = [v for v in bm.verts if not v.link_edges]
flipped = sum(1 for f in bm.faces if f.normal.length < 1e-9)
R["geometry"] = {"verts": len(bm.verts),
                 "tris": sum(len(f.verts) - 2 for f in bm.faces),
                 "loose_verts": len(loose),
                 "non_manifold_edges": len([e for e in bm.edges if not e.is_manifold]),
                 "zero_normals": flipped,
                 "materials": [m.name for m in me.materials]}
bm.free()
if loose:
    fail("%d loose vertices" % len(loose))
if flipped:
    fail("%d zero-area/degenerate normals" % flipped)

# ---------------------------------------------------------- 애니메이션 검증
ACTS = {"SS_Idle": (61, True), "SS_Walk": (31, True), "SS_Radio": (61, False),
        "SS_Guide": (40, False), "SS_TaserDraw": (19, False), "SS_TaserAim": (46, True),
        "SS_TaserWarn": (31, False), "SS_RadioAlert": (46, False),
        "SS_TaserHolster": (19, False), "SS_Chase": (19, True), "SS_TaserFire": (25, False)}

# MC 원본 실측 (tools 주석 참조 — SS 검사기와 동일한 방식으로 잰 값)
MC_SLIDE = {"Idle": {"L": 0.0, "R": 0.0},
            "Walk": {"L": 0.0312, "R": 0.0294},
            "Run": {"L": 0.0, "R": 0.0}}
# 각 클립이 어느 MC 하체를 리샘플했는지 → 그 기준선으로 판정한다
SLIDE_BASE = {"SS_Idle": "Idle", "SS_Walk": "Walk", "SS_Radio": "Idle",
              "SS_Guide": "Idle", "SS_TaserDraw": "Idle", "SS_TaserAim": "Idle",
              "SS_TaserWarn": "Idle", "SS_RadioAlert": "Idle",
              "SS_TaserHolster": "Idle", "SS_Chase": "Run", "SS_TaserFire": "Idle"}
# 총을 겨누는 클립에서만 총구가 몸을 향해도 된다 (겨눈 방향이 정면이라
# 몸통 구와 각이 좁아질 수 있다). 나머지는 자기 몸을 겨누면 안 된다.
MUZZLE_EXEMPT = {"SS_TaserAim", "SS_TaserFire", "SS_TaserWarn", "SS_TaserDraw",
                 "SS_RadioAlert", "SS_Chase"}

acts_in_file = sorted(a.name for a in bpy.data.actions)
R["actions_in_file"] = acts_in_file
if set(acts_in_file) != set(ACTS):
    fail("action set mismatch: %s" % acts_in_file)

ad = rig.animation_data or rig.animation_data_create()
gi = {g.name: g.index for g in mesh.vertex_groups}
foot_idx = {s: [v.index for v in me.vertices
                if sum(g.weight for g in v.groups if g.group == gi["Foot." + s]) > 0.6]
            for s in ("L", "R")}
head_idx = [v.index for v in me.vertices
            if sum(g.weight for g in v.groups if g.group == gi["Head"]) > 0.995]
hand_idx = [v.index for v in me.vertices
            if sum(g.weight for g in v.groups if g.group == gi["LowerArm.R"]) > 0.6]
if len(hand_idx) < 50:
    raise RuntimeError("bare hand region too small: %d" % len(hand_idx))

# 맨몸 정점 — 팔↔몸통 간격은 반드시 맨몸끼리 잰다. 재킷 셸은 소매와 몸판이
# 하나로 이어진 지오메트리라 겨드랑이 이음매의 인접 정점끼리 2mm 로 잡힌다.
skin_slots = [i for i, m in enumerate(me.materials) if m and m.name == "MC_White"]
if not skin_slots:
    raise RuntimeError("MC_White slot not found")
skin = {vi for p in me.polygons if p.material_index in skin_slots for vi in p.vertices}
arm_idx = {s: [v.index for v in me.vertices
               if v.index in skin and sum(g.weight for g in v.groups
                                          if g.group in (gi["UpperArm." + s],
                                                         gi["LowerArm." + s])) > 0.6]
           for s in ("L", "R")}
torso_idx = [v.index for v in me.vertices
             if v.index in skin and sum(g.weight for g in v.groups
                                        if g.group in (gi["Spine"], gi["Chest"],
                                                       gi["Hips"])) > 0.85]

# 제복 셸 — 본체를 오프셋한 복제라 설계상 겹친다. 정지 포즈 대비 '증가분'만 본다.
garment_slots = [i for i, m in enumerate(me.materials)
                 if m and m.name in ("SS_Uniform", "SS_Trim")]
if not garment_slots:
    raise RuntimeError("garment material slots not found")
garment_idx = sorted({vi for p in me.polygons if p.material_index in garment_slots
                      for vi in p.vertices})

ARM_GROUPS = {gi["LowerArm.L"], gi["LowerArm.R"],
              gi["UpperArm.L"], gi["UpperArm.R"]}
DOM = {}
for _v in me.vertices:
    _g = max(_v.groups, key=lambda x: x.weight, default=None)
    DOM[_v.index] = _g.group if _g else -1

TASER_LOCAL_AIM = Vector((0.0, -1.0, 0.0))
SAMPLE_EVERY = 3


def body_bvh(o_eval, obj):
    """제복 셸을 제외한 본체 표면의 BVH (월드)."""
    m = obj.matrix_world
    ev_me = o_eval.data
    verts = [m @ v.co for v in ev_me.vertices]
    tris = []
    for p in ev_me.polygons:
        if p.material_index in garment_slots:
            continue
        vs = list(p.vertices)
        for k in range(1, len(vs) - 1):
            tris.append((vs[0], vs[k], vs[k + 1]))
    return BVHTree.FromPolygons([tuple(v) for v in verts], tris, all_triangles=True), tris


# 그립 접촉 판정을 'BVH 의 최근접 면이 팔인가' 로 하면 안 된다.
# BVH 는 제복 셸을 빼고 만드는데, 소매가 덮은 구간은 맨살 면이 아예 없어서
# 팔 속의 점이 엉덩이 면으로 잡힌다(ACT-08 에서 15~27mm 깊이로 오검출).
# 대신 '팔 정점 구름과 몸통 정점 구름 중 어느 쪽이 더 가까운가' 로 가른다.
armR_idx = [v.index for v in me.vertices
            if sum(g.weight for g in v.groups
                   if g.group in (gi["UpperArm.R"], gi["LowerArm.R"])) > 0.5]
torso_all_idx = [v.index for v in me.vertices
                 if sum(g.weight for g in v.groups
                        if g.group in (gi["Spine"], gi["Chest"], gi["Hips"])) > 0.5]
if len(armR_idx) < 100 or len(torso_all_idx) < 200:
    raise RuntimeError("grip-contact clouds too small: arm %d torso %d"
                       % (len(armR_idx), len(torso_all_idx)))


def _kd(points):
    t = KDTree(len(points))
    for i, p in enumerate(points):
        t.insert(p, i)
    t.balance()
    return t


def make_grip_test(wv):
    """이 프레임의 자세에서 '총 쥔 팔 안'인지 판정하는 함수를 만든다."""
    ka = _kd([wv[i] for i in armR_idx])
    kt = _kd([wv[i] for i in torso_all_idx])

    def test(pt):
        return ka.find(pt)[2] < kt.find(pt)[2]

    return test


def point_inside(bvh, p):
    d = Vector((1.0, 0.0, 0.0))
    origin = Vector(p)
    hits = 0
    for _ in range(64):
        hit = bvh.ray_cast(origin, d)
        if hit[0] is None:
            break
        hits += 1
        origin = hit[0] + d * 1e-5
    return hits % 2 == 1


GARMENT_BASE = [None]
R["anim"] = {}
for name in sorted(ACTS):
    nf, loop = ACTS[name]
    act = bpy.data.actions.get(name)
    if act is None:
        continue
    ad.action = act
    fr = [round(x, 2) for x in act.frame_range]
    if fr != [1.0, float(nf)]:
        fail("%s frame_range %s != [1, %d]" % (name, fr, nf))
    pen = {"prop": 0, "garment": 0.0, "prop_frame": None, "garment_frame": None}
    prev_foot = None
    slide = {"L": 0.0, "R": 0.0}
    minz, max_root_h, max_hips_h = 9e9, 0.0, 0.0
    hips_start = hips_end = 0.0
    prop_gap_max = 0.0
    face_gap_min = 9e9
    arm_torso_min = {"L": 9e9, "R": 9e9}
    muzzle_min_deg = 180.0
    muzzle_frame = None
    first_snapshot = None
    loop_delta = None
    for f in range(1, nf + 1):
        sc.frame_set(f)
        dg.update()
        me_ev = mesh.evaluated_get(dg)
        pr_ev = prop.evaluated_get(dg)
        wv = [mesh.matrix_world @ v.co for v in me_ev.data.vertices]
        pv = [prop.matrix_world @ v.co for v in pr_ev.data.vertices]

        pbr = rig.pose.bones["Root"]
        max_root_h = max(max_root_h, abs(pbr.location[0]), abs(pbr.location[2]))
        pbh = rig.pose.bones["Hips"]
        hips_h = max(abs(pbh.location[0]), abs(pbh.location[2]))
        max_hips_h = max(max_hips_h, hips_h)
        if f == 1:
            hips_start = hips_h
        if f == nf:
            hips_end = hips_h
        minz = min(minz, min(p.z for p in wv))

        fc = {}
        for s in ("L", "R"):
            pts = sorted((wv[i] for i in foot_idx[s]),
                         key=lambda p: p.z)[:max(1, len(foot_idx[s]) // 5)]
            fc[s] = Vector((sum(p.x for p in pts) / len(pts),
                            sum(p.y for p in pts) / len(pts),
                            sum(p.z for p in pts) / len(pts)))
        if prev_foot:
            for s in ("L", "R"):
                if fc[s].z < 0.055:
                    slide[s] = max(slide[s], (fc[s].xy - prev_foot[s].xy).length)
        prev_foot = fc

        # 손잡이가 주먹을 관통하는 구조라 '가장 가까운 손 정점까지'가 0 에 가까워야 한다
        hand_pts = [wv[i] for i in hand_idx]
        prop_gap_max = max(prop_gap_max, min(min((p - q).length for q in hand_pts)
                                             for p in pv))
        hp = [wv[i] for i in head_idx]
        face_gap_min = min(face_gap_min, min(min((p - q).length for q in hp) for p in pv))

        # 팔 ↔ 몸통 (맨몸끼리). MC 원본 기준선 3.4mm
        for s in ("L", "R"):
            a = [wv[i] for i in arm_idx[s]]
            t = [wv[i] for i in torso_idx]
            arm_torso_min[s] = min(arm_torso_min[s],
                                   min(min((x - y).length for y in t) for x in a))

        # 총구 안전 — 총열이 자기 몸통 구를 향하는가
        mtx = pr_ev.matrix_world if pr_ev.matrix_world else prop.matrix_world
        aimv = (prop.matrix_world.to_3x3() @ TASER_LOCAL_AIM).normalized()
        muzzle = min(pv, key=lambda p: (p - Vector((0, 0, 0.55))).length * 0 + p.dot(aimv) * -1)
        body_c = Vector((0.0, 0.0, 0.55))
        to_body = body_c - muzzle
        if to_body.length > 1e-6:
            adeg = math.degrees(aimv.angle(to_body))
            if adeg < muzzle_min_deg:
                muzzle_min_deg, muzzle_frame = adeg, f

        if f % SAMPLE_EVERY == 1 or nf <= 20:
            bvh, btris = body_bvh(me_ev, mesh)
            grip_test = make_grip_test(wv)
            inside_prop = sum(1 for p in pv
                              if point_inside(bvh, p) and not grip_test(p))
            depth = 0.0
            for i in garment_idx:
                q = wv[i]
                if point_inside(bvh, q):
                    near = bvh.find_nearest(q)
                    if near[0] is not None:
                        depth = max(depth, (q - near[0]).length)
            if inside_prop > pen["prop"]:
                pen["prop"], pen["prop_frame"] = inside_prop, f
            if depth > pen["garment"]:
                pen["garment"], pen["garment_frame"] = depth, f
        if f == 1:
            first_snapshot = [Vector(p) for p in wv]
        if f == nf and loop and first_snapshot is not None:
            loop_delta = max((a - b).length for a, b in zip(wv, first_snapshot))
    ad.action = None

    entry = {"frames": nf, "loop": loop, "range": fr, "min_z": round(minz, 5),
             "foot_slide_max_m": {k: round(v, 5) for k, v in slide.items()},
             "root_horizontal_max": round(max_root_h, 6),
             "hips_horizontal_max": round(max_hips_h, 5),
             "hips_start_end": [round(hips_start, 6), round(hips_end, 6)],
             "taser_to_hand_max_m": round(prop_gap_max, 4),
             "taser_to_face_min_m": round(face_gap_min, 4),
             "arm_torso_min_m": {k: round(v, 5) for k, v in arm_torso_min.items()},
             "muzzle_min_deg": round(muzzle_min_deg, 1), "muzzle_frame": muzzle_frame,
             "prop_verts_inside_body": pen["prop"],
             "garment_max_depth_m": round(pen["garment"], 5),
             "pen_frames": [pen["prop_frame"], pen["garment_frame"]]}
    if loop_delta is not None:
        entry["loop_delta"] = round(loop_delta, 6)
    R["anim"][name] = entry

    if max_root_h > 1e-4:
        fail("%s has horizontal root motion %.5f" % (name, max_root_h))
    if max_hips_h > 1e-4:
        fail("%s hips horizontal %.5f" % (name, max_hips_h))
    if minz < -0.002:
        fail("%s foot goes below ground: %.4f" % (name, minz))
    if minz > 0.075:
        warn("%s never touches ground plane (min z %.4f)" % (name, minz))
    if face_gap_min < 0.010:
        fail("%s taser intersects the head (%.4f)" % (name, face_gap_min))
    if prop_gap_max > 0.018:
        fail("%s hand leaves the taser grip (%.4f)" % (name, prop_gap_max))
    for s in ("L", "R"):
        if arm_torso_min[s] < 0.0034:
            fail("%s arm.%s digs into torso: %.4f (MC baseline 0.0034)"
                 % (name, s, arm_torso_min[s]))
    if name not in MUZZLE_EXEMPT and muzzle_min_deg < 45.0:
        fail("%s taser points at own body (%.1f deg at f%s)"
             % (name, muzzle_min_deg, muzzle_frame))
    if loop and entry.get("loop_delta", 0) > 0.0015:
        fail("%s loop seam delta %.5f" % (name, entry["loop_delta"]))
    if pen["prop"] > 0:
        fail("%s prop penetrates body at f%s (%d verts)"
             % (name, pen["prop_frame"], pen["prop"]))
    if GARMENT_BASE[0] is None:
        GARMENT_BASE[0] = pen["garment"]
    if pen["garment"] > GARMENT_BASE[0] + 0.010:
        fail("%s garment swallowed at f%s (depth %.4f vs base %.4f)"
             % (name, pen["garment_frame"], pen["garment"], GARMENT_BASE[0]))

    base = MC_SLIDE.get(SLIDE_BASE.get(name, ""))
    if base is not None:
        entry["mc_baseline"] = base
        for s in ("L", "R"):
            if slide[s] > base[s] + 0.0008:
                fail("%s foot slide %s regressed: %.4f > MC %.4f"
                     % (name, s, slide[s], base[s]))

sc.frame_set(1)
R["ok"] = not R["fail"]
with open(OUT, "w") as fh:
    json.dump(R, fh, indent=1, ensure_ascii=False)
print("VERIFY", "PASS" if R["ok"] else "FAIL",
      "fails=%d warns=%d" % (len(R["fail"]), len(R["warn"])))
for m in R["fail"][:20]:
    print("  FAIL", m)
for m in R["warn"][:10]:
    print("  WARN", m)
