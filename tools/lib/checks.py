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


def _allow(spec, kind, key, default):
    """선언에 기록된 허용치. 없으면 기본 문턱.

    문턱을 그냥 느슨하게 풀면 검사가 의미를 잃는다. '이 값이 이 캐릭터에서는
    정상이며 이유는 이것' 을 선언에 남기고, 그보다 나빠지면 실패시킨다.
    """
    return spec.get("allow", {}).get(kind, {}).get(key, default)


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
    props = [(bpy.data.objects[p["name"]], p["bone"]) for p in spec["props"]]
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
        ok = _allow(spec, "open_edges", o.name, 0)
        if open_e > ok:
            R.fail("%s has %d open/non-manifold edges (allowed %d)"
                   % (o.name, open_e, ok))
        elif open_e < ok:
            R.warn("%s open edges %d < allowance %d — 허용치를 조일 수 있다"
                   % (o.name, open_e, ok))

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


# ------------------------------------------------------------ 애니메이션
def animation(spec, R):
    """전 클립 · 전 프레임 검사.

    판정 기준은 대부분 **MC 원본 대비**다. 절대값으로 두면 캐릭터마다
    임의의 문턱을 다시 정하게 되고, 회귀인지 원래 그런 건지 알 수 없다.
    """
    rig = bpy.data.objects[spec["rig"]]
    mesh = bpy.data.objects[spec["mesh"]]
    me = mesh.data
    sc = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    d = R.d
    gi = {g.name: g.index for g in mesh.vertex_groups}


    garment_mats = set(spec.get("garment_materials", ()))
    garment_slots = [i for i, m in enumerate(me.materials)
                     if m and m.name in garment_mats]
    garment_idx = sorted({vi for p in me.polygons
                          if p.material_index in garment_slots for vi in p.vertices})

    skin = _skin_verts(mesh)
    if skin is None:
        R.warn("no MC_White slot — arm↔torso gap measured on all verts")
        skin = {v.index for v in me.vertices}

    foot_idx = {s: _group_verts(mesh, ["Foot." + s], 0.6) for s in ("L", "R")}
    head_idx = _group_verts(mesh, ["Head"], 0.995)
    # 프롭마다 쥔 손이 다르다 — ACT-08 은 총이 오른손, 봉이 왼손이다.
    # 한 손으로 다 재면 봉이 오른손에서 30cm 떨어져 있다고 나온다(실측).
    hands, grips = {}, {}
    for _p in spec["props"]:
        hb = _p["hand"]
        if hb is None:
            continue
        hands[_p["name"]] = _group_verts(mesh, [hb], 0.6)
        side = hb.split(".")[-1]
        grips[_p["name"]] = _group_verts(mesh,
                                         ["UpperArm." + side, "LowerArm." + side], 0.5)
        if len(hands[_p["name"]]) < 50:
            raise RuntimeError("hand region for %s too small: %d"
                               % (_p["name"], len(hands[_p["name"]])))
    arm_idx = {s: _group_verts(mesh, ["UpperArm." + s, "LowerArm." + s], 0.6, skin)
               for s in ("L", "R")}
    torso_idx = _group_verts(mesh, ["Spine", "Chest", "Hips"], 0.85, skin)

    # 그립 접촉 판정용 구름. BVH 최근접 면으로 하면 안 된다 — BVH 는 의상 셸을
    # 빼고 만들어서, 소매가 덮은 구간에는 맨살 면이 없어 팔 속의 점이 엉덩이
    # 면으로 잡힌다(ACT-08 에서 15~27mm 깊이로 오검출).
    grip_torso = _group_verts(mesh, ["Spine", "Chest", "Hips"], 0.5)

    # '쥔 프롭' 은 hand 가 선언된 것, '매단 프롭' 은 나머지다.
    # 본 이름으로 가르면 안 된다 — CP 캐리어는 Prop.Case 지만 손이 쥔다.
    held = [(bpy.data.objects[p["name"]], p["bone"])
            for p in spec["props"] if p["hand"]]
    stowed = [(bpy.data.objects[p["name"]], p["bone"])
              for p in spec["props"] if not p["hand"]]

    ad = rig.animation_data or rig.animation_data_create()

    # 의상 셸의 기준 침투 깊이는 **정지 포즈**에서 잰다. 첫 클립에서 잡으면
    # 정렬 순서에 따라 달리는 자세가 기준이 되어 들쭉날쭉해진다.
    ad.action = None
    sc.frame_set(1)
    dg.update()
    ev0 = mesh.evaluated_get(dg)
    wv0 = [mesh.matrix_world @ v.co for v in ev0.data.vertices]
    base_depth = 0.0
    if garment_idx:
        bvh0 = _body_bvh(mesh, ev0, garment_slots)
        for i in garment_idx:
            q = wv0[i]
            if _inside(bvh0, q):
                nr = bvh0.find_nearest(q)
                if nr[0] is not None:
                    base_depth = max(base_depth, (q - nr[0]).length)
    d["garment_rest_depth_m"] = round(base_depth, 5)

    slide_base = spec.get("slide_base", {})
    d["anim"] = {}
    for name, (nf, loop) in spec["clips"].items():
        act = bpy.data.actions.get(name)
        if act is None:
            continue
        ad.action = act
        fr = [round(x, 2) for x in act.frame_range]
        if fr != [1.0, float(nf)]:
            R.fail("%s frame_range %s != [1, %d]" % (name, fr, nf))

        pen = {"prop": 0, "garment": 0.0, "prop_frame": None, "garment_frame": None}
        prev_foot = None
        slide = {"L": 0.0, "R": 0.0}
        minz, max_root_h, max_hips_h = 9e9, 0.0, 0.0
        hips_start = hips_end = 0.0
        prop_gap_max = 0.0
        face_gap_min = 9e9
        arm_torso_min = {"L": 9e9, "R": 9e9}
        stow_drift = 0.0
        stow_ref = {}
        first_snap = None
        loop_delta = None

        for f in range(1, nf + 1):
            sc.frame_set(f)
            dg.update()
            ev = mesh.evaluated_get(dg)
            wv = [mesh.matrix_world @ v.co for v in ev.data.vertices]

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
                    if fc[s].z < 0.055:      # 지지발만 센다
                        slide[s] = max(slide[s], (fc[s].xy - prev_foot[s].xy).length)
            prev_foot = fc

            head_pts = [wv[i] for i in head_idx]
            for o, _ in held:
                hand_pts = [wv[i] for i in hands[o.name]]
                pev = o.evaluated_get(dg)
                pv = [pev.matrix_world @ v.co for v in pev.data.vertices]
                prop_gap_max = max(prop_gap_max,
                                   min(min((p - q).length for q in hand_pts) for p in pv))
                face_gap_min = min(face_gap_min,
                                   min(min((p - q).length for q in head_pts) for p in pv))

            # 팔 ↔ 몸통은 반드시 맨몸끼리. MC 기준선 3.4mm 자체가 맨몸 수치다.
            for s in ("L", "R"):
                a = [wv[i] for i in arm_idx[s]]
                t = [wv[i] for i in torso_idx]
                if a and t:
                    arm_torso_min[s] = min(arm_torso_min[s],
                                           min(min((x - y).length for y in t) for x in a))

            # 허리에 매단 프롭은 그 본의 **로컬 좌표**로 비교한다. 월드 오프셋으로
            # 재면 본이 회전할 때 오프셋도 같이 돌아 가짜 드리프트가 나온다.
            for o, bone in stowed:
                oev = o.evaluated_get(dg)
                c = sum((oev.matrix_world @ v.co for v in oev.data.vertices),
                        Vector()) / len(oev.data.vertices)
                bm_ = rig.matrix_world @ rig.pose.bones[bone].matrix
                loc = bm_.inverted() @ c
                if o.name not in stow_ref:
                    stow_ref[o.name] = loc
                else:
                    stow_drift = max(stow_drift, (loc - stow_ref[o.name]).length)

            if f % SAMPLE_EVERY == 1 or nf <= 20:
                bvh = _body_bvh(mesh, ev, garment_slots)
                kt = _kd([wv[i] for i in grip_torso])
                inside_prop = 0
                for o, _ in held:
                    ka = _kd([wv[i] for i in grips[o.name]])
                    pev = o.evaluated_get(dg)
                    for v in pev.data.vertices:
                        p = pev.matrix_world @ v.co
                        if _inside(bvh, p) and not (ka.find(p)[2] < kt.find(p)[2]):
                            inside_prop += 1
                depth = 0.0
                for i in garment_idx:
                    q = wv[i]
                    if _inside(bvh, q):
                        nr = bvh.find_nearest(q)
                        if nr[0] is not None:
                            depth = max(depth, (q - nr[0]).length)
                if inside_prop > pen["prop"]:
                    pen["prop"], pen["prop_frame"] = inside_prop, f
                if depth > pen["garment"]:
                    pen["garment"], pen["garment_frame"] = depth, f

            if f == 1:
                first_snap = [Vector(p) for p in wv]
            if f == nf and loop and first_snap is not None:
                loop_delta = max((a - b).length for a, b in zip(wv, first_snap))

        ad.action = None
        e = {"frames": nf, "loop": loop, "min_z": round(minz, 5),
             "foot_slide_max_m": {k: round(v, 5) for k, v in slide.items()},
             "root_horizontal_max": round(max_root_h, 6),
             "hips_horizontal_max": round(max_hips_h, 5),
             "prop_to_hand_max_m": round(prop_gap_max, 4),
             "prop_to_face_min_m": round(face_gap_min, 4),
             "arm_torso_min_m": {k: round(v, 5) for k, v in arm_torso_min.items()},
             "prop_verts_inside_body": pen["prop"],
             "garment_max_depth_m": round(pen["garment"], 5),
             "pen_frames": [pen["prop_frame"], pen["garment_frame"]]}
        if stowed:
            e["stowed_drift_m"] = round(stow_drift, 5)
        if loop_delta is not None:
            e["loop_delta"] = round(loop_delta, 6)
        d["anim"][name] = e

        if max_root_h > 1e-4:
            R.fail("%s has horizontal root motion %.5f" % (name, max_root_h))
        if max_hips_h > spec.get("hips_orbit_ok", {}).get(name, 1e-4):
            R.fail("%s hips horizontal %.5f" % (name, max_hips_h))
        if max(hips_start, hips_end) > 1e-4:
            R.fail("%s hips not closed at ends (%.5f / %.5f)"
                   % (name, hips_start, hips_end))
        if minz < -0.002:
            R.fail("%s foot goes below ground: %.4f" % (name, minz))
        if minz > 0.075:
            R.warn("%s never touches ground plane (min z %.4f)" % (name, minz))
        if held and face_gap_min < spec.get("prop_face_min", 0.010):
            R.fail("%s prop intersects the head (%.4f)" % (name, face_gap_min))
        if held and prop_gap_max > spec.get("prop_hand_max", 0.018):
            R.fail("%s hand leaves the prop (%.4f)" % (name, prop_gap_max))
        at_min = _allow(spec, "arm_torso", name, MC_ARM_TORSO)
        for s in ("L", "R"):
            if arm_torso_min[s] < at_min:
                R.fail("%s arm.%s digs into torso: %.4f (limit %.4f)"
                       % (name, s, arm_torso_min[s], at_min))
        if stowed and stow_drift > 0.004:
            R.fail("%s stowed prop drifts off its bone: %.4f m" % (name, stow_drift))
        if loop and (loop_delta or 0) > 0.0015:
            R.fail("%s loop seam delta %.5f" % (name, loop_delta))
        pin = _allow(spec, "prop_inside", name, 0)
        if pen["prop"] > pin:
            R.fail("%s prop penetrates body at f%s (%d verts, allowed %d)"
                   % (name, pen["prop_frame"], pen["prop"], pin))
        # 의상 셸은 본체를 오프셋한 복제라 설계상 겹친다. 어깨 요크는 볼조인트
        # 위에 씌운 평면 셸이라 팔을 들면 필연적으로 접힌다 — 정지 대비
        # 증가분만 본다.
        gd_max = _allow(spec, "garment_depth", name,
                        base_depth + spec.get("garment_slack", 0.015))
        if garment_idx and pen["garment"] > gd_max:
            R.fail("%s garment swallowed at f%s (depth %.4f > limit %.4f, rest %.4f)"
                   % (name, pen["garment_frame"], pen["garment"], gd_max, base_depth))
        base = MC_SLIDE.get(slide_base.get(name, ""))
        if base is not None:
            e["mc_baseline"] = base
            for s in ("L", "R"):
                if slide[s] > base[s] + 0.0008:
                    R.fail("%s foot slide %s regressed: %.4f > MC %.4f"
                           % (name, s, slide[s], base[s]))
    sc.frame_set(1)


def run(spec, report):
    import json
    R = Report(spec["code"])
    static(spec, R)
    animation(spec, R)
    R.d["ok"] = R.ok
    if report:
        with open(report, "w") as fh:
            json.dump(R.d, fh, indent=1, ensure_ascii=False)
    print("VERIFY", "PASS" if R.ok else "FAIL",
          "fails=%d warns=%d" % (len(R.d["fail"]), len(R.d["warn"])))
    for m in R.d["fail"][:25]:
        print("  FAIL", m)
    for m in R.d["warn"][:10]:
        print("  WARN", m)
    return R
