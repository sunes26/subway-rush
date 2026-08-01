"""SS GLB/FBX 익스포트. 기존 저장소 규약(export_apply=False, NLA 트랙, 리프본 없음,
정점당 영향 4, 리그 위치 0)을 따른다.

blender -b ss_character.blend --python ss_export.py -- <glb_path> <fbx_path>
"""
import bpy, sys, os, json
from mathutils import Matrix

args = sys.argv[sys.argv.index("--") + 1:]
GLB, FBX = os.path.abspath(args[0]), os.path.abspath(args[1])
REPORT = os.environ.get("SS_REPORT", "/tmp/ss_export_report.json")
rep = {}


def need(name):
    o = bpy.data.objects.get(name)
    if o is None:
        raise RuntimeError("missing object: %s" % name)
    return o


rig = need("SS_Rig")
mesh = need("SS_Character")
prop = need("PR_Taser")
baton = need("PR_Baton")
stow = need("PR_TaserStowed")
bstow = need("PR_BatonStowed")
sc = bpy.context.scene

# ---------------------------------------------------------- 익스포트 전 점검
checks = {}
checks["rig_location"] = [round(v, 6) for v in rig.location]
checks["rig_rotation"] = [round(v, 6) for v in rig.rotation_euler]
checks["rig_scale"] = [round(v, 6) for v in rig.scale]
if max(abs(v) for v in rig.location) > 1e-6:
    raise RuntimeError("rig not at world origin: %s" % list(rig.location))
if max(abs(v - 1.0) for v in rig.scale) > 1e-6:
    raise RuntimeError("rig scale != 1")
if not any(m.type == 'ARMATURE' for m in mesh.modifiers):
    raise RuntimeError("Armature modifier missing on SS_Character")
for _o, _bn in ((prop, "Prop.R"), (baton, "Prop.R"), (stow, "Hips"), (bstow, "Hips")):
    if _o.parent_bone != _bn:
        raise RuntimeError("%s not parented to %s" % (_o.name, _bn))

# 정점당 영향 4개 제한 + 정규화 (glTF 는 상위 4개만 남긴다)
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.vertex_group_limit_total(limit=4)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
maxinf = 0
for v in mesh.data.vertices:
    maxinf = max(maxinf, len([g for g in v.groups if g.weight > 1e-5]))
checks["max_influence_after_limit"] = maxinf
if maxinf > 4:
    raise RuntimeError("influence limit failed: %d" % maxinf)

# ------------------------------------------------------------- NLA 트랙 구성
SS_ACTIONS = ["SS_Idle", "SS_Walk", "SS_Radio", "SS_Guide",
              "SS_TaserDraw", "SS_TaserAim", "SS_TaserWarn", "SS_RadioAlert",
              "SS_TaserHolster", "SS_Chase", "SS_TaserFire"]
present = sorted(a.name for a in bpy.data.actions)
if set(present) != set(SS_ACTIONS):
    raise RuntimeError("unexpected actions in file: %s" % present)

ad = rig.animation_data or rig.animation_data_create()
ad.action = None
for t in list(ad.nla_tracks):
    ad.nla_tracks.remove(t)
for name in SS_ACTIONS:
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
if len(ad.nla_tracks) != len(SS_ACTIONS):
    raise RuntimeError("NLA track count mismatch")

# 익스포트 대상만 선택 (카메라 · 라이트 제외)
bpy.ops.object.select_all(action='DESELECT')
# 봉은 씬에서 숨겨 두었다(기본은 테이저). 익스포트에는 반드시 포함돼야 하므로
# 잠깐 보이게 돌려놓고 내보낸 뒤 되돌린다 — 숨긴 채로는 선택 자체가 안 된다.
_hidden = [(o, o.hide_viewport, o.hide_render) for o in (baton, stow, bstow)]
for _o, _a, _b in _hidden:
    _o.hide_viewport = False
    _o.hide_render = False
bpy.context.view_layer.update()
bpy.context.view_layer.update()
for o in (rig, mesh, prop, baton, stow, bstow):
    o.select_set(True)
bpy.context.view_layer.objects.active = rig
checks["selected"] = sorted(o.name for o in bpy.context.selected_objects)
if any(o.type in ('CAMERA', 'LIGHT') for o in bpy.context.selected_objects):
    raise RuntimeError("camera/light in selection")

# ------------------------------------------------------------------- GLB
bpy.ops.export_scene.gltf(
    filepath=GLB,
    export_format='GLB',
    use_selection=True,
    export_apply=False,                 # True 면 Armature 모디파이어까지 적용돼 리깅이 사라진다
    export_animations=True,
    export_animation_mode='NLA_TRACKS',  # README 규약. ACTIONS 는 타 캐릭터 액션이 섞인다
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

# ------------------------------------------------------------------- FBX
bpy.ops.export_scene.fbx(
    filepath=FBX,
    use_selection=True,
    object_types={'ARMATURE', 'MESH'},
    use_mesh_modifiers=False,           # export_apply=False 와 동일 취지
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

# 봉 숨김 복구 — GLB·FBX 를 모두 내보낸 뒤에 되돌려야 한다.
# FBX 앞에서 되돌렸다가 FBX 에만 봉이 빠졌다.
for _o, _a, _b in _hidden:
    _o.hide_viewport, _o.hide_render = _a, _b

rep["checks"] = checks
rep["files"] = {"glb": {"path": GLB, "bytes": os.path.getsize(GLB)},
                "fbx": {"path": FBX, "bytes": os.path.getsize(FBX)}}
with open(REPORT, "w") as fh:
    json.dump(rep, fh, indent=1, ensure_ascii=False)
print("SS EXPORT OK", os.path.getsize(GLB), os.path.getsize(FBX))
