"""GLB/FBX 익스포트 드라이버.

저장소 규약 — export_apply=False · NLA 트랙 · 리프본 없음 · 정점당 영향 4 ·
리그 위치 0 · 카메라/라이트 제외.
"""
import bpy
import json
import os

from lib.blend import need_obj, set_active


def run(spec, glb, fbx, report):
    rig = need_obj(spec["rig"])
    mesh = need_obj(spec["mesh"])
    props = [(need_obj(p["name"]), p["bone"]) for p in spec["props"]]
    checks = {}

    # ---------------------------------------------------- 익스포트 전 점검
    checks["rig_location"] = [round(v, 6) for v in rig.location]
    checks["rig_rotation"] = [round(v, 6) for v in rig.rotation_euler]
    checks["rig_scale"] = [round(v, 6) for v in rig.scale]
    if max(abs(v) for v in rig.location) > 1e-6:
        raise RuntimeError("rig not at world origin: %s" % list(rig.location))
    if max(abs(v - 1.0) for v in rig.scale) > 1e-6:
        raise RuntimeError("rig scale != 1")
    if not any(m.type == 'ARMATURE' for m in mesh.modifiers):
        raise RuntimeError("Armature modifier missing on %s" % mesh.name)
    for o, bone in props:
        if o.parent is not rig or o.parent_type != 'BONE' or o.parent_bone != bone:
            raise RuntimeError("%s not bone-parented to %s (got %r)"
                               % (o.name, bone, o.parent_bone))

    # 정점당 영향 4개 제한 + 정규화 (glTF 는 상위 4개만 남긴다)
    set_active(mesh)
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    maxinf = 0
    for v in mesh.data.vertices:
        maxinf = max(maxinf, len([g for g in v.groups if g.weight > 1e-5]))
    checks["max_influence_after_limit"] = maxinf
    if maxinf > 4:
        raise RuntimeError("influence limit failed: %d" % maxinf)

    # ------------------------------------------------------- NLA 트랙 구성
    # 순서가 중요하다. NLA 스택 순서가 바뀌면 임포트 직후 프레임 1 의 평가
    # 포즈가 달라진다(실측: bounds_z 가 0.0351 → 0.0611 로 튀었다).
    # spec 의 clips 는 선언 순서를 그대로 쓴다 — 정렬하지 않는다.
    order = list(spec["clips"])
    present = sorted(a.name for a in bpy.data.actions)
    if present != sorted(order):
        raise RuntimeError("action set mismatch\n  file: %s\n  spec: %s"
                           % (present, sorted(order)))
    ad = rig.animation_data or rig.animation_data_create()
    ad.action = None
    for t in list(ad.nla_tracks):
        ad.nla_tracks.remove(t)
    for name in order:
        act = bpy.data.actions[name]
        tr = ad.nla_tracks.new()
        tr.name = name
        st = tr.strips.new(name, int(act.frame_range[0]), act)
        st.name = name
        tr.mute = False
        tr.is_solo = False
    checks["nla_tracks"] = [{"track": t.name,
                             "strips": [(s.name, s.action.name,
                                         round(s.frame_start, 1), round(s.frame_end, 1))
                                        for s in t.strips]}
                            for t in ad.nla_tracks]
    if len(ad.nla_tracks) != len(order):
        raise RuntimeError("NLA track count mismatch")

    # ------------------------------------------------------------- 선택
    # 숨긴 프롭은 선택 자체가 안 된다. 잠깐 보이게 돌려놓고 GLB·FBX 를
    # **둘 다** 내보낸 뒤 되돌린다 — FBX 앞에서 되돌렸다가 FBX 에만
    # 프롭이 빠진 적이 있다.
    hidden = [(o, o.hide_viewport, o.hide_render) for o, _ in props]
    for o, _ in props:
        o.hide_viewport = False
        o.hide_render = False
    bpy.context.view_layer.update()

    bpy.ops.object.select_all(action='DESELECT')
    for o in [rig, mesh] + [p[0] for p in props]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    sel = bpy.context.selected_objects
    checks["selected"] = sorted(o.name for o in sel)
    if any(o.type in ('CAMERA', 'LIGHT') for o in sel):
        raise RuntimeError("camera/light in selection")
    if len(sel) != 2 + len(props):
        raise RuntimeError("selection has %d objects, expected %d"
                           % (len(sel), 2 + len(props)))

    bpy.ops.export_scene.gltf(
        filepath=glb,
        export_format='GLB',
        use_selection=True,
        export_apply=False,           # True 면 Armature 모디파이어까지 적용돼 리깅이 사라진다
        export_animations=True,
        export_animation_mode='NLA_TRACKS',   # ACTIONS 는 타 캐릭터 액션이 섞인다
        export_nla_strips=True,
        export_leaf_bone=False,
        export_influence_nb=4,
        export_all_influences=False,
        export_materials='EXPORT',
        export_yup=True,
        export_rest_position_armature=True,
        export_optimize_animation_size=False,
        export_draco_mesh_compression_enable=False,
    )
    bpy.ops.export_scene.fbx(
        filepath=fbx,
        use_selection=True,
        object_types={'ARMATURE', 'MESH'},
        use_mesh_modifiers=False,     # export_apply=False 와 동일 취지
        add_leaf_bones=False,
        bake_anim=True,
        bake_anim_use_all_bones=True,
        bake_anim_use_nla_strips=True,
        bake_anim_use_all_actions=False,
        bake_anim_force_startend_keying=True,
        bake_anim_step=1.0,
        bake_anim_simplify_factor=0.0,
        axis_forward='-Z',
        axis_up='Y',
        apply_unit_scale=True,
        global_scale=1.0,
        apply_scale_options='FBX_SCALE_NONE',
        use_armature_deform_only=False,
        path_mode='COPY',
        embed_textures=False,
    )

    for o, hv, hr in hidden:
        o.hide_viewport, o.hide_render = hv, hr

    rep = {"code": spec["code"], "checks": checks,
           "files": {"glb": {"path": glb, "bytes": os.path.getsize(glb)},
                     "fbx": {"path": fbx, "bytes": os.path.getsize(fbx)}}}
    if report:
        with open(report, "w") as fh:
            json.dump(rep, fh, indent=1, ensure_ascii=False)
    print("%s EXPORT OK %d %d" % (spec["code"].upper(),
                                  os.path.getsize(glb), os.path.getsize(fbx)))
    return rep
