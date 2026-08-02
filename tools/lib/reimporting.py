"""출고본 재검증 드라이버 — 빈 씬에 GLB/FBX 를 다시 임포트해서 본다.

익스포트 성공 메시지는 검증이 아니다.
"""
import bpy
import json

# Blender 5.2 glTF 임포터는 파일에 없는 'Icosphere' 플레이스홀더를 만든다.
# 기존 출고본 mc_character_rigged.glb 에서도 동일하게 재현되므로 무시한다.
IMPORTER_ARTIFACTS = {"Icosphere"}


def _wipe():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # glTF 임포터는 클립 길이를 '초'로 읽어 씬 fps 로 환산한다.
    # 빈 씬 기본값 24fps 로 두면 프레임 수가 0.8배로 보인다.
    bpy.context.scene.render.fps = 30
    bpy.context.scene.render.fps_base = 1.0


def _inspect(spec, tag, fail):
    d = {}
    objs = [o for o in bpy.data.objects if o.name not in IMPORTER_ARTIFACTS]
    arms = [o for o in objs if o.type == 'ARMATURE']
    meshes = [o for o in objs if o.type == 'MESH']
    want_meshes = 1 + len(spec["props"])
    if len(meshes) != want_meshes:
        fail("%s: expected %d meshes, got %s"
             % (tag, want_meshes, sorted(m.name for m in meshes)))
    if len(arms) != 1:
        fail("%s: expected 1 armature, got %d" % (tag, len(arms)))
        return d
    arm = arms[0]
    bones = [b.name for b in arm.data.bones]
    d["armature"] = {"name": arm.name, "bones": len(bones), "bone_names": bones,
                     "loc": [round(v, 5) for v in arm.matrix_world.translation],
                     "scale": [round(v, 5) for v in arm.matrix_world.to_scale()]}
    if len(bones) != spec["bones"]:
        fail("%s: bone count %d != %d (leaf bones?)" % (tag, len(bones), spec["bones"]))
    if max(abs(v) for v in arm.matrix_world.translation) > 1e-4:
        fail("%s: armature root translation %s != 0" % (tag, list(arm.matrix_world.translation)))
    if max(abs(v - 1.0) for v in arm.matrix_world.to_scale()) > 1e-3:
        fail("%s: armature scale %s != 1" % (tag, list(arm.matrix_world.to_scale())))

    # 본체는 **이름으로** 고른다. 정점 수로 고르면 뒤바뀐다 — glTF 임포터가
    # 머티리얼·법선 경계에서 정점을 쪼개 프롭이 444 → 1,594 개가 된 적이 있다.
    body = next((m for m in meshes if m.name.startswith(spec["mesh"])), None)
    d["meshes"] = [{"name": m.name, "verts": len(m.data.vertices),
                    "tris": sum(len(p.vertices) - 2 for p in m.data.polygons),
                    "mats": [x.name for x in m.data.materials if x],
                    "armature_mod": any(md.type == 'ARMATURE' for md in m.modifiers),
                    "parent_bone": m.parent_bone or None}
                   for m in sorted(meshes, key=lambda x: x.name)]
    d["total_verts"] = sum(len(m.data.vertices) for m in meshes)
    if body is None:
        fail("%s: body mesh %s missing" % (tag, spec["mesh"]))
    else:
        if not any(md.type == 'ARMATURE' for md in body.modifiers):
            fail("%s: body lost Armature modifier" % tag)
        maxinf = 0
        for v in body.data.vertices:
            maxinf = max(maxinf, len([g for g in v.groups if g.weight > 1e-5]))
        d["body_max_influence"] = maxinf
        if maxinf > 4:
            fail("%s: max influence %d > 4" % (tag, maxinf))

    # 프롭은 이름 접두사로 찾는다 (임포터가 .001 을 붙일 수 있다)
    for _p in spec["props"]:
        pname, bone = _p["name"], _p["bone"]
        p = next((m for m in meshes
                  if m.name == pname or m.name.startswith(pname + ".")), None)
        if p is None:
            fail("%s: prop %s missing" % (tag, pname))
        elif p.parent_bone != bone:
            fail("%s: %s lost %s bone parent (got %r)" % (tag, pname, bone, p.parent_bone))
        elif bone not in bones:
            fail("%s: bone %s missing from armature" % (tag, bone))

    d["materials"] = sorted({m.name for m in bpy.data.materials})
    d["actions"] = {a.name: [round(x, 1) for x in a.frame_range] for a in bpy.data.actions}
    d["n_actions"] = len(d["actions"])
    if body:
        dg = bpy.context.evaluated_depsgraph_get()
        dg.update()
        ev = body.evaluated_get(dg)
        wv = [body.matrix_world @ v.co for v in ev.data.vertices]
        d["bounds_z"] = [round(min(p.z for p in wv), 4), round(max(p.z for p in wv), 4)]
    return d


def run(spec, glb, fbx, report):
    R = {"code": spec["code"], "fail": []}

    def fail(m):
        R["fail"].append(m)

    want_acts = {k: v[0] for k, v in spec["clips"].items()}

    _wipe()
    bpy.ops.import_scene.gltf(filepath=glb)
    g = _inspect(spec, "GLB", fail)
    got = set(g["actions"])
    if got != set(want_acts):
        fail("GLB: clip set mismatch — missing %s / unexpected %s"
             % (sorted(set(want_acts) - got), sorted(got - set(want_acts))))
    for n, nf in want_acts.items():
        fr = g["actions"].get(n)
        if fr and abs((fr[1] - fr[0]) - (nf - 1)) > 1.5:
            fail("GLB: %s frame span %s != %d" % (n, fr, nf - 1))
    if not spec["materials"].issubset(set(g["materials"])):
        fail("GLB: materials missing %s"
             % sorted(spec["materials"] - set(g["materials"])))
    R["glb"] = g

    _wipe()
    bpy.ops.import_scene.fbx(filepath=fbx)
    f = _inspect(spec, "FBX", fail)
    facts = set(f["actions"])
    missing = [n for n in want_acts if not any(n in a for a in facts)]
    if missing:
        fail("FBX: missing clips %s (got %s)" % (missing, sorted(facts)))
    if not spec["materials"].issubset(set(f["materials"])):
        fail("FBX: materials missing %s"
             % sorted(spec["materials"] - set(f["materials"])))
    R["fbx"] = f

    R["ok"] = not R["fail"]
    if report:
        with open(report, "w") as fh:
            json.dump(R, fh, indent=1, ensure_ascii=False)
    print("REIMPORT", "PASS" if R["ok"] else "FAIL", len(R["fail"]))
    for m in R["fail"][:20]:
        print("  FAIL", m)
    return R
