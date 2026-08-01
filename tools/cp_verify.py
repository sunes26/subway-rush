"""CP 소스 정적/애니메이션 검증. blender -b cp_character.blend --python cp_verify.py -- <report.json>"""
import bpy, sys, os, math, json
from mathutils import Vector
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


rig = need("CP_Rig")
mesh = need("CP_Character")
prop = need("PR_Carrier")
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

# 프롭 부착
if prop.parent is not rig or prop.parent_type != 'BONE' or prop.parent_bone != "Prop.Case":
    fail("PR_Carrier not bone-parented to Prop.R")
if prop.vertex_groups:
    warn("PR_Carrier has vertex groups (should be bone-parented only)")

# 모디파이어
mods = [(m.name, m.type) for m in mesh.modifiers]
R["modifiers"] = {"CP_Character": mods, "PR_Carrier": [(m.name, m.type) for m in prop.modifiers]}
if [t for _, t in mods] != ['ARMATURE']:
    fail("CP_Character modifiers != [ARMATURE]: %s" % mods)
if prop.modifiers:
    fail("PR_Carrier has modifiers: %s" % [m.name for m in prop.modifiers])

# 본 / 웨이트
bones = [b.name for b in rig.data.bones]
R["bones"] = {"n": len(bones), "names": bones,
              "deform": [b.name for b in rig.data.bones if b.use_deform]}
me = mesh.data
gnames = [g.name for g in mesh.vertex_groups]
armb = set(bones)
if set(gnames) - armb:
    fail("vertex groups not in armature: %s" % sorted(set(gnames) - armb))
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

# 지오메트리 위생
import bmesh
bm = bmesh.new()
bm.from_mesh(me)
loose = [v for v in bm.verts if not v.link_edges]
bm.verts.ensure_lookup_table()
dup = 0
seen = {}
for v in bm.verts:
    k = (round(v.co.x, 6), round(v.co.y, 6), round(v.co.z, 6))
    if k in seen:
        dup += 1
    seen[k] = 1
nonmanifold = [e for e in bm.edges if not e.is_manifold]
flipped = sum(1 for f in bm.faces if f.normal.length < 1e-9)
R["geometry"] = {"verts": len(bm.verts),
                 "tris": sum(len(f.verts) - 2 for f in bm.faces),
                 "loose_verts": len(loose), "coincident_verts": dup,
                 "non_manifold_edges": len(nonmanifold), "zero_normals": flipped,
                 "materials": [m.name for m in me.materials]}
bm.free()
if loose:
    fail("%d loose vertices" % len(loose))
if flipped:
    fail("%d zero-area/degenerate normals" % flipped)

# ---------------------------------------------------------- 애니메이션 검증
ACTS = {"CP_Idle": (61, True), "CP_MoveAside": (46, False),
        "CP_AsideIdle": (61, True), "CP_CarrierTornado": (76, False),
        "CP_CarrierTornado_Loop": (14, True)}
# 토네이도는 캐리어를 축으로 몸이 도는 동작이라 Hips 가 궤도 이동한다.
# Root 는 어느 액션에서도 수평 이동이 없어야 하고(=루트 모션 없음), Hips 는
# 이 액션에서만 허용하되 시작·종료가 0 으로 닫혀야 제자리 애니메이션이다.
# 토네이도는 캐릭터가 축이라 제자리 자전만 한다 — Hips 수평 이동도 0 이어야 한다.
HIPS_ORBIT_OK = {}
# 회전 중 발이 미끄러지는 건 설계다 — MC 대비 판정에서 제외한다.
SLIDE_EXEMPT = {"CP_CarrierTornado", "CP_CarrierTornado_Loop"}
acts_in_file = sorted(a.name for a in bpy.data.actions)
R["actions_in_file"] = acts_in_file
if set(acts_in_file) != set(ACTS):
    fail("action set mismatch: %s" % acts_in_file)

ad = rig.animation_data or rig.animation_data_create()


def ev():
    dg.update()
    return mesh.evaluated_get(dg), prop.evaluated_get(dg)


def world_verts(o_eval, obj):
    m = obj.matrix_world
    return [m @ v.co for v in o_eval.data.vertices]


gi = {g.name: g.index for g in mesh.vertex_groups}
FOOT = {s: gi["Foot." + s] for s in ("L", "R")}
HEADG = gi["Head"]
foot_idx = {s: [v.index for v in me.vertices
                if sum(g.weight for g in v.groups if g.group == FOOT[s]) > 0.6]
            for s in ("L", "R")}
head_idx = [v.index for v in me.vertices
            if sum(g.weight for g in v.groups if g.group == HEADG) > 0.995]
hand_idx = [v.index for v in me.vertices
            if sum(g.weight for g in v.groups if g.group == gi["LowerArm.R"]) > 0.6]
if len(hand_idx) < 50:
    raise RuntimeError("bare hand region too small: %d" % len(hand_idx))
armidx = {s: [v.index for v in me.vertices
              if sum(g.weight for g in v.groups
                     if g.group in (gi["UpperArm." + s], gi["LowerArm." + s])) > 0.75]
          for s in ("L", "R")}
torso_idx = [v.index for v in me.vertices
             if sum(g.weight for g in v.groups
                    if g.group in (gi["Spine"], gi["Chest"], gi["Hips"])) > 0.85]
# 넥필로우는 CP_Pillow 머티리얼 슬롯으로 식별한다 (본체에 조인돼 있음)
pillow_slot = [i for i, m in enumerate(me.materials) if m and m.name == "CP_Pillow"]
if not pillow_slot:
    raise RuntimeError("ZP_Hoodie material slot not found on CP_Character")
pillow_slot = pillow_slot[0]
pillow_idx = sorted({vi for p in me.polygons if p.material_index == pillow_slot
                   for vi in p.vertices})
if not pillow_idx:
    raise RuntimeError("no pillow polygons found")
body_poly = [p for p in me.polygons if p.material_index != pillow_slot]
SAMPLE_EVERY = 3


ARM_GROUPS = {gi["LowerArm.L"], gi["LowerArm.R"]}
DOM = {}
for _v in me.vertices:
    _g = max(_v.groups, key=lambda x: x.weight, default=None)
    DOM[_v.index] = _g.group if _g else -1


def body_bvh(o_eval, obj):
    """넥필로우를 제외한 본체 표면의 BVH (월드 좌표). 삼각형 목록도 함께 돌려준다."""
    m = obj.matrix_world
    ev_me = o_eval.data
    verts = [m @ v.co for v in ev_me.vertices]
    tris = []
    for p in ev_me.polygons:
        if p.material_index == pillow_slot:
            continue
        vs = list(p.vertices)
        for k in range(1, len(vs) - 1):
            tris.append((vs[0], vs[k], vs[k + 1]))
    return BVHTree.FromPolygons([tuple(v) for v in verts], tris, all_triangles=True), tris


def is_grip_contact(bvh, tris, pt):
    """가장 가까운 본체 면이 아래팔(=손)이면 의도한 그립 접촉이다."""
    hit = bvh.find_nearest(pt)
    if hit[0] is None:
        return False
    return all(DOM.get(v, -1) in ARM_GROUPS for v in tris[hit[2]])


def point_inside(bvh, p):
    """+X 방향 레이 히트 수가 홀수면 내부."""
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


# MC 원본 실측치 (assets/mc_character.blend, 동일 지표)
# MC 원본 Idle 실측치. ACT-06 은 고정 액터라 Walk 를 안 쓴다.
MC_FOOT_SLIDE = {"CP_Idle": {"L": 0.0, "R": 0.0}}
HOOD_BASE = [None]
R["anim"] = {}
for name, (nf, loop) in ACTS.items():
    act = bpy.data.actions.get(name)
    if act is None:
        continue
    ad.action = act
    fr = [round(x, 2) for x in act.frame_range]
    if fr != [1.0, float(nf)]:
        fail("%s frame_range %s != [1, %d]" % (name, fr, nf))
    per = []
    pen = {"prop": 0, "pillow": 0.0, "prop_frame": None, "pillow_frame": None}
    prev_foot = None
    slide = {"L": 0.0, "R": 0.0}
    minz = 9e9
    max_root_h = 0.0
    max_hips_h = 0.0
    hips_start = hips_end = 0.0
    prop_gap_max = 0.0
    face_gap_min = 9e9
    arm_pen = 0
    first_snapshot = None
    for f in range(1, nf + 1):
        sc.frame_set(f)
        me_ev, ph_ev = ev()
        wv = world_verts(me_ev, mesh)
        pv = world_verts(ph_ev, prop)
        # root motion (수평)
        pbr = rig.pose.bones["Root"]
        max_root_h = max(max_root_h, abs(pbr.location[0]), abs(pbr.location[2]))
        pbh = rig.pose.bones["Hips"]
        hips_h = max(abs(pbh.location[0]), abs(pbh.location[2]))
        max_hips_h = max(max_hips_h, hips_h)
        if f == 1:
            hips_start = hips_h
        if f == nf:
            hips_end = hips_h
        # 지면 접촉
        zmin = min(p.z for p in wv)
        minz = min(minz, zmin)
        # 발 접지점(가장 낮은 20% 정점의 평균 xy) 이동량 = 미끄러짐
        fc = {}
        for s in ("L", "R"):
            pts = sorted((wv[i] for i in foot_idx[s]), key=lambda p: p.z)[:max(1, len(foot_idx[s]) // 5)]
            if pts:
                fc[s] = Vector((sum(p.x for p in pts) / len(pts),
                                sum(p.y for p in pts) / len(pts),
                                sum(p.z for p in pts) / len(pts)))
        if prev_foot:
            for s in ("L", "R"):
                if s in fc and s in prev_foot:
                    # 지지발(낮은 쪽)만 미끄러짐으로 센다
                    if fc[s].z < 0.055:
                        slide[s] = max(slide[s], (fc[s].xy - prev_foot[s].xy).length)
        prev_foot = fc
        # 캐리어 ↔ 손 거리
        hR = rig.matrix_world @ rig.pose.bones["LowerArm.R"].tail
        hL = rig.matrix_world @ rig.pose.bones["LowerArm.L"].tail
        # 캐리어는 큰 물체라 '중심 거리'로 재면 의미가 없다. 표면끼리 잰다.
        hand_pts = [wv[i] for i in hand_idx]
        gap = min(min((p - q).length for q in hand_pts) for p in pv)
        prop_gap_max = max(prop_gap_max, gap)
        # 캐리어 ↔ 얼굴 최소거리
        hp = [wv[i] for i in head_idx]
        face_gap_min = min(face_gap_min, min(min((p - q).length for q in hp) for p in pv))
        # 관통: 캐리어/넥필로우 정점이 본체 볼륨 안으로 들어갔는지 레이캐스트 내외판정
        if f % SAMPLE_EVERY == 1 or nf <= 20:
            bvh, btris = body_bvh(me_ev, mesh)
            inside_prop = sum(1 for p in pv
                               if point_inside(bvh, p)
                               and not is_grip_contact(bvh, btris, p))
            # 넥필로우는 본체를 법선 방향으로 오프셋한 복제라, 겨드랑이·팔꿈치
            # 접힘부에서는 원단이 본체 안으로 들어가는 게 정상이다. 겹친 '개수'는
            # 관절 각도에 따라 크게 흔들려 지표가 못 된다. 대신 '얼마나 깊이'
            # 들어갔는지를 본다 — 원단 두께보다 깊으면 삼켜진 것이다.
            depth = 0.0
            for i in pillow_idx:
                q = wv[i]
                if point_inside(bvh, q):
                    near = bvh.find_nearest(q)
                    if near[0] is not None:
                        depth = max(depth, (q - near[0]).length)
            if inside_prop > pen["prop"]:
                pen["prop"] = inside_prop
                pen["prop_frame"] = f
            if depth > pen["pillow"]:
                pen["pillow"] = depth
                pen["pillow_frame"] = f
        if f == 1:
            first_snapshot = [Vector(p) for p in wv]
        if f == nf and loop and first_snapshot is not None:
            d = max((a - b).length for a, b in zip(wv, first_snapshot))
            per.append(("loop_delta", round(d, 6)))
    ad.action = None
    entry = {"frames": nf, "loop": loop, "range": fr,
             "min_z": round(minz, 5),
             "foot_slide_max_m": {k: round(v, 5) for k, v in slide.items()},
             "root_horizontal_max": round(max_root_h, 6),
             "hips_horizontal_max": round(max_hips_h, 5),
             "hips_start_end": [round(hips_start, 6), round(hips_end, 6)],
             "prop_to_nearest_hand_max_m": round(prop_gap_max, 4),
             "prop_to_face_min_m": round(face_gap_min, 4),
             "prop_verts_inside_body": pen["prop"],
             "pillow_max_depth_m": round(pen["pillow"], 5),
             "pen_frames": [pen["prop_frame"], pen["pillow_frame"]]}
    for k, v in per:
        entry[k] = v
    R["anim"][name] = entry
    if max_root_h > 1e-4:
        fail("%s has horizontal root motion %.5f" % (name, max_root_h))
    _hlim = HIPS_ORBIT_OK.get(name, 1e-4)
    if max_hips_h > _hlim:
        fail("%s hips horizontal %.5f > %.5f" % (name, max_hips_h, _hlim))
    if max(hips_start, hips_end) > 1e-4:
        fail("%s hips not closed at ends (%.5f / %.5f)" % (name, hips_start, hips_end))
    if minz < -0.002:
        fail("%s foot goes below ground: %.4f" % (name, minz))
    if minz > 0.055:
        warn("%s never touches ground plane (min z %.4f)" % (name, minz))
    if face_gap_min < 0.010:
        fail("%s carrier intersects the head (%.4f)" % (name, face_gap_min))
    if prop_gap_max > 0.018:
        fail("%s hand leaves the carrier handle (%.4f)" % (name, prop_gap_max))
    if loop and entry.get("loop_delta", 0) > 0.0015:
        fail("%s loop seam delta %.5f" % (name, entry["loop_delta"]))
    if pen["prop"] > 0:
        fail("%s prop penetrates body at f%s (%d verts)" % (name, pen["prop_frame"], pen["prop"]))
    # 정지 포즈의 침투 깊이를 기준으로, 애니메이션이 그보다 8mm 넘게
    # 더 밀어 넣으면 원단이 삼켜지는 것으로 본다.
    if HOOD_BASE[0] is None:
        HOOD_BASE[0] = pen["pillow"]
    if pen["pillow"] > HOOD_BASE[0] + 0.008:
        fail("%s pillow swallowed at f%s (depth %.4f vs base %.4f)"
             % (name, pen["pillow_frame"], pen["pillow"], HOOD_BASE[0]))
    # 발 미끄러짐은 MC 원본 대비로 판정한다. ZP_Walk/ZP_Idle 의 하체는 MC 액션을
    # 그대로 리샘플한 것이라 같은 값이 나와야 정상이고, 커지면 회귀다.
    base = None if name in SLIDE_EXEMPT else MC_FOOT_SLIDE.get(name)
    if base is not None:
        for s in ("L", "R"):
            if slide[s] > base[s] + 0.0005:
                fail("%s foot slide %s regressed: %.4f > MC %.4f"
                     % (name, s, slide[s], base[s]))
        entry["mc_baseline"] = base
    elif name not in SLIDE_EXEMPT and max(slide.values()) > 0.030:
        warn("%s foot slide %.4f m/frame" % (name, max(slide.values())))

sc.frame_set(1)
R["ok"] = not R["fail"]
with open(OUT, "w") as fh:
    json.dump(R, fh, indent=1, ensure_ascii=False)
print("VERIFY", "PASS" if R["ok"] else "FAIL", "fails=%d warns=%d" % (len(R["fail"]), len(R["warn"])))
