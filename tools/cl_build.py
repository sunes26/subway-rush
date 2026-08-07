"""ACT-12 편의점 점원(CL) 소스 빌드.

mc_character.blend 를 열어 MC 계열만 남기고 CL 로 파생시킨 뒤
assets/cl_character.blend 로 '다른 이름 저장'한다. 원본은 저장하지 않는다.

실행:  blender -b assets/mc_character.blend --python tools/cl_build.py -- <out.blend>

ZP/CP/SS 에서 검증된 파생 경로를 그대로 쓴다 — 베이크 메시 복제로 스킨 웨이트를
상속받고, 본 히트 재바인딩을 하지 않는다.

ACT-12 고유 판단
  * 고정 액터(카운터 뒤)라 이동 애니메이션이 필요 없다. MC 원본 Idle 을
    그대로 이름만 바꿔 쓴다 — SS/CP처럼 하체를 재조립하지 않는다.
  * 조끼는 SS 재킷과 같은 '복제-오프셋' 기법이지만 어깨 각짐·수장 같은
    장식은 뺐다. 소매 없는 통 형태(가슴 아래~골반 위)로 자르고 상하 2색을 준다.
  * 목선은 실제 편의점 조끼 레퍼런스(GS25)를 따라 **V넥**으로 판다 — 수평
    bisect 하나로는 라운드 스쿠프넥이 되어 조끼가 아니라 튜브톱으로 읽힌다.
    중앙에서 낮고 어깨에서 원래 높이로 돌아가는 경사 평면 2장으로 자른다.
  * 색은 사용자 지정 파랑(상단) + 짙은 브라운블랙(하단) 투톤. 첫 시도는
    남색(#122A55)을 썼는데 AgX 톤매핑이 어두운 색을 크게 들어올려 상단과
    거의 안 갈렸다(픽셀 실측). 검정에 가깝게 더 내려야 대비가 산다.
    실제 브랜드 로고는 쓰지 않는다(가상 편의점).
"""
import bpy, sys, os, json, math, bmesh
from mathutils import Euler, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib.blend import need_obj, need_action, need_mat, set_active, new_mat  # noqa: E402
from lib.meshops import bisect, boundary_loops, box, push_out_of_body        # noqa: E402
from lib.rigging import sample_action, act_span, arm_solver, abduct_sign     # noqa: E402
from lib.anim import curve, lower_at, lower_cycle, write_action             # noqa: E402

D = math.radians
OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else None
if not OUT:
    raise RuntimeError("output .blend path required after --")
REPORT = os.environ.get("CL_REPORT", "/tmp/cl_build_report.json")

rep = {}

# ---------------------------------------------------------------- 0. 사전 검증
MC_MESH = need_obj("MC_Character")
MC_RIG = need_obj("MC_Rig")
ACT_IDLE = need_action("Idle")
ACT_WALK = need_action("Walk")
MC_WHITE = need_mat("MC_White")
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

# ------------------------------------- 1. 재사용할 하체 모션을 **삭제 전에** 샘플링
# 점원은 판매·대화·걷기만 한다(디렉터 지정). 정지 하체는 Idle, 걷기는 Walk 에서
# 리샘플한다 — MC 원본과 같은 값이라 발 미끄러짐이 기준선으로 고정되고,
# 커지면 회귀 검사에 걸린다. 액션을 지운 뒤에는 샘플링할 수 없으니 순서가 중요하다.
LOWER = ["Root", "Hips", "UpperLeg.L", "LowerLeg.L", "Foot.L",
         "UpperLeg.R", "LowerLeg.R", "Foot.R"]
IDLE_F, WALK_F = act_span(ACT_IDLE), act_span(ACT_WALK)
IDLE_LOWER = sample_action(MC_RIG, ACT_IDLE, IDLE_F[0], IDLE_F[1], LOWER)
WALK_LOWER = sample_action(MC_RIG, ACT_WALK, WALK_F[0], WALK_F[1], LOWER)
BASE_LOWER = {k: dict(v) for k, v in IDLE_LOWER[IDLE_F[0]].items()}
for _nm, _s in (("Idle", IDLE_LOWER), ("Walk", WALK_LOWER)):
    for f, sn in _s.items():
        for bn in ("Root", "Hips"):
            if abs(sn[bn]["loc"][0]) > 1e-4 or abs(sn[bn]["loc"][2]) > 1e-4:
                raise RuntimeError("horizontal root motion in %s f%d %s" % (_nm, f, bn))
IDLE_N = IDLE_F[1] - IDLE_F[0] + 1
WALK_N = WALK_F[1] - WALK_F[0] + 1
rep["lower_body_source"] = {"Idle": list(IDLE_F), "Walk": list(WALK_F), "bones": LOWER}

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
rig.name = "CL_Rig"
rig.data.name = "CL_Rig"
mesh.name = "CL_Character"
mesh.data.name = "CL_Character"
for o in (rig, mesh):
    o.location = (0.0, 0.0, 0.0)
    o.rotation_euler = (0.0, 0.0, 0.0)
    o.scale = (1.0, 1.0, 1.0)
bpy.context.view_layer.update()
for pb in rig.pose.bones:
    pb.rotation_mode = 'XYZ'

# 좌우 규약 실측 — SS 와 동일 검사. 뒤집히면 명찰이 반대쪽에 붙는다.
_shl = rig.data.bones["UpperArm.L"].head_local
_shr = rig.data.bones["UpperArm.R"].head_local
if not (_shl.x > 0.0 > _shr.x):
    raise RuntimeError("side convention broken: L.x=%.4f R.x=%.4f" % (_shl.x, _shr.x))
SOLE_Z = 0.0351          # MC 발바닥 높이

# --------------------------------------------------------------- 4. 머티리얼
VEST_MAIN_HEX = "#2F6FE0"   # 조끼 상단 — 밝은 파랑 (사용자 지정색)
VEST_DARK_HEX = "#4A3020"   # 조끼 하단 — 따뜻한 다크브라운.
                             # 남색(#122A55)은 AgX 가 들어올려 상단과 안 갈렸고(2차),
                             # 검정 근접(#15100D)은 게임 스케일 축소 렌더에서 옷이 아니라
                             # **그림자/구멍**으로 읽혔다(3차). 무채색 저명도가 아니라
                             # 색이 분명한 갈색이라야 작은 크기에서도 '천'으로 읽힌다.
ZIP_HEX = "#3A3F45"         # 지퍼 테이프 — 중명도 그레이. 파랑 위에서도
                             # 브라운블랙 위에서도 둘 다에서 보여야 하므로
                             # 어느 쪽과도 안 붙는 중간 명도를 쓴다.
TAG_HEX = "#F2EAD8"         # 명찰 — 크림색
vest_main_mat = new_mat("CL_VestMain", VEST_MAIN_HEX, 0.55)
vest_dark_mat = new_mat("CL_VestDark", VEST_DARK_HEX, 0.55)
zip_mat = new_mat("CL_Zip", ZIP_HEX, 0.42, metallic=0.5)
tag_mat = new_mat("CL_Tag", TAG_HEX, 0.35)

# ------------------------------------------------------- 5. 몸통 실측
gi = {g.name: g.index for g in mesh.vertex_groups}
for n in ("Head", "Chest", "Spine", "Hips", "Shoulder.L", "Shoulder.R",
          "UpperArm.L", "UpperArm.R", "LowerArm.L", "LowerArm.R",
          "UpperLeg.L", "UpperLeg.R", "LowerLeg.L", "LowerLeg.R",
          "Foot.L", "Foot.R"):
    if n not in gi:
        raise RuntimeError("vertex group missing: %s" % n)


def _region(name):
    """weight 총합이 blob 스킨에서 0.9를 못 넘는다(실측 최댓값 0.71) — 이
    캐릭터군은 Skin 스켈레톤이라 인접 본으로 웨이트가 넓게 번진다. 절대
    가중치 문턱 대신 '해당 본이 최댓값인' 정점으로 영역을 정의한다."""
    idx = gi[name]
    pts = []
    for v in mesh.data.vertices:
        if not v.groups:
            continue
        dom = max(v.groups, key=lambda g: g.weight)
        if dom.group == idx:
            pts.append(mesh.matrix_world @ v.co)
    if len(pts) < 20:
        raise RuntimeError("region too small for %s: %d" % (name, len(pts)))
    return pts


hip_pts = _region("Hips")
chest_pts = _region("Chest")
HIP_TOP = max(p.z for p in hip_pts)
HIP_BOTTOM = min(p.z for p in hip_pts)
CHEST_TOP = max(p.z for p in chest_pts)
CHEST_BOTTOM = min(p.z for p in chest_pts)
SHOULDER_Z = max(_shl.z, _shr.z)
if not (HIP_BOTTOM < HIP_TOP < CHEST_BOTTOM < CHEST_TOP):
    raise RuntimeError("unexpected torso layering: hip[%.4f,%.4f] chest[%.4f,%.4f] shoulder %.4f"
                       % (HIP_BOTTOM, HIP_TOP, CHEST_BOTTOM, CHEST_TOP, SHOULDER_Z))

# 밑단은 골반을 확실히 덮어야 한다. 처음엔 HIP_TOP 근처(0.492)에서 끊었는데
# 몸통 중간에서 끝나 조끼가 아니라 크롭탑/복대로 읽혔다(사용자 확인 렌더).
# 레퍼런스(GS25)의 조끼는 골반 아래까지 내려온다 — 골반 밴드의 55% 지점까지 내린다.
HEM_Z = HIP_BOTTOM + (HIP_TOP - HIP_BOTTOM) * 0.28
# Chest 지배 영역이 이미 목 근처까지 올라온다(실측) — 그 최상단 바로 아래를
# 목선으로 삼는다. 어깨 관절 head 위치(SHOULDER_Z)는 참고값일 뿐 상한이 아니다.
# CHEST_TOP 기준으로 **아래로** 잡았던 게 오진이었다. 셸 실측(z 최대 0.7482,
# p95 0.7371)을 보면 목선 컷보다 위에 어깨 지오메트리가 4cm 남아 있었고,
# 그래서 축소 렌더에서 어깨가 맨살로 드러나 조끼가 아니라 '가슴에 두른 천'으로
# 읽혔다. 조끼는 어깨를 덮는 옷이다 — CHEST_TOP 위로 올린다.
COLLAR_Z = CHEST_TOP + (CHEST_TOP - CHEST_BOTTOM) * 0.22
if not HEM_Z < COLLAR_Z:
    raise RuntimeError("vest z-band degenerate: hem %.4f collar %.4f" % (HEM_Z, COLLAR_Z))
rep["measure"] = {"hip": [round(HIP_BOTTOM, 4), round(HIP_TOP, 4)],
                  "chest": [round(CHEST_BOTTOM, 4), round(CHEST_TOP, 4)],
                  "shoulder_z": round(SHOULDER_Z, 4),
                  "hem_z": round(HEM_Z, 4), "collar_z": round(COLLAR_Z, 4)}

# ============================================================ 6. 조끼 셸
# 이미 웨이트가 실린 본체를 부분 복제해 법선 방향으로 부풀린다 — 재바인딩 불필요.
VEST_OFFSET = 0.0075

set_active(mesh)
bpy.ops.object.duplicate()
gar = bpy.context.active_object
gar.name = "CL_VestShell"
gar.data.name = "CL_VestShell"
for m in list(gar.modifiers):
    gar.modifiers.remove(m)
gar.parent = None
# 슬롯은 여기서 미리 만든다. `materials.clear()`는 껍데기 리스트만 비우는 게
# 아니라 그 순간 슬롯 수가 0이 되면서 기존 face.material_index 를 전부
# 0으로 clamp 해 버린다(실측) — 투톤 루프 뒤에 clear+append 를 했더니
# 애써 나눈 상/하단 인덱스가 통째로 사라졌다. 지오메트리 편집 전에 슬롯을
# 확정해 두면 이후 bm.to_mesh 가 쓰는 인덱스가 그대로 살아남는다.
gar.data.materials.clear()
gar.data.materials.append(vest_main_mat)   # 슬롯 0 — 상단 파랑
gar.data.materials.append(vest_dark_mat)   # 슬롯 1 — 하단 브라운블랙
gar.data.materials.append(zip_mat)         # 슬롯 2 — 앞 중앙 지퍼

_gi = {g.name: g.index for g in gar.vertex_groups}
# Shoulder 를 제외하면 어깨-목 모서리에서 Chest 지배 영역과 안 만나 맨살
# 삼각형이 뚫고 나온다(1차 렌더에서 실측 확인). COLLAR_Z bisect 가 높이를
# 어차피 제한하므로 Shoulder 는 배제하지 않고 남겨서 이음매를 막는다.
_EXCLUDE = {_gi["Head"],
            _gi["UpperArm.L"], _gi["UpperArm.R"], _gi["LowerArm.L"], _gi["LowerArm.R"],
            _gi["UpperLeg.L"], _gi["UpperLeg.R"], _gi["LowerLeg.L"], _gi["LowerLeg.R"],
            _gi["Foot.L"], _gi["Foot.R"]}
_KEEP_DOM = {_gi["Chest"], _gi["Spine"], _gi["Hips"], _gi["Shoulder.L"], _gi["Shoulder.R"]}


_THIGH = {_gi["UpperLeg.L"], _gi["UpperLeg.R"]}


def _keep(v):
    ws = {g.group: g.weight for g in v.groups if g.weight > 1e-4}
    if not ws:
        return False
    dom = max(ws, key=ws.get)
    if v.co.z < HEM_Z - 0.05 or v.co.z > COLLAR_Z + 0.05:
        return False
    if dom in _KEEP_DOM:
        return True
    # 골반 **바깥쪽**은 Hips 가 아니라 허벅지 본이 지배한다. 이걸 통째로 빼면
    # 밑단이 가운데로 좁아져 뒤에서 '꼬리'처럼 매달려 보인다(사용자 확인 렌더).
    # 밑단 높이 위쪽에 한해 허벅지 지배 정점도 남겨 밑단 폭을 유지한다 —
    # 어차피 HEM_Z 에서 bisect 로 잘리므로 다리를 타고 내려가지 않는다.
    # 문턱을 HEM_Z 로 딱 맞추면 안 된다 — 정점이 그 높이에 고르게 있지 않아
    # 경계가 정점 단위로 들쭉날쭉해지고, bisect 가 이미 위에 있는 정점을
    # 다듬을 수가 없어 톱니가 그대로 남는다(실측: 62정점 중 26개만 평면).
    # 컷 아래로 여유를 둬서 bisect 가 깨끗한 평면 링을 만들게 한다.
    # 여유를 너무 키우면 가랑이 아래로 내려가 링이 다리마다 하나씩 둘로 갈린다.
    if dom in _THIGH and v.co.z >= HEM_Z - 0.02:
        return True
    return False


_kill = [v.index for v in gar.data.vertices if not _keep(v)]
if len(_kill) >= len(gar.data.vertices) - 200:
    raise RuntimeError("vest cut removed almost everything: %d/%d"
                       % (len(_kill), len(gar.data.vertices)))
bm = bmesh.new()
bm.from_mesh(gar.data)
bm.verts.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.verts[i] for i in _kill], context='VERTS')
bm.verts.ensure_lookup_table()

# 순서 주의: 부풀린 '뒤에' 자른다. 자른 뒤 법선으로 밀면 밑단이 다시 울퉁불퉁해진다.
bm.normal_update()
for v in bm.verts:
    v.co += v.normal * VEST_OFFSET

# 어깨를 얼마나 덮을 수 있는지는 '남아 있는 지오메트리'가 정한다 —
# CHEST_TOP 에서 역산한 값이 실제 셸 높이를 넘으면 목선 컷이 헛돌기 때문에
# 올릴 수 있는 상한을 기록해 둔다.
_szs = sorted(v.co.z for v in bm.verts)
rep["shell_z_before_bisect"] = {"min": round(_szs[0], 4), "max": round(_szs[-1], 4),
                                "p95": round(_szs[int(len(_szs) * 0.95)], 4),
                                "collar_target": round(COLLAR_Z, 4)}

bisect(bm, Vector((0.0, 0.0, HEM_Z)), Vector((0.0, 0.0, 1.0)))
bisect(bm, Vector((0.0, 0.0, COLLAR_Z)), Vector((0.0, 0.0, -1.0)))
bm.verts.ensure_lookup_table()
if len(bm.verts) < 200:
    raise RuntimeError("vest shell collapsed after bisect: %d verts" % len(bm.verts))

# 밑단·목선을 수평 링으로 정렬 — 톱니 방지 (SS 밑단 정렬과 동일 기법)
_hem_loop, _collar_loop = None, None
_loops = boundary_loops(bm)
rep["boundary_loops"] = [
    {"n": len(c), "z": [round(min(v.co.z for v in c), 4), round(max(v.co.z for v in c), 4)],
     "x": [round(min(v.co.x for v in c), 4), round(max(v.co.x for v in c), 4)]}
    for c in _loops]
for comp in _loops:
    if len(comp) < 16:
        continue
    zmean = sum(v.co.z for v in comp) / len(comp)
    if abs(zmean - HEM_Z) < 0.05 and (_hem_loop is None or len(comp) > len(_hem_loop)):
        _hem_loop = comp
    if abs(zmean - COLLAR_Z) < 0.05 and (_collar_loop is None or len(comp) > len(_collar_loop)):
        _collar_loop = comp
if _hem_loop is None or _collar_loop is None:
    raise RuntimeError("hem/collar boundary loop not found (hem=%s collar=%s)"
                       % (_hem_loop is not None, _collar_loop is not None))


def _smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


# 경계 성분은 **평면 링이 아니다.** 실측: 위쪽 성분 128정점이 z 0.6335~0.7027
# 에 걸쳐 있다 — bisect 로 생긴 목선 링과, 팔을 제외해서 생긴 **겨드랑이 구멍**이
# 한 덩어리로 이어져 있기 때문이다(아래쪽도 마찬가지로 밑단 링 + 가랑이 구멍).
# 성분 전체를 COLLAR_Z 로 평탄화하면 겨드랑이 정점이 최대 70mm 끌려 올라가고,
# 그게 렌더에서 본 '찢어진 목선'의 정체였다. push_out_of_body 를 의심했지만
# 실측 결과 셸은 전부 몸 바깥(최소 +3.96mm)이었다 — 관통이 아니라 이 평탄화였다.
# 링은 **bisect 평면에 실제로 놓인 정점만** 골라야 한다.
def _planar_ring(loop, z, what, tol=0.004):
    ring = [v for v in loop if abs(v.co.z - z) < tol]
    if len(ring) < 16:
        raise RuntimeError("%s planar ring too small: %d of %d component verts"
                           % (what, len(ring), len(loop)))
    return ring


_hem_ring = _planar_ring(_hem_loop, HEM_Z, "hem")
_collar_ring = _planar_ring(_collar_loop, COLLAR_Z, "collar")

# 목선 스쿠프 — 앞 중앙에서 가장 깊고 어깨(겨드랑이 접합부)에서 0 으로 사라진다.
# x 테이퍼가 있어야 겨드랑이 이음매에 단차가 안 생긴다.
NECK_FRONT_DIP = (COLLAR_Z - HEM_Z) * 0.09
_ring_x = max(abs(v.co.x) for v in _collar_ring) or 1.0
_ring_y = max(abs(v.co.y) for v in _collar_ring) or 1.0


# ---- 겨드랑이 경계 평활 ----
# 겨드랑이 구멍은 bisect 로 낸 게 아니라 **UpperArm 지배 정점을 지워서** 생긴다.
# 그 판정은 이진이라 정점 사이 보간이 없고, 결과적으로 사각 계단 노치가 크게
# 파여 '유니폼이 뜯긴' 것처럼 보인다(사용자 지적). 평면 컷을 쓸 수 없는 곡선
# 경계이므로, 경계 루프를 **사이클 순서로 정렬해 라플라시안 평활**한다.
_armholes = [c for c in _loops
             if len(c) >= 16 and c is not _hem_loop and c is not _collar_loop]
if len(_armholes) != 2:
    raise RuntimeError("expected 2 armhole loops, found %d (sizes %s)"
                       % (len(_armholes), [len(c) for c in _armholes]))


def _order_loop(comp):
    """경계 성분을 사이클 순서로 정렬한다.

    set 순서로 이웃을 고르면 안 된다 — 순서가 없어 평활이 엉뚱한 정점끼리
    평균을 내고 경계가 꼬인다(CP 넥필로우 캡에서 같은 함정을 밟았다).
    """
    adj = {}
    for v in comp:
        for e in v.link_edges:
            if len(e.link_faces) == 1:
                o = e.other_vert(v)
                if o in comp:
                    adj.setdefault(v, []).append(o)
    start = next(iter(comp))
    order, prev, cur = [start], None, start
    while True:
        nbrs = [n for n in adj.get(cur, []) if n is not prev]
        if not nbrs:
            break
        nxt = nbrs[0]
        if nxt is start:
            break
        order.append(nxt)
        prev, cur = cur, nxt
        if len(order) > len(comp):
            raise RuntimeError("armhole loop walk did not close")
    if len(order) != len(comp):
        raise RuntimeError("armhole loop walk covered %d of %d" % (len(order), len(comp)))
    return order


_arm_orders = [_order_loop(c) for c in _armholes]
ARM_SMOOTH_ITERS, ARM_SMOOTH_LAMBDA = 8, 0.55


def _smooth_armholes():
    for order in _arm_orders:
        n = len(order)
        for _ in range(ARM_SMOOTH_ITERS):
            new = [(order[(i - 1) % n].co + order[(i + 1) % n].co) * 0.5 * ARM_SMOOTH_LAMBDA
                   + v.co * (1.0 - ARM_SMOOTH_LAMBDA)
                   for i, v in enumerate(order)]
            for v, p in zip(order, new):
                v.co = p


def _apply_rings():
    """링 프로파일을 좌표에 확정한다.

    push_out_of_body **뒤에 한 번 더** 부른다 — 그 연산은 몸 법선을 따라
    정점을 제각각 밀어내므로, 법선이 급변하는 어깨 부근에서 애써 정렬한
    경계가 다시 들쭉날쭉해진다. 겨드랑이 평활도 같은 이유로 함께 다시 돈다.
    """
    for v in _hem_ring:
        v.co.z = HEM_Z
    for v in _collar_ring:
        fy = max(0.0, min(1.0, -v.co.y / _ring_y))     # 앞(-y)에서만 1
        fx = 1.0 - _smoothstep(abs(v.co.x) / _ring_x)  # 어깨에서 0 으로 사라진다
        v.co.z = COLLAR_Z - NECK_FRONT_DIP * fy * fx
    _smooth_armholes()


rep["armholes"] = [len(c) for c in _armholes]
_apply_rings()
rep["hem_loop_verts"] = len(_hem_loop)
rep["collar_loop_verts"] = len(_collar_loop)
rep["rings"] = {"hem": len(_hem_ring), "collar": len(_collar_ring)}
rep["neckline"] = {"front_dip_m": round(NECK_FRONT_DIP, 4)}
bm.normal_update()

# 셸이 본체 안으로 파고든 곳을 전부 바깥으로 밀어낸다
bm.to_mesh(gar.data)
gar.data.update()
# 경계 정렬/평활과 밀어내기는 서로를 되돌린다. 한 번씩만 하면 **마지막에 한
# 연산의 부작용이 그대로 남는다** — 평활로 끝내면 정점 12개가 몸 안으로 들어가고
# (실측), 밀어내기로 끝내면 경계가 다시 톱니가 된다. 번갈아 돌려 수렴시키고
# **밀어내기로 끝낸다**: 마지막 밀어내기는 안으로 들어간 소수만 건드리므로
# 평활 결과를 거의 흐트러뜨리지 않는다.
_pushed, _worst = 0, 0.0
for _ in range(3):
    _apply_rings()
    _p, _w = push_out_of_body(bm, mesh, clear=0.004)
    _pushed, _worst = _p, max(_worst, _w)
bm.normal_update()
bm.to_mesh(gar.data)
gar.data.update()
rep["vest_pushed_out"] = {"verts": _pushed, "max_push_m": round(_worst, 5)}

_loose = [v for v in bm.verts if not v.link_edges]
if _loose:
    bmesh.ops.delete(bm, geom=_loose, context='VERTS')

# ---- 투톤 셰브론 + 지퍼 ----
# 레퍼런스(GS25)의 색 경계는 수평선이 아니라 **가운데가 아래로 뾰족한 셰브론**이다.
# 수평으로 자르면 파랑이 그냥 '가슴에 두른 띠'가 되고, 셰브론이라야 조끼 재단으로
# 읽힌다. 사진 실측: 파랑이 중앙에서 전체 높이의 약 54%, 어깨 쪽에서 약 40%.
bm.faces.ensure_lookup_table()
_span = COLLAR_Z - HEM_Z
CHEV_CENTER_Z = HEM_Z + _span * 0.42     # 중앙 — 가장 낮게 내려온 꼭짓점
CHEV_SIDE_Z = HEM_Z + _span * 0.60       # 옆구리 — 다시 올라간다
CHEV_HALF_X = max(abs(_shl.x), abs(_shr.x)) * 0.92
if not CHEV_HALF_X > 0.0:
    raise RuntimeError("chevron half-width degenerate: %.4f" % CHEV_HALF_X)
# 지퍼는 조끼를 조끼로 만드는 단일 최대 요소다 — 색 블록만으로는 상의 무늬와
# 구분이 안 된다. 앞 중앙(-y)에 목선부터 밑단까지 세로로 끊김 없이 넣는다.
_vest_max_x = max(abs(v.co.x) for v in bm.verts)
ZIP_HALF_X = _vest_max_x * 0.10


def _chevron_z(x):
    """셰브론은 **직선 두 개**다 — smoothstep 곡선이 아니다.

    곡선으로 두면 아래 bisect 평면과 경계가 어긋나 색이 에지를 넘나든다.
    직선이라야 평면 2장으로 정확히 같은 선을 자를 수 있다.
    """
    return CHEV_CENTER_Z + (CHEV_SIDE_Z - CHEV_CENTER_Z) * min(1.0, abs(x) / CHEV_HALF_X)


def _cut_plane(co, no, verts_filter=None):
    """지오메트리를 **버리지 않고** 평면으로 자르기만 한다.

    meshops.bisect 는 clear_inner=True 라 한쪽을 삭제한다. 색 경계용 컷은
    삭제하면 안 되고 에지만 생겨야 한다.

    이게 필요한 이유 — 색을 face.material_index 로만 칠하면 경계가 면
    크기로 양자화돼 계단처럼 깨진다(사용자 확인 렌더). 블롭 몸통 메시는
    이 장식들에 비해 면이 크다. **경계를 실제 에지로 만들어야** 깔끔하다.
    """
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    if verts_filter is not None:
        vs = {v for v in bm.verts if verts_filter(v)}
        geom = list(vs) + [e for e in bm.edges if all(v in vs for v in e.verts)] \
            + [f for f in bm.faces if all(v in vs for v in f.verts)]
        if not geom:
            raise RuntimeError("cut_plane: empty geometry subset")
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=co, plane_no=no,
                           clear_inner=False, clear_outer=False)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bm.edges.ensure_lookup_table()


# 컷 순서가 중요하다. 셰브론 좌/우 평면은 x 부호로 면을 걸러서 자르는데,
# x=0 을 가로지르는 면은 어느 쪽 부분집합에도 안 들어가 안 잘린다.
# 그래서 **중앙선을 먼저 잘라** 모든 면을 한쪽으로 몰아 둔다.
_cut_plane(Vector((0.0, 0.0, 0.0)), Vector((1.0, 0.0, 0.0)))
# 지퍼 양 옆선. 앞면(-y)에만 필요하지만 컷은 전체에 내도 색 배정이 y<0 을
# 보므로 뒤쪽에는 영향이 없다.
for _zx in (ZIP_HALF_X, -ZIP_HALF_X):
    _cut_plane(Vector((_zx, 0.0, 0.0)), Vector((1.0, 0.0, 0.0)))
# 셰브론 경계선 — 좌우 각각 직선 1개 = 평면 1장.
for _sx in (1.0, -1.0):
    _dz = CHEV_SIDE_Z - CHEV_CENTER_Z
    _n = Vector((-_dz * _sx, 0.0, CHEV_HALF_X)).normalized()
    _cut_plane(Vector((0.0, 0.0, CHEV_CENTER_Z)), _n,
               verts_filter=lambda v, s=_sx: v.co.x * s >= -1e-6)
bm.normal_update()

_upper, _lower, _zip = 0, 0, 0
for f in bm.faces:
    c = f.calc_center_median()
    if abs(c.x) <= ZIP_HALF_X and c.y < 0.0:
        f.material_index = 2
        _zip += 1
    elif c.z >= _chevron_z(c.x):
        f.material_index = 0
        _upper += 1
    else:
        f.material_index = 1
        _lower += 1
if _upper < 10 or _lower < 10:
    raise RuntimeError("vest two-tone split degenerate: upper=%d lower=%d" % (_upper, _lower))
# 지퍼가 몇 조각으로 끊기면 '단추 몇 개'로 보인다. 면 수로 연속성을 강제한다.
if _zip < 8:
    raise RuntimeError("zipper strip too sparse: %d faces (raise ZIP_HALF_X)" % _zip)
rep["vest_tone_faces"] = {"upper": _upper, "lower": _lower, "zip": _zip}
rep["chevron"] = {"center_z": round(CHEV_CENTER_Z, 4), "side_z": round(CHEV_SIDE_Z, 4),
                  "half_x": round(CHEV_HALF_X, 4)}
rep["zipper"] = {"half_x": round(ZIP_HALF_X, 4), "faces": _zip}

bm.to_mesh(gar.data)
bm.free()
gar.data.update()
if len(gar.data.vertices) < 200:
    raise RuntimeError("vest shell too small: %d verts" % len(gar.data.vertices))
set_active(gar)
bpy.ops.object.shade_smooth()
rep["vest"] = {"verts": len(gar.data.vertices),
              "tris": sum(len(p.vertices) - 2 for p in gar.data.polygons),
              "offset_m": VEST_OFFSET, "colors": [VEST_MAIN_HEX, VEST_DARK_HEX]}

# ---- 밑단 웨이트를 다리에서 골반으로 옮긴다 ----
# 밑단 폭을 살리려고 허벅지 지배 정점을 셸에 포함시켰는데, 그 정점들은 웨이트도
# 허벅지에서 상속받는다(실측: 247정점이 UpperLeg 지배, 밑단 모서리는 다리
# 가중치 0.97). 그대로 두면 **다리를 흔들 때 조끼 밑단이 허벅지를 따라간다** —
# 조끼는 몸통에 걸린 옷이므로 골반을 따라야 한다. CL_Idle 은 다리를 거의 안
# 움직여 눈에 안 띄지만, 걷기·추격 클립이 붙는 순간 드러나는 잠복 결함이다.
_LEG_NAMES = ("UpperLeg.L", "UpperLeg.R", "LowerLeg.L", "LowerLeg.R", "Foot.L", "Foot.R")
_leg_idx = {gar.vertex_groups[n].index for n in _LEG_NAMES if n in gar.vertex_groups}
_hips_vg = gar.vertex_groups.get("Hips")
if _hips_vg is None:
    raise RuntimeError("vest shell has no Hips vertex group to re-anchor the hem")
_reassign = []
for v in gar.data.vertices:
    _w = sum(g.weight for g in v.groups if g.group in _leg_idx)
    if _w > 1e-6:
        _hw = next((g.weight for g in v.groups if g.group == _hips_vg.index), 0.0)
        _reassign.append((v.index, _hw + _w))
if _reassign:
    _ids = [i for i, _ in _reassign]
    for _n in _LEG_NAMES:
        _vg = gar.vertex_groups.get(_n)
        if _vg:
            _vg.remove(_ids)
    for _i, _w in _reassign:
        _hips_vg.add([_i], _w, 'REPLACE')
rep["hem_reanchored"] = {"verts": len(_reassign)}
_still = sum(1 for v in gar.data.vertices
             if any(g.group in _leg_idx and g.weight > 1e-6 for g in v.groups))
if _still:
    raise RuntimeError("vest still carries leg weight on %d verts" % _still)

# ------------------------------------------------------------- 7. 명찰
# 캐릭터 오른쪽 가슴, 조끼 표면 바로 위. -Y 가 앞(SS 규약과 동일).
_chest_front_y = min(p.y for p in chest_pts)
# 1차 명찰(24×14mm)은 화면에서 흰 얼룩 한 점이었다. 실제 명찰은 가슴에서
# 확실히 읽히는 크기다 — 키우고, 파랑 요크 위(셰브론 위쪽)에 올려 대비를 준다.
TAG_W, TAG_D, TAG_H = 0.034, 0.004, 0.018
TAG_X = _shr.x * 0.62                       # R 쪽(-x), 지퍼를 피해 바깥으로
TAG_Z = (CHEV_SIDE_Z + COLLAR_Z) * 0.5      # 셰브론 위 = 파랑 구간 한가운데
TAG_Y = _chest_front_y - VEST_OFFSET - TAG_D / 2.0 - 0.001
if abs(TAG_X) <= ZIP_HALF_X + TAG_W * 0.5:
    raise RuntimeError("name tag overlaps the zipper: x=%.4f zip_half=%.4f"
                       % (TAG_X, ZIP_HALF_X))
tag = box("CL_NameTag", (TAG_X, TAG_Y, TAG_Z), (TAG_W, TAG_D, TAG_H), tag_mat, bevel=0.0012)
# 명찰은 순수 프리미티브라 버텍스 그룹이 없다 — 조인 뒤 '미배정 정점'으로 잡힌다.
# 가슴에 고정되므로 Chest 본에 강체로 바인딩한다(CP 넥필로우가 Head에 한 것과 동일).
_tvg = tag.vertex_groups.new(name="Chest")
_tvg.add(range(len(tag.data.vertices)), 1.0, 'REPLACE')
rep["nametag"] = {"loc": [round(TAG_X, 4), round(TAG_Y, 4), round(TAG_Z, 4)],
                  "dims": [TAG_W, TAG_D, TAG_H]}

# ------------------------------------------------------------- 8. 합치기
set_active(mesh)
gar.select_set(True)
tag.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.join()
mesh = need_obj("CL_Character")
_mat_names = {m.name for m in mesh.data.materials}
for _need in ("MC_White", "CL_VestMain", "CL_VestDark", "CL_Zip", "CL_Tag"):
    if _need not in _mat_names:
        raise RuntimeError("material lost during join: %s (have %s)" % (_need, _mat_names))

# Shoulder 를 포함시켜 이음매를 막았더니 그 경계 정점 일부가 5본 이상의
# 웨이트를 갖는다(glTF 한도 4 초과, blob Skin 스켈레톤 특유). 가장 작은
# 웨이트부터 잘라 4개로 정규화한다.
set_active(mesh)
bpy.ops.object.vertex_group_limit_total(limit=4)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)

# 합친 뒤 고립 정점 정리 (기존 캐릭터들에서도 공통으로 나오던 문제)
bm = bmesh.new()
bm.from_mesh(mesh.data)
lo = [v for v in bm.verts if not v.link_edges]
rep["loose_verts_removed"] = len(lo)
if lo:
    bmesh.ops.delete(bm, geom=lo, context='VERTS')
bm.to_mesh(mesh.data)
bm.free()
mesh.data.update()

# --- 최종 검증: 명찰이 조끼 표면에 파묻히지 않았는지 ---
dg = bpy.context.evaluated_depsgraph_get()
dg.update()
_me = mesh.evaluated_get(dg)
_tag_slot = [i for i, m in enumerate(mesh.data.materials) if m and m.name == "CL_Tag"][0]
_tag_verts = sorted({vi for p in mesh.data.polygons if p.material_index == _tag_slot
                     for vi in p.vertices})
if len(_tag_verts) < 8:
    raise RuntimeError("nametag lost geometry after join: %d verts" % len(_tag_verts))
_body_tris = []
for p in mesh.data.polygons:
    if p.material_index == _tag_slot:
        continue
    vs = list(p.vertices)
    for k in range(1, len(vs) - 1):
        _body_tris.append((vs[0], vs[k], vs[k + 1]))
_bw = [mesh.matrix_world @ v.co for v in _me.data.vertices]
_bvh = BVHTree.FromPolygons([tuple(v) for v in _bw], _body_tris, all_triangles=True)
_min_clear = min(_bvh.find_nearest(_bw[vi])[3] for vi in _tag_verts)
rep["nametag_clearance_m"] = round(_min_clear, 5)
if _min_clear < 0.0008:
    raise RuntimeError("nametag buried in vest surface: %.5f m" % _min_clear)

# ============================================================== 9. 애니메이션
# 점원이 하는 일은 셋뿐이다(디렉터 지정) — **판매 · 대화 · 걷기**.
# 팔 각도는 손으로 넣지 않고 **솔버로 손의 목표 위치**를 준다. 본 로컬 축은
# 본 방향에 따라 뒤집혀서 부호를 눈대중하면 반대로 벌어진다(SS/CP 규약).
dg = bpy.context.evaluated_depsgraph_get()
solve_arm = arm_solver(rig, dg)
tip = solve_arm.tip


def apply_pose(vals):
    for bn, rot in vals.items():
        pb = rig.pose.bones.get(bn)
        if pb is None:
            raise RuntimeError("pose bone missing: %s" % bn)
        pb.rotation_euler = Euler([D(x) for x in rot], 'XYZ')
    dg.update()


# 곧게 선 접객 자세. GP(굽은 등)·ZP(웅크림)·CP(무심)와 갈리는 지점이다.
UPPER_BASE = {"Hips": (0, 0, 0), "Spine": (-1, 0, 0), "Chest": (-1.5, 0, 0),
              "Head": (0, 0, 0), "Shoulder.L": (0, 0, 0), "Shoulder.R": (0, 0, 0)}
for bn, sn in BASE_LOWER.items():
    pb = rig.pose.bones[bn]
    pb.location = sn["loc"]
    pb.rotation_euler = Euler(sn["rot"], 'XYZ')
apply_pose({k: v for k, v in UPPER_BASE.items() if k != "Hips"})

sh_r = rig.matrix_world @ rig.pose.bones["UpperArm.R"].head
sh_l = rig.matrix_world @ rig.pose.bones["UpperArm.L"].head
# 조끼 셸이 팔·몸통에 7.5mm 씩 붙어 15mm 를 잡아먹는다. MC 정지 자세(±0.079)
# 그대로 두면 팔↔몸통 3.4mm 기준선이 곧바로 깨지므로 조금 벌려서 푼다.
HAND_L = sh_l + Vector((0.088, 0.012, -0.266))
ELB_L = sh_l + Vector((0.074, 0.004, -0.127))
HAND_R = sh_r + Vector((-0.088, 0.012, -0.266))
ELB_R = sh_r + Vector((-0.074, 0.004, -0.127))
_pr_r, _er, _ = solve_arm("R", HAND_R, ELB_R, elbow_w=0.06)
_pr_l, _el, _ = solve_arm("L", HAND_L, ELB_L, elbow_w=0.06)
for _side, _pr in (("R", _pr_r), ("L", _pr_l)):
    UPPER_BASE["UpperArm." + _side] = tuple(round(x, 2) for x in _pr[:3])
    UPPER_BASE["LowerArm." + _side] = tuple(round(x, 2) for x in _pr[3:])
apply_pose({k: v for k, v in UPPER_BASE.items() if k != "Hips"})
for _s, _e in (("R", _er), ("L", _el)):
    if _e > 0.020:
        raise RuntimeError("arm.%s base solve residual too large: %.4f" % (_s, _e))

UPPER_BONES = ["Spine", "Chest", "Head", "Shoulder.L", "UpperArm.L", "LowerArm.L",
               "Shoulder.R", "UpperArm.R", "LowerArm.R"]
KEYED = LOWER + UPPER_BONES
P = {"base_R": list(UPPER_BASE["UpperArm.R"]) + list(UPPER_BASE["LowerArm.R"]),
     "base_L": list(UPPER_BASE["UpperArm.L"]) + list(UPPER_BASE["LowerArm.L"])}


def base_upper(bn):
    return list(UPPER_BASE.get(bn, (0, 0, 0)))


def neutral_upper():
    apply_pose({k: v for k, v in UPPER_BASE.items() if k != "Hips"})


UPPER_LEN = rig.data.bones["UpperArm.R"].length
LOWER_LEN = rig.data.bones["LowerArm.R"].length
ARM_REACH = UPPER_LEN + LOWER_LEN
rep["arm_reach"] = {"upper": round(UPPER_LEN, 4), "lower": round(LOWER_LEN, 4),
                    "reach": round(ARM_REACH, 4),
                    "base_frac": round((tip("LowerArm.R") - sh_r).length / ARM_REACH, 3)}


neutral_upper()
# 팔을 몸에서 멀어지게 하는 회전 부호는 **실측**한다 — 본 방향에 따라 뒤집힌다.
ABDUCT_L = abduct_sign(rig, dg, "L", P["base_L"], neutral_upper)
ABDUCT_R = abduct_sign(rig, dg, "R", P["base_R"], neutral_upper)
rep["abduct_deg"] = {"L": ABDUCT_L, "R": ABDUCT_R}
OUT_L, OUT_R = ABDUCT_L / 8.0, ABDUCT_R / 8.0      # 바깥으로 벌리는 부호 (±1)

# ---- 제스처는 IK 가 아니라 **관절 각도**로 준다 ----
# 처음엔 CP·SS 처럼 팔 솔버로 손 목표 좌표를 풀려 했는데 잔차가 32mm 에서
# 안 내려갔다. 원인은 두 가지였다 —
#   (1) 블롭 팔은 도달 0.293 인데 늘어뜨린 자세가 이미 98%(0.288)라
#       눈으로 그럴듯한 좌표가 사실상 도달 밖이다,
#   (2) 좌표하강 솔버가 이 리그의 어깨 배치에서 국소최소에 자주 갇힌다.
# 그런데 **점원은 프롭을 쥐지 않는다.** 손이 특정 좌표에 닿을 이유가 없고
# 필요한 건 실루엣뿐이다. 솔버는 CP 캐리어 손잡이처럼 프롭에 맞출 때 쓰는
# 도구지 제스처용이 아니다 — 각도를 직접 준다.
#
# 축 의미는 실측했다(추측 금지):
#   UpperArm rx−  팔이 앞으로 (좌우 같은 부호)   rx+ 뒤로
#   UpperArm rz   벌리기 — R 은 +, L 은 −  (OUT_* 로 흡수)
#   UpperArm ry   비틀기. 손 위치가 거의 안 변해 제스처에 못 쓴다
#   LowerArm rx+  팔꿈치 굽힘 (0.288 → 0.155 @120°)
def _arm(side, ua_fwd, ua_out, la_flex):
    """la_flex 는 **사람처럼 앞으로 굽는** 양이다(양수 = 정상 굴곡).

    ⚠ 팔꿈치 부호를 거리로 확인하면 안 된다. `LowerArm rx` 는 **어느 부호로도**
    손을 어깨 쪽으로 당겨 거리가 똑같이 줄어든다(0.288 → 0.155). 방향까지 재야
    한다 — 실측: rx **+** 는 손이 뒤(+y)로 가는 **역굴곡**, rx **−** 가 앞(−y)으로
    가는 정상 굴곡이다. 여기서 부호를 틀려 제스처 전부가 팔꿈치가 60~70°
    반대로 꺾인 채 손 위치만 맞은 자세로 나갔다.
    """
    out = OUT_R if side == "R" else OUT_L
    return [-ua_fwd, 0.0, out * ua_out, -la_flex, 0.0, 0.0]


def _hand_at(side, ua_fwd, ua_out, la_flex):
    v = _arm(side, ua_fwd, ua_out, la_flex)
    rig.pose.bones["UpperArm." + side].rotation_euler = Euler(
        [D(v[0]), D(v[1]), D(v[2])], 'XYZ')
    rig.pose.bones["LowerArm." + side].rotation_euler = Euler(
        [D(v[3]), D(v[4]), D(v[5])], 'XYZ')
    dg.update()
    return rig.matrix_world @ rig.pose.bones["LowerArm." + side].tail


def _fit_arm(name, side, target, out_min=12.0, out_max=26.0, flex_max=130.0,
             limit=0.035):
    """**손이 갈 자리를 지정하고 각도를 찾는다.**

    각도를 직접 박고 결과를 눈으로 확인하는 방식으로 세 번 실패했다. 이 리그는
    벌림(rz)이 전방 회전(rx)보다 손을 더 많이 들어올려서, 직관대로 넣으면
    엉뚱한 데로 간다 — 실측 예: '집기' 자세의 손이 어깨보다 22cm 바깥으로
    나가 팔이 옆으로 뻗은 날개가 됐고, '건네기'는 손이 밑단 높이에 머물렀다.

    IK 솔버(lib.rigging.arm_solver)는 이 리그에서 잔차가 32mm 아래로 안 내려가
    못 썼다. 대신 우리가 실제로 쓰는 3개 파라미터만 격자 탐색한다 — 3자유도라
    전역 탐색이 싸고, 국소최소에 갇히지 않는다.

    벌림은 **위아래로 다 묶는다.** out_max 를 풀면 탐색이 '팔을 옆으로 쭉 뻗는'
    해를 골라 날개가 되고, out_min 을 안 주면 반대로 0°짜리 해를 골라 팔이
    몸통에 달라붙어 조끼를 파고든다(실측 0.6mm, MC 기준선 3.4mm).
    flex_max 도 같은 이유다 — 굽힘을 풀어 주면 127° 짜리 해를 골라 전완이
    완전히 접히고, 양손이 가슴에 모여 '합장'으로 읽힌다(실측 렌더).
    """
    best = None
    for fwd in range(0, 125, 10):
        for out in range(int(out_min), int(out_max) + 1, 5):
            for flex in range(0, int(flex_max) + 1, 10):
                d = (_hand_at(side, fwd, out, flex) - target).length
                if best is None or d < best[0]:
                    best = (d, fwd, out, flex)
    _d, f0, o0, x0 = best
    for fwd in [f0 + i for i in range(-9, 10, 2) if 0 <= f0 + i <= 125]:
        for out in [o0 + i for i in range(-4, 5, 2) if out_min <= o0 + i <= out_max]:
            for flex in [x0 + i for i in range(-9, 10, 2) if 0 <= x0 + i <= flex_max]:
                d = (_hand_at(side, fwd, out, flex) - target).length
                if d < best[0]:
                    best = (d, fwd, out, flex)
    d, fwd, out, flex = best
    if d > limit:
        raise RuntimeError("%s: best hand fit %.4f m off target (fwd %d out %d flex %d)"
                           % (name, d, fwd, out, flex))
    P[name] = _arm(side, float(fwd), float(out), float(flex))
    neutral_upper()
    return {"err_mm": round(d * 1000, 1), "fwd": fwd, "out": out, "flex": flex}


# 접객 제스처 — **흰 팔은 흰 몸통에 묻혀 안 읽힌다**(AJ 실측). 앞으로만 뻗으면
# 실루엣에 아무것도 안 나오므로 바깥으로도 벌려 배경과 맞닿게 한다.
# 팔 스윙 20~50°는 화면에서 몇 픽셀이라 70~85° 를 써야 읽힌다(AJ 실측).
# **정면 카메라에서는 '앞으로 뻗기'가 거의 안 보인다.** 게임의 점원은 카운터
# 뒤에서 플레이어와 마주 보므로 시점이 항상 정면이고, 앞으로 나가는 성분은
# 단축돼 실루엣에 안 나타난다(1차 클립 렌더에서 확인).
#
# 그렇다고 벌림·굽힘을 같이 키우면 안 된다 — 2차에서 벌림 46~54° + 굽힘
# 78~86° 를 동시에 줬더니 **팔꿈치가 옆으로 벌어진 '닭날개'** 가 됐고, 게다가
# 손이 가슴 높이에 고정돼 모든 키 포즈가 서로 비슷해져 팔이 굳어 보였다.
# 읽히게 하는 건 각도의 크기가 아니라 **키 포즈 사이의 대비**다.
# 손을 **조끼 앞**으로 가져간다. 흰 팔이 흰 몸통에 묻히는 문제(AJ 실측)를
# 예전엔 팔을 옆으로 벌려 해결하려 했는데, 그게 '날개' 자세를 만들었다.
# 이 캐릭터는 몸통에 짙은 갈색 조끼가 있다 — 흰 손이 **그 앞을 지나가면**
# 벌리지 않아도 대비가 생긴다. 조끼 구간: 밑단 z≈0.42, 셰브론 z≈0.55, 목선 z≈0.73.
_VEST_MID = HEM_Z + (COLLAR_Z - HEM_Z) * 0.30      # 갈색 구간 한가운데
_VEST_HI = HEM_Z + (COLLAR_Z - HEM_Z) * 0.58       # 셰브론 위 파랑 구간
# 목표는 **실측한 도달 영역 안에서** 고른다. 벌림 26° 이하일 때 가슴 높이
# (z≈0.6)에서 손이 갈 수 있는 한계는 x −0.149 · y −0.088 이다. 그보다 앞으로
# 잡았다가 두 번 실패했다 — 팔이 짧아서 '앞으로 많이 + 위로 많이'가 동시에 안 된다.
# 그래서 제스처를 **세로 왕복**으로 설계한다(배 앞 ↔ 가슴 앞). 손이 갈색 조끼
# 앞을 지나가므로 벌리지 않아도 대비가 난다.
rep["arm_fit"] = {
    # 목표는 **정상 굴곡 기준으로 다시 잰** 영역에서 고른다. 팔꿈치 부호를 고치자
    # 도달 영역이 통째로 바뀌었다 — 상완을 안 올리고(fwd 0) 팔꿈치만 굽혀도
    # 손이 가슴 앞까지 온다. 팔을 치켜들 필요가 없어져 자세가 훨씬 자연스럽다.
    "talk_a": _fit_arm("talk_a", "R", Vector((-0.185, -0.150, 0.500)), flex_max=100),
    "talk_b": _fit_arm("talk_b", "R", Vector((-0.170, -0.170, 0.570)), flex_max=100),
    # 판매 — 한국 소매 관습대로 **양손으로** 건넨다. 한 손이면 '가리키기'로 읽힌다.
    # 집기는 계산대 높이(낮게), 건네기는 가슴 높이로 앞으로.
    "take_R": _fit_arm("take_R", "R", Vector((-0.130, -0.180, HEM_Z + 0.05)), flex_max=85),
    "take_L": _fit_arm("take_L", "L", Vector((0.130, -0.180, HEM_Z + 0.05)), flex_max=85),
    # 목례가 어깨를 앞·아래로 돌려 손을 끌어내린다(실측 궤적) — 중립에서 맞춘
    # 높이가 클립에서는 그만큼 낮아지므로 그 몫을 미리 얹어 잡는다.
    "give_R": _fit_arm("give_R", "R", Vector((-0.090, -0.215, 0.555)), flex_max=85),
    "give_L": _fit_arm("give_L", "L", Vector((0.090, -0.215, 0.555)), flex_max=85),
}


def arm_curve(keys, f):
    return [curve(f, [(k, P[nm][ax]) for k, nm in keys]) for ax in range(6)]


def clip(lower, lower_f0, lower_n, rot_off=None, arms=None, arm_off=None,
         cycle_to=None):
    """한 프레임의 포즈를 만드는 함수를 돌려준다 (SS 와 같은 조립기).

    rot_off : {bone: {axis: [(frame, deg)..]}} 기본 포즈에 더할 오프셋
    arms    : {side: [(frame, pose_name)..]} 팔 포즈 보간
    arm_off : {side: {axis(0..5): [(frame, deg)..]}} 팔에 더할 스윙
    """
    rot_off = rot_off or {}
    arms = arms or {}
    arm_off = arm_off or {}

    def ff(f):
        d = lower_cycle(lower, lower_f0, lower_n, cycle_to, f) if cycle_to \
            else lower_at(lower, lower_f0, lower_n, f)
        for bn in UPPER_BONES:
            d.setdefault(bn, {})["rot"] = base_upper(bn)
        for side in ("L", "R"):
            v = arm_curve(arms[side], f) if side in arms else list(P["base_" + side])
            for ax, keys in arm_off.get(side, {}).items():
                v[ax] += curve(f, keys)
            d["UpperArm." + side]["rot"] = v[:3]
            d["LowerArm." + side]["rot"] = v[3:]
        for bn, axes in rot_off.items():
            base = list(d.get(bn, {}).get("rot", base_upper(bn)))
            for ax, keys in axes.items():
                base[ax] += curve(f, keys)
            d[bn]["rot"] = base
        return d

    return ff


# 축 규약 (실측): rx = 앞으로 숙임, ry = 좌우 돌아보기, rz = 갸웃.
# rz 는 시선 방향을 전혀 바꾸지 못한다 — '돌아본다'는 반드시 ry 다.
CLIPS = []


def add(name, n, ff, loop):
    write_action(rig, KEYED, name, n, ff)
    CLIPS.append((name, n, loop))


# ---------------------------------------------------------------- CL_Idle
def f_idle(f):
    d = clip(IDLE_LOWER, IDLE_F[0], IDLE_N)(f)
    t = (f - 1) / float(IDLE_N - 1)
    tau = 2 * math.pi * t
    br = 1.0 * math.sin(tau)                 # 호흡
    # 훑기를 호흡과 **같은 위상**으로 두면 안 된다. 몸통 피치(공통 성분)와
    # 트위스트(차동 성분)가 같은 박자로 더해져 한쪽 손만 크게 흔들린다
    # (실측: 왼손 47mm vs 오른손 15mm — 리그는 완전 대칭인데도).
    # 90° 어긋내면 좌우가 균형을 되찾고, 두 리듬이 갈려 기계적인 느낌도 준다.
    sweep = 12.0 * math.cos(tau)             # 매장을 훑어본다. 1주기라 루프가 닫힌다
    d["Chest"]["rot"] = [base_upper("Chest")[0] + br, sweep * 0.28, 0.0]
    d["Spine"]["rot"] = [base_upper("Spine")[0] + br * 0.6, sweep * 0.15, 0.0]
    d["Head"]["rot"] = [base_upper("Head")[0] + 0.9 * math.sin(tau * 2), sweep, 0.0]
    for side in ("L", "R"):
        for bn in ("UpperArm." + side, "LowerArm." + side):
            r = list(d[bn]["rot"])
            r[0] += br * 0.5
            d[bn]["rot"] = r
    return d


add("CL_Idle", IDLE_N, f_idle, True)


# ---------------------------------------------------------------- CL_Walk
def f_walk(f):
    d = clip(WALK_LOWER, WALK_F[0], WALK_N)(f)
    t = (f - 1) / float(WALK_N - 1)
    sw = math.sin(2 * math.pi * t)
    # 양팔 자유 스윙(SS 는 총을 쥐어 한쪽만 흔들었다). 뒷스윙은 팔을 몸통으로
    # 밀어 넣어 MC 기준선 3.4mm 를 깨므로 앞뒤를 비대칭으로 주고,
    # 스윙 내내 조금 벌려 둔다 — 조끼 셸이 이미 15mm 를 먹었다.
    swf = sw if sw > 0 else sw * 0.45
    d["UpperArm.L"]["rot"][0] += swf * 20.0
    d["UpperArm.L"]["rot"][2] += ABDUCT_L * 0.55
    d["UpperArm.R"]["rot"][0] += -swf * 20.0
    d["UpperArm.R"]["rot"][2] += ABDUCT_R * 0.55
    # 팔꿈치는 걷는 내내 **앞으로만** 굽어 있어야 한다(rx 음수). 예전엔 스윙과
    # 같은 부호를 그대로 실어서 주기의 절반 동안 팔꿈치가 뒤로 꺾였다.
    d["LowerArm.L"]["rot"][0] += -(8.0 + swf * 5.0)
    d["LowerArm.R"]["rot"][0] += -(8.0 - swf * 5.0)
    d["Chest"]["rot"][1] += sw * 3.5
    d["Head"]["rot"][1] += -sw * 2.5
    return d


add("CL_Walk", WALK_N, f_walk, True)

# ---------------------------------------------------------------- CL_Talk
# 손님과 대화. 대화창이 떠 있는 동안 계속 도는 루프라 **처음과 끝이 같아야** 한다.
# 오른손만 쓴다 — 양손을 같이 흔들면 항복 자세로 읽힌다.
# 2차에서는 팔이 f14 에 올라가 f60 까지 거의 같은 자리에 머물렀다. 제스처는
# **올라갔다 내려오는 왕복**이라야 움직임으로 읽힌다 — 중간에 base 로 돌아오는
# 비트를 넣어 두 번의 제스처가 분명히 갈리게 한다.
TALK_N = 76
add("CL_Talk", TALK_N,
    clip(IDLE_LOWER, IDLE_F[0], IDLE_N, cycle_to=TALK_N,
         rot_off={"Head": {0: [(1, 0), (18, -4), (34, 3), (52, -3), (68, 2), (76, 0)],
                           1: [(1, 0), (20, 6), (44, -5), (76, 0)]},
                  "Chest": {1: [(1, 0), (20, 3), (44, -3), (76, 0)]}},
         arms={"R": [(1, "base_R"), (12, "talk_a"), (25, "talk_b"), (36, "talk_a"),
                     (46, "base_R"), (54, "base_R"), (64, "talk_b"),
                     (76, "base_R")]}), True)

# ---------------------------------------------------------------- CL_Sell
# 물건을 집어 → 손님에게 **양손으로** 건넨다. 한국 소매 관습이고, 양손이 같이
# 나가야 실루엣에서 '건네는 중'으로 읽힌다. 마지막에 가볍게 목례.
SELL_N = 56
_SELL_R = [(1, "base_R"), (14, "take_R"), (26, "take_R"), (40, "give_R"),
           (48, "give_R"), (56, "base_R")]
_SELL_L = [(1, "base_L"), (14, "take_L"), (26, "take_L"), (40, "give_L"),
           (48, "give_L"), (56, "base_L")]
# 목례는 몸통 전체가 움직여 **정면에서도 실루엣으로 읽히는 유일한 비트**다.
# 팔의 전후 동작이 단축으로 죽는 만큼 여기에 무게를 싣는다.
add("CL_Sell", SELL_N,
    clip(IDLE_LOWER, IDLE_F[0], IDLE_N,
         # 목례를 17°까지 줬더니 손 높이를 다 잡아먹었다. 접객 목례는 원래 얕다 —
         # 10° 면 충분하고, 손이 제일 앞으로 나가는 f40 이후에 얹어야 두 비트가 안 겹친다.
         rot_off={"Spine": {0: [(1, 0), (14, 5), (26, 4), (40, 5), (48, 9), (56, 0)]},
                  "Chest": {0: [(1, 0), (14, 6), (26, 5), (40, 6), (48, 11), (56, 0)]},
                  "Head": {0: [(1, 0), (14, 8), (26, 6), (40, 4), (48, 11), (56, 0)]}},
         arms={"R": _SELL_R, "L": _SELL_L}), False)

rep["clips"] = [{"name": n, "frames": fr, "loop": lp} for n, fr, lp in CLIPS]

# 루프 클립은 첫 프레임과 마지막 프레임의 포즈가 같아야 한다 — 어긋나면
# 재생이 순환할 때마다 눈에 띄게 튄다. 수치로 고정해 둔다.
neutral_upper()
for _name, _n, _loop in CLIPS:
    if not _loop:
        continue
    _act = bpy.data.actions[_name]
    _ad = rig.animation_data or rig.animation_data_create()
    _ad.action = _act
    _snap = []
    for _f in (1, _n):
        scene.frame_set(_f)
        dg.update()
        _snap.append([(rig.matrix_world @ rig.pose.bones[b].tail).copy() for b in KEYED])
    _ad.action = None
    _gap = max((a - b).length for a, b in zip(_snap[0], _snap[1]))
    rep.setdefault("loop_gap_m", {})[_name] = round(_gap, 5)
    if _gap > 0.004:
        raise RuntimeError("loop clip %s does not close: %.4f m" % (_name, _gap))

# ------------------------------------------------------------- 10. 정리 & 저장
scene.frame_start = 1
scene.frame_end = IDLE_N
ad = rig.animation_data or rig.animation_data_create()
ad.action = bpy.data.actions["CL_Idle"]
scene.frame_set(1)
bpy.context.view_layer.update()

for o in bpy.data.objects:
    o.select_set(False)
rep["objects"] = [{"name": o.name, "type": o.type,
                   "loc": [round(v, 5) for v in o.location],
                   "parent": o.parent.name if o.parent else None,
                   "mods": [(m.name, m.type) for m in o.modifiers],
                   "mats": [m.name for m in o.data.materials] if o.type == 'MESH' else None,
                   "verts": len(o.data.vertices) if o.type == 'MESH' else None,
                   "tris": sum(len(p.vertices) - 2 for p in o.data.polygons)
                   if o.type == 'MESH' else None}
                  for o in bpy.data.objects]
rep["bones"] = len(rig.data.bones)

bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(OUT), copy=False)
rep["saved"] = os.path.abspath(OUT)
with open(REPORT, "w") as fh:
    json.dump(rep, fh, indent=1, ensure_ascii=False)
print("CL BUILD OK ->", OUT)
