"""빈 씬에 GLB/FBX 를 다시 임포트해서 출고본 자체를 검증한다.

blender -b --factory-startup --python ss_reimport.py -- <glb> <fbx> <report.json>
"""
import bpy, sys, os, json, math
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
GLB, FBX, OUT = os.path.abspath(args[0]), os.path.abspath(args[1]), args[2]
R = {"fail": []}


def fail(m):
    R["fail"].append(m)


def wipe():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # glTF 임포터는 클립 길이를 '초'로 읽어 씬 fps 로 환산한다.
    # 빈 씬 기본값 24fps 로 두면 프레임 수가 0.8배로 보인다.
    bpy.context.scene.render.fps = 30
    bpy.context.scene.render.fps_base = 1.0


# Blender 5.2 glTF 임포터는 파일에 없는 'Icosphere' 플레이스홀더를 만든다.
# 기존 출고본 mc_character_rigged.glb 에서도 동일하게 재현되므로 무시한다.
IMPORTER_ARTIFACTS = {"Icosphere"}


EXPECT_ACTS = {"SS_Idle": 61, "SS_Walk": 31, "SS_Radio": 61, "SS_Guide": 40,
               "SS_TaserDraw": 23, "SS_TaserAim": 46, "SS_TaserWarn": 31,
               "SS_RadioAlert": 46, "SS_TaserHolster": 23, "SS_Chase": 19,
               "SS_TaserFire": 25}
EXPECT_BONES = 18
EXPECT_MATS = {"MC_White", "SS_Uniform", "SS_Trim", "AJ_Dark", "SS_Arc", "SS_Cartridge"}


def action_fcurves(a):
    fcs = getattr(a, "fcurves", None)
    if fcs is not None:
        return list(fcs)
    res = []
    for layer in a.layers:
        for strip in layer.strips:
            for cb in getattr(strip, "channelbags", []):
                res.extend(cb.fcurves)
    return res


def inspect(tag):
    d = {}
    objs = [o for o in bpy.data.objects if o.name not in IMPORTER_ARTIFACTS]
    d["objects"] = [{"name": o.name, "type": o.type,
                     "parent": o.parent.name if o.parent else None,
                     "parent_type": o.parent_type,
                     "parent_bone": o.parent_bone or None,
                     "loc": [round(v, 5) for v in o.location],
                     "scale": [round(v, 5) for v in o.scale],
                     "mods": [(m.name, m.type) for m in o.modifiers]}
                    for o in objs]
    arms = [o for o in objs if o.type == 'ARMATURE']
    meshes = [o for o in objs if o.type == 'MESH']
    if len(meshes) != 5:
        fail('%s: expected 5 meshes (body + taser + baton + 2 stowed), got %s'
             % (tag, [m.name for m in meshes]))
    if len(arms) != 1:
        fail("%s: expected 1 armature, got %d" % (tag, len(arms)))
        return d
    arm = arms[0]
    d["armature"] = {"name": arm.name, "bones": len(arm.data.bones),
                     "bone_names": [b.name for b in arm.data.bones],
                     "loc": [round(v, 5) for v in arm.matrix_world.translation],
                     "scale": [round(v, 5) for v in arm.matrix_world.to_scale()]}
    if len(arm.data.bones) != EXPECT_BONES:
        fail("%s: bone count %d != %d (leaf bones?)" % (tag, len(arm.data.bones), EXPECT_BONES))
    if max(abs(v) for v in arm.matrix_world.translation) > 1e-4:
        fail("%s: armature root translation %s != 0" % (tag, list(arm.matrix_world.translation)))
    if max(abs(v - 1.0) for v in arm.matrix_world.to_scale()) > 1e-3:
        fail("%s: armature scale %s != 1" % (tag, list(arm.matrix_world.to_scale())))
    if "Prop.R" not in [b.name for b in arm.data.bones]:
        fail("%s: Prop.R bone missing" % tag)

    d["meshes"] = []
    total_v = 0
    for m in meshes:
        skinned = any(md.type == 'ARMATURE' for md in m.modifiers)
        d["meshes"].append({"name": m.name, "verts": len(m.data.vertices),
                            "tris": sum(len(p.vertices) - 2 for p in m.data.polygons),
                            "mats": [x.name for x in m.data.materials if x],
                            "armature_mod": skinned,
                            "vgroups": len(m.vertex_groups),
                            "parent": m.parent.name if m.parent else None,
                            "parent_bone": m.parent_bone or None})
        total_v += len(m.data.vertices)
    d["total_verts"] = total_v
    # 정점 수로 고르면 안 된다. glTF 임포터가 머티리얼·법선 경계에서 정점을
    # 쪼개서 테이저가 444 → 1,594 개로 불어나 본체로 오인된다(실측).
    body = next((m for m in meshes if m.name.startswith("SS_Character")), None)
    if body is None:
        fail("%s: body mesh missing" % tag)
    else:
        if not any(md.type == 'ARMATURE' for md in body.modifiers):
            fail("%s: body lost Armature modifier" % tag)
        maxinf = 0
        for v in body.data.vertices:
            maxinf = max(maxinf, len([g for g in v.groups if g.weight > 1e-5]))
        d["body_max_influence"] = maxinf
        if maxinf > 4:
            fail("%s: max influence %d > 4" % (tag, maxinf))
    bs = next((m for m in meshes if m.name.startswith("PR_BatonStowed")), None)
    if bs is None:
        fail("%s: stowed baton missing" % tag)
    elif bs.parent_bone != "Hips":
        fail("%s: stowed baton lost Hips bone parent (got %r)" % (tag, bs.parent_bone))
    st = next((m for m in meshes if m.name.startswith("PR_TaserStowed")), None)
    if st is None:
        fail("%s: stowed taser missing" % tag)
    elif st.parent_bone != "Hips":
        fail("%s: stowed taser lost Hips bone parent (got %r)" % (tag, st.parent_bone))
    bt = next((m for m in meshes if m.name == "PR_Baton" or m.name.startswith("PR_Baton.")), None)
    if bt is None:
        fail("%s: baton prop missing" % tag)
    elif bt.parent_bone != "Prop.R":
        fail("%s: baton lost Prop.R bone parent (got %r)" % (tag, bt.parent_bone))
    ph = next((m for m in meshes if m.name.startswith("PR_Taser")), None)
    if ph is None:
        fail("%s: taser prop missing" % tag)
    else:
        d["taser"] = {"name": ph.name, "verts": len(ph.data.vertices),
                      "parent_bone": ph.parent_bone or None,
                      "mats": [x.name for x in ph.data.materials if x],
                      "world": [round(v, 4) for v in ph.matrix_world.translation]}
        if ph.parent_bone != "Prop.R":
            fail("%s: taser lost Prop.R bone parent (got %r)" % (tag, ph.parent_bone))

    mats = {m.name for m in bpy.data.materials}
    d["materials"] = sorted(mats)

    acts = {a.name: [round(x, 1) for x in a.frame_range] for a in bpy.data.actions}
    d["actions"] = acts
    d["n_actions"] = len(acts)

    # 캐릭터 높이 / 발바닥
    if body:
        dg = bpy.context.evaluated_depsgraph_get()
        dg.update()
        ev = body.evaluated_get(dg)
        wv = [body.matrix_world @ v.co for v in ev.data.vertices]
        d["bounds_z"] = [round(min(p.z for p in wv), 4), round(max(p.z for p in wv), 4)]
    return d


# ------------------------------------------------------------------- GLB
wipe()
bpy.ops.import_scene.gltf(filepath=GLB)
g = inspect("GLB")
gacts = set(g["actions"])
if not set(EXPECT_ACTS).issubset(gacts):
    fail("GLB: missing clips %s (got %s)" % (sorted(set(EXPECT_ACTS) - gacts), sorted(gacts)))
extra = gacts - set(EXPECT_ACTS)
if extra:
    fail("GLB: unexpected clips %s" % sorted(extra))
for n, nf in EXPECT_ACTS.items():
    fr = g["actions"].get(n)
    if fr and abs((fr[1] - fr[0]) - (nf - 1)) > 1.5:
        fail("GLB: %s frame span %s != %d" % (n, fr, nf - 1))
if not EXPECT_MATS.issubset(set(g["materials"])):
    fail("GLB: materials missing %s" % sorted(EXPECT_MATS - set(g["materials"])))
R["glb"] = g

# ------------------------------------------------------------------- FBX
wipe()
bpy.ops.import_scene.fbx(filepath=FBX)
f = inspect("FBX")
facts = set(f["actions"])
missing = [n for n in EXPECT_ACTS if not any(n in a for a in facts)]
if missing:
    fail("FBX: missing clips %s (got %s)" % (missing, sorted(facts)))
if not EXPECT_MATS.issubset(set(f["materials"])):
    fail("FBX: materials missing %s" % sorted(EXPECT_MATS - set(f["materials"])))
R["fbx"] = f

R["ok"] = not R["fail"]
with open(OUT, "w") as fh:
    json.dump(R, fh, indent=1, ensure_ascii=False)
print("REIMPORT", "PASS" if R["ok"] else "FAIL", len(R["fail"]))
