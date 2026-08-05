"""ITM 픽업 소품 빌드 — 교통카드(ITM-04) · 마스크(ITM-06) · 우산(ITM-09).

실행:  blender -b --factory-startup --python tools/items_build.py -- <out.blend>

왜 맵에 굽지 않는가
  기존 ITM-05(이어폰)·ITM-14(배터리)는 station_map.blend 안에 놓인 지오메트리라
  **세상에 놓이기만 한다.** 여기 셋은 손에도 들려야 한다 — 카드는 개찰구에
  찍고, 우산은 인파를 비켜세우고, 마스크는 착용한다. 맵에 구우면 그 자리에서
  숨기는 것 말고는 못 한다. 그래서 별도 GLB 로 뽑고 자리는 데이터로 넘긴다.

색 체계 (세 소품이 한 세트로 보이게)
  * 순수 검정·순수 흰색을 쓰지 않는다. 가장 어두운 색이 #2B3D66, 가장 밝은
    색이 #F4F8F8 다. 검정에 가까운 음영을 두면 그 면이 파인 것처럼 보인다.
  * 탁한 저채도 대신 같은 색 계열 안에서 **밝고 맑은 중간톤**을 쓴다.
    회색이 섞이면 먼지 낀 색이 되고, 세 소품이 한 세트로 안 보인다.
  * 한 소품이 쓰는 주요 색은 3~4개까지. 면마다 임의로 칠하지 않고 **구조와
    재질이 바뀌는 곳에서만** 나눈다.
  * 접힘·주름은 색을 따로 칠하지 않고 같은 색 계열의 명도 차이로만 낸다.
  * 포인트 컬러(웜 옐로)는 카드 NFC 심볼과 우산 스트랩에만 아주 조금 쓴다 —
    두 소품이 같은 세트라는 신호가 이것 하나다.

크기 규약
  캐릭터 전신이 0.888 이고, 기존 소품은 실물보다 1.5배쯤 과장돼 있다
  (PR_Carrier 0.414 = 전신의 47%, 실제 기내용 캐리어는 32%). 치비 양식이라
  실치수를 그대로 넣으면 손에서 사라진다. 같은 과장을 따른다.

원점 규약
  손에 붙일 지점에 원점을 둔다 — 우산은 손잡이, 카드·마스크는 중심.
"""
import bpy, sys, os, json, math
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib.blend import new_mat, set_active   # noqa: E402

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else None
if not OUT:
    raise RuntimeError("output .blend path required after --")
REPORT = os.environ.get("ITEMS_REPORT", "/tmp/items_build_report.json")

BODY_H = 0.888          # 캐릭터 전신 (크기 대조용)
PHONE_L = 0.100         # PR_Phone 장변 (기존 소품 대조용)
BEVEL_S = 0.0006        # 공통 베벨

rep = {}
_REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ------------------------------------------------------------------ 도우미
def _mesh(name, verts, faces, mats, mat_idx=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    for m in (mats if isinstance(mats, (list, tuple)) else [mats]):
        o.data.materials.append(m)
    if mat_idx is not None:
        for p, i in zip(me.polygons, mat_idx):
            p.material_index = i
    return o


def _apply(o, mod):
    set_active(o)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def bevel(o, width, segments=1, mat_index=-1):
    """모서리 깎기. `mat_index` 를 주면 깎인 면만 다른 재질이 된다 —
    앞면과 옆면 사이에 '빛 받는 모서리'를 끼워 어두운 테두리를 없애는 데 쓴다."""
    if width <= 0:
        return o
    m = o.modifiers.new("Bevel", 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(35)
    m.material = mat_index
    _apply(o, m)
    return o


def round_rect(w, h, r, seg=3):
    """가운데가 (0,0) 인 라운드 사각형 외곽선 (x, z). 반시계 방향."""
    hw, hh = w / 2.0 - r, h / 2.0 - r
    if hw < 0 or hh < 0:
        raise RuntimeError("corner radius %g too large for %gx%g" % (r, w, h))
    pts = []
    for cx, cz, a0 in ((hw, hh, 0.0), (-hw, hh, 90.0),
                       (-hw, -hh, 180.0), (hw, -hh, 270.0)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90.0 * i / seg)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    out = []
    for p in pts:                                   # 귀 이음매의 중복점 제거
        if not out or abs(p[0] - out[-1][0]) > 1e-9 or abs(p[1] - out[-1][1]) > 1e-9:
            out.append(p)
    if abs(out[0][0] - out[-1][0]) < 1e-9 and abs(out[0][1] - out[-1][1]) < 1e-9:
        out.pop()
    return out


def plate(name, w, h, r, thick, mat, seg=3, y=0.0, cx=0.0, cz=0.0, edge_mat=None,
          rot=0.0):
    """XZ 평면의 라운드 사각형 판. y 를 중심으로 thick 만큼 두껍다.

    `edge_mat` 을 주면 옆면만 다른 재질이 된다 — 옆면을 본체보다 밝게 잡아
    조명이 만드는 어두운 테두리를 지우는 데 쓴다.
    """
    ring = round_rect(w, h, r, seg)
    if rot:
        _c, _s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        ring = [(x * _c - z * _s, x * _s + z * _c) for x, z in ring]
    n = len(ring)
    front = [(x + cx, y - thick / 2.0, z + cz) for x, z in ring]
    back = [(x + cx, y + thick / 2.0, z + cz) for x, z in ring]
    faces = [tuple(range(n))]                                  # 앞면
    faces += [(n + i, n + (i + 1) % n, (i + 1) % n, i) for i in range(n)]  # 옆면
    faces.append(tuple(range(2 * n - 1, n - 1, -1)))            # 뒷면
    if edge_mat is None:
        return _mesh(name, front + back, faces, mat)
    idx = [0] + [1] * n + [0]
    return _mesh(name, front + back, faces, [mat, edge_mat], idx)


def arc_band(name, r0, r1, a0, a1, seg, thick, mat, y=0.0, cx=0.0, cz=0.0):
    """부채꼴 띠(원호 밴드). NFC 파동 심볼을 만드는 데 쓴다."""
    fr, bk = [], []
    for i in range(seg + 1):
        a = math.radians(a0 + (a1 - a0) * i / seg)
        for r in (r1, r0):
            fr.append((cx + r * math.cos(a), y - thick / 2.0, cz + r * math.sin(a)))
            bk.append((cx + r * math.cos(a), y + thick / 2.0, cz + r * math.sin(a)))
    n = len(fr)
    verts = fr + bk
    faces = []
    for i in range(seg):
        o_ = i * 2
        faces.append((o_, o_ + 2, o_ + 3, o_ + 1))                       # 앞
        faces.append((n + o_ + 1, n + o_ + 3, n + o_ + 2, n + o_))       # 뒤
        faces.append((o_, o_ + 1, n + o_ + 1, n + o_))                   # 안쪽 옆
        faces.append((o_ + 2, n + o_ + 2, n + o_ + 3, o_ + 3))           # 바깥 옆
    faces.append((0, 1, n + 1, n))
    faces.append((seg * 2, n + seg * 2, n + seg * 2 + 1, seg * 2 + 1))
    return _mesh(name, verts, faces, mat)


def tube(name, pts, radius, seg, mat):
    """점 목록을 잇는 튜브.

    단면 좌표계를 **평행 이송**한다. 점마다 고정 기준축(up)에서 새로 만들면,
    경로가 수직에 가까워지는 순간 기준축이 바뀌며 링 감김이 뒤집힌다.
    그 이음매의 사각형은 나비넥타이가 되어 면적이 상쇄돼 0 이 된다
    (실측: 마스크 귀걸이에서 4개).

    정점을 직접 놓는 이유는 따로 있다 — 실린더를 회전 적용한 뒤 월드 XY 로
    반경을 주면 기울어진 구간이 전단된다.
    """
    P = [Vector(p) for p in pts]
    if len(P) < 2:
        raise RuntimeError("tube needs >= 2 points")
    R = list(radius) if hasattr(radius, "__len__") else [radius] * len(P)
    if len(R) != len(P):
        raise RuntimeError("radius list must match point count")
    tangents = []
    for i in range(len(P)):
        d = P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]
        tangents.append(d.normalized() if d.length > 1e-9 else Vector((0.0, 0.0, 1.0)))
    ref = Vector((0.0, 0.0, 1.0))
    if abs(tangents[0].dot(ref)) > 0.95:
        ref = Vector((1.0, 0.0, 0.0))
    u = tangents[0].cross(ref).normalized()
    verts, faces = [], []
    for i, p in enumerate(P):
        d = tangents[i]
        u = (u - d * u.dot(d))                    # 이전 축을 새 단면에 투영
        if u.length < 1e-9:
            u = d.cross(Vector((1.0, 0.0, 0.0)))
        u.normalize()
        v = d.cross(u).normalized()
        for k in range(seg):
            a = 2.0 * math.pi * k / seg
            verts.append(tuple(p + (u * math.cos(a) + v * math.sin(a)) * R[i]))
    for i in range(len(P) - 1):
        for k in range(seg):
            a, b = i * seg + k, i * seg + (k + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    faces.append(tuple(range(seg - 1, -1, -1)))
    base = (len(P) - 1) * seg
    faces.append(tuple(range(base, base + seg)))
    return _mesh(name, verts, faces, mat)


def lobed(name, rings, seg, mats, lobe=0.0, wobble=(), mat_pattern=None):
    """(z, radius) 고리를 쌓은 회전체.

    `lobe` 는 반경을 한 칸씩 번갈아 줄여 세로 골을 만든다. `wobble` 은 열마다
    반경을 조금씩 흔들어 **접힌 천의 비대칭 실루엣**을 낸다 — 완전히 균일한
    육각 기둥은 우산이 아니라 케이스로 읽힌다.

    `mat_pattern` 은 열별 머티리얼 인덱스다. 접힘 음영을 검은 면으로 칠하지
    않고 **같은 색 계열의 명도 차이**로 내는 방법이 이것이다.
    """
    verts, faces, idx = [], [], []
    nr = len(rings)
    for z, r in rings:
        for k in range(seg):
            a = 2.0 * math.pi * k / seg
            w = wobble[k % len(wobble)] if wobble else 1.0
            rr = r * (1.0 - lobe * (k % 2)) * w
            verts.append((rr * math.cos(a), rr * math.sin(a), z))
    for i in range(nr - 1):
        for k in range(seg):
            a, b = i * seg + k, i * seg + (k + 1) % seg
            faces.append((a, b, b + seg, a + seg))
            idx.append(mat_pattern[k % len(mat_pattern)] if mat_pattern else 0)
    faces.append(tuple(range(seg - 1, -1, -1)))
    idx.append(0)
    base = (nr - 1) * seg
    faces.append(tuple(range(base, base + seg)))
    idx.append(0)
    return _mesh(name, verts, faces, mats, idx)


def shade(o, smooth):
    for poly in o.data.polygons:
        poly.use_smooth = smooth
    return o


def slab(name, cen, dim, mat):
    """축 정렬 상자. 원점을 지정한 자리에 남긴다 — 문은 경첩이 원점이라야
    Z 회전만으로 열린다."""
    hx, hy, hz = dim[0] / 2.0, dim[1] / 2.0, dim[2] / 2.0
    cx, cy, cz = cen
    v = [(cx - hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz - hz),
         (cx + hx, cy + hy, cz - hz), (cx - hx, cy + hy, cz - hz),
         (cx - hx, cy - hy, cz + hz), (cx + hx, cy - hy, cz + hz),
         (cx + hx, cy + hy, cz + hz), (cx - hx, cy + hy, cz + hz)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
         (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return _mesh(name, v, f, mat)


def finish(name, parts):
    """부품을 합치고 평면 셰이딩. 원점은 건드리지 않는다."""
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    # set_active 는 다른 선택을 전부 해제한다 — 여기서 부르면 조인할 대상이
    # 사라져 "No mesh data to join" 이 뜬다. 액티브만 직접 지정한다.
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    # 정리 패스. 튜브 이음매에서 폭이 0 에 가까운 슬리버 면이 남는다
    # (실측: 귀걸이 끈에서 4개). 임계값을 푸는 대신 지운다.
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.mesh.dissolve_degenerate(threshold=1e-5)
    bpy.ops.mesh.delete_loose(use_verts=True, use_edges=True, use_faces=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    # 부품별 셰이딩을 보존한다. 전체 shade_flat 을 걸면 흰 마스크에서
    # 면마다 명도가 튀어 로우폴리 각짐이 과하게 드러난다.
    o.location = (0.0, 0.0, 0.0)
    return o


def measure(o):
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    d = [round(v, 4) for v in o.dimensions]
    return {"tris": tris, "verts": len(o.data.vertices), "dim_m": d,
            "vs_body_pct": round(100.0 * max(d) / BODY_H, 1),
            "vs_phone_x": round(max(d) / PHONE_L, 2),
            "materials": [m.name for m in o.data.materials if m]}


# ------------------------------------------------------------------ 씬 준비
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = 30
sc.unit_settings.system = 'METRIC'

# 세 소품이 공유하는 팔레트. 순수 검정(#000)·순수 흰색(#fff)은 쓰지 않는다.
# 팔레트 — 캐주얼 모바일 게임 기준. 회색기를 빼고 중간 명도를 올린다.
# 어둡게 만들 때 회색을 섞지 않고 **같은 색의 더 깊은 버전**을 쓴다.
# 카드=옐로 · 우산=딥 네이비로 주색을 갈라 작게 보여도 구별되게 한다.
# 세트를 묶는 고리는 따뜻한 포인트다 — 카드 NFC 가 코랄, 우산 스트랩이 오렌지.
M_CARD = new_mat("ITM_CardBody", "F2C94C", 0.38)        # 선샤인 옐로 (기본색)
# 옆면은 지시대로 골든 옐로(어두운 쪽)다. 그러면 앞면과 옆면 사이가 뚝
# 끊겨 카드가 두꺼워 보이므로, **베벨로 깎인 모서리에 라이트 옐로**를
# 끼워 둘을 잇는다. 이 면이 실제로 빛을 받는 자리다.
M_CARD_LIT = new_mat("ITM_CardLit", "FFD966", 0.36)     # 라이트 옐로 (모서리)
M_CARD_EDGE = new_mat("ITM_CardEdge", "C99B2E", 0.40)   # 골든 옐로 (옆면·가장 어두운 부분)
M_CARD2 = new_mat("ITM_CardCream", "FFF0B8", 0.34)      # 크림 아이보리 (하단 바·뒷면 띠)
M_CARD_NFC = new_mat("ITM_CardNfc", "FFF4C7", 0.34)     # 밝은 아이보리 (NFC 안쪽 선)
M_POINT = new_mat("ITM_PointCoral", "F2645A", 0.36)     # 코랄 레드 (NFC 바깥 선)

# 노선도 — 노선 색은 셋까지만 쓴다. 서울 노선도의 인상을 만드는 건
# **초록 순환선과 그걸 가로지르는 선들**이지 색의 가짓수가 아니다.
M_PAPER = new_mat("ITM_MapPaper", "F2F4F0", 0.92)       # 종이

M_CLOTH = new_mat("ITM_MaskCloth", "EEF4F7", 0.96)      # 블루화이트 — 무광 부직포
M_CLOTH_IN = new_mat("ITM_MaskInner", "E3EDF2", 0.96)   # 안쪽 면
M_LOOP = new_mat("ITM_MaskLoop", "F7FAFB", 0.94)        # 오프화이트 끈
M_PLEAT = new_mat("ITM_MaskPleat", "D9E5EC", 0.96)      # 주름 음영 (펼친 마스크)
M_FOLDSH = new_mat("ITM_MaskFoldSh", "DCE6EC", 0.96)    # 접힘 음영 (접힌 마스크)

# 우산 — 같은 블루 계열 안에서 명도만 8~15% 차이. 검게 뭉치는 면을 만들지 않는다.
# 우산 팔레트 — **접힌 상태와 펼친 상태가 이 한 벌을 공유한다.**
# 상태별로 색을 따로 두면 같은 우산이 접히면 초록, 펼치면 네이비가 된다
# (실제로 그렇게 갈렸다). 재질을 하나로 합쳐 어긋날 수 없게 만든다.
# 네 단계 전부 같은 네이비 계열이고, 가장 어두운 면도 검정이 아니다.
M_UMB = new_mat("ITM_UmbBase", "2F4E8F", 0.64)          # 딥 네이비 (패널 기본색)
M_UMB_LIT = new_mat("ITM_UmbLit", "4A6BB3", 0.64)       # 빛 받는 면
M_UMB_MID = new_mat("ITM_UmbMid", "3B5DA3", 0.64)       # 중간 면
M_UMB_DEEP = new_mat("ITM_UmbDeep", "243A6B", 0.64)     # 가장 어두운 면 — 검정 아님
# 스트랩 포인트는 네이비의 채도·명도에 맞춘 오렌지다. 밝기만 올린 형광
# 오렌지는 네이비 위에서 혼자 튀고, 채도를 낮추면 탁한 갈색이 된다.
M_UMB_STRAP_PT = new_mat("ITM_UmbStrap", "E67A45", 0.44)   # 오렌지 (무광 밴드)
M_UMB_GRIP = new_mat("ITM_UmbGrip", "2C313A", 0.52)     # 차콜 손잡이
M_UMB_METAL = new_mat("ITM_UmbMetal", "727C88", 0.36, metallic=0.40)  # 건메탈

ITEMS = {}

# ============================================== ITM-04 교통카드 (P0)
# 금융카드로 보이던 요소를 걷어냈다 — 금색 IC 칩과 카드번호처럼 읽히던
# 가로선 둘을 없애고, 대신 NFC 파동(원호 3겹)을 넣었다. 태그하는 물건이라는
# 신호가 이것 하나로 충분하다.
# 원점은 카드 중심 — 개찰구에 찍을 때 손이 카드 가운데를 쥔다.
CW, CH, CT = 0.084, 0.053, 0.0026
CR = 0.0042                       # 네 귀 라운딩 (실물 3.18mm 와 같은 비율)
# 그래픽은 표면과 같은 높이로 읽혀야 한다. 0 으로 두면 Z-파이팅이 지글거리므로
# 84mm 카드에서 0.05mm 만 띄운다 — 눈으로는 평평하다.
FLAT = 0.00005
_fy = -CT / 2.0 - FLAT

_body = plate("card_body", CW, CH, CR, CT, M_CARD, seg=3, edge_mat=M_CARD_EDGE)
_body.data.materials.append(M_CARD_LIT)          # 슬롯 2 = 깎인 모서리
bevel(_body, BEVEL_S * 0.9, 2, mat_index=2)
_parts = [_body]

# 하단 보조 그래픽 영역 — 카드를 양분하던 무거운 띠를 낮췄다 (28% → 15%).
# 옆면에 진한 선이 생기지 않도록 외곽선보다 안쪽으로 물린다.
# 하단 바를 15% → 12% 로 더 낮췄다. 두꺼우면 카드가 위아래로 갈린다.
_parts.append(plate("card_band", CW * 0.88, CH * 0.12, 0.0018, FLAT * 2, M_CARD2,
                    seg=2, y=_fy, cz=-CH * 0.335))

# NFC 파동 — 왼쪽에서 오른쪽으로 퍼지는 원호 3겹. 바깥으로 갈수록 얇아진다.
# 세 호의 굵기와 간격을 똑같이 맞춘다 — 들쭉날쭉하면 정렬이 안 된 것으로 읽힌다.
# 위치도 왼쪽 치우침을 줄이고 하단 바 위 여백 가운데에 놓는다.
_WT, _WG = 0.0013, 0.0040
for _i in range(3):
    _r = 0.0060 + _WG * _i
    _m = M_POINT if _i == 2 else M_CARD_NFC
    _parts.append(arc_band("card_wave%d" % _i, _r, _r + _WT, -52.0, 52.0, 5,
                           FLAT * 2, _m, y=_fy, cx=-CW * 0.10, cz=CH * 0.09))

# 뒷면 띠 — 갈색 마그네틱 스트라이프처럼 보이지 않게 크림으로, 그리고 얇게.
_parts.append(plate("card_stripe", CW * 0.90, CH * 0.085, 0.0006, FLAT * 2, M_CARD2,
                    seg=1, y=CT / 2.0 + FLAT, cz=CH * 0.30))

for _p in _parts:
    shade(_p, False)
ITEMS["ITM04_Card"] = finish("ITM04_Card", _parts)

# ============================================== ITM-06 마스크 (P1)
# 실루엣을 다시 잡았다. 직사각 격자를 휘기만 해서는 '휘어진 천 조각'이지
# 마스크가 아니다. 얼굴에 걸리는 구조가 실루엣에 있어야 한다 —
#   ① 외곽선이 사각형이 아니다. 위는 콧등 폭으로 좁고, 가운데가 가장 넓고,
#      아래는 턱을 감싸며 다시 좁아진다.
#   ② 윗변 가운데에 얕은 코 굴곡(노즈 브리지)이 있다.
#   ③ 아랫변은 가운데가 가장 낮게 내려와 턱을 받친다.
#   ④ 가로 주름은 큰 것 3개뿐. 색을 칠하지 않고 얕은 접힘으로만 낸다.
# 패널만 **부드러운 셰이딩**을 쓴다. 흰 마스크에서 로우폴리 각짐이 가장 크게
# 드러나는데, 면마다 명도가 튀면 부직포가 아니라 종이 접기로 보인다.
MW, MH = 0.096, 0.055    # 가로:세로 1.75 — 세로가 길면 그릇으로 보인다
NOSE = 0.019          # 좌우가 뒤로 감기는 깊이
NOSE_B = 0.0055       # 콧등 굴곡
TUCK = 0.0085         # 위·아래가 얼굴 쪽으로 말리는 양
PLEAT = 0.0032        # 주름 진폭. 부드러운 셰이딩에서는 얕으면 아예 사라진다
NCOL, NROW = 7, 11
_vs, _fs = [], []
for ri in range(NROW):
    v = ri / (NROW - 1.0)                              # 0=위, 1=아래
    # 폭: 위(콧등) 0.90 → 가운데 1.00 → 아래(턱) 0.76
    # 위 0.94 → 가운데 1.00 → 아래 0.86. 더 좁히면 사각형이 아니라 원이 된다.
    if v < 0.45:
        wsc = 1.0 - 0.06 * ((v - 0.45) / 0.45) ** 2
    else:
        wsc = 1.0 - 0.14 * ((v - 0.45) / 0.55) ** 2
    # 주름 3개. 행이 적을 때 주기가 짧으면 격자로 보이므로 얕게만 준다.
    t = 3.0 * v
    pleat = PLEAT * (2.0 * abs(t - round(t)) - 0.5)
    for ci in range(NCOL):
        u = ci / (NCOL - 1.0) - 0.5
        ur = (u / 0.5) ** 2
        z_top = MH * (0.50 - 0.02 * ur)                # 윗변은 거의 곧다
        z_bot = MH * (-0.50 + 0.09 * ur)               # 아랫변은 가운데가 가장 낮다
        z = z_top + (z_bot - z_top) * v
        wrap = -NOSE * (1.0 - ur)                      # 가운데가 앞(-Y)
        nose = -NOSE_B * (1.0 - ur) * math.exp(-((v - 0.05) / 0.12) ** 2)
        curl = 0.0
        if v < 0.14:
            curl += TUCK * ((0.14 - v) / 0.14) ** 2
        if v > 0.78:
            curl += TUCK * 1.25 * ((v - 0.78) / 0.22) ** 2
        _vs.append((u * MW * wsc, wrap + nose + curl + pleat, z))
for ri in range(NROW - 1):
    for ci in range(NCOL - 1):
        i = ri * NCOL + ci
        _fs.append((i, i + 1, i + NCOL + 1, i + NCOL))
_panel = _mesh("mask_panel", _vs, _fs, [M_CLOTH, M_CLOTH_IN])
set_active(_panel)
_sol = _panel.modifiers.new("Solidify", 'SOLIDIFY')
_sol.thickness = 0.0010                               # 얇은 부직포 한 장
_sol.offset = 0.0
_sol.material_offset = 1                              # 안쪽 면만 5% 어둡게
_sol.material_offset_rim = 1
_apply(_panel, _sol)
shade(_panel, True)
_parts = [_panel]

# 귀걸이 — 얇고 둥근 탄성 끈. 끝을 가늘게 해서 패널에 자연스럽게 묻힌다.
for sx in (1, -1):
    x0 = MW * 0.415 * sx
    npt = 10
    arc, rad = [], []
    for i in range(npt):
        a_ = math.pi * i / (npt - 1.0)
        arc.append((x0 + 0.004 * sx * math.sin(a_),
                    0.003 + 0.034 * math.sin(a_),
                    math.cos(a_) * MH * 0.33))
        edge = min(i, npt - 1 - i) / 2.0
        rad.append(0.0009 * (0.55 + 0.45 * min(1.0, edge)))
    _parts.append(shade(tube("mask_loop%s" % ("L" if sx > 0 else "R"),
                             arc, rad, 7, M_LOOP), True))
ITEMS["ITM06_Mask"] = finish("ITM06_Mask", _parts)

# ============================================== ITM-09 우산 (P1)
# 접힌 장우산. 우산을 우산으로 만드는 건 캐노피가 아니라 **J자 갈고리**다
# (방추형은 펜, 직선 그립은 다트로 보였다).
# 천은 육각 기둥이 아니라 여러 겹이 모인 비대칭 덩어리로 읽혀야 한다 —
# 열마다 반경을 흔들고(wobble), 접힘 음영을 **같은 색 계열의 명도 차이**로 낸다.
# 검은 면을 섞으면 천이 아니라 그림자 뭉치가 된다.
# **원점을 손잡이 쥐는 자리에 둔다** — 여기가 (0,0,0) 이어야 손에 붙였을 때
# 우산이 손에서 자라난다.
# 손잡이 — 곡선을 부드럽게, 끝으로 갈수록 가늘게. 끝이 두꺼우면
# 플라스틱이 아니라 블록으로 보인다.
HOOK = [(0.0, 0.0, 0.032), (0.0, 0.0, -0.012)]
_HR, _HC = 0.025, -0.028
for _i in range(1, 8):
    _a = math.pi * _i / 7.0
    HOOK.append((0.0, _HR * (1.0 - math.cos(_a)), _HC - _HR * math.sin(_a) * 0.60))
HOOK_R = [0.0088, 0.0088] + [0.0088 - 0.0026 * (i / 6.0) ** 1.4 for i in range(7)]

CAN_LO, CAN_HI = 0.046, 0.268          # 최대 폭을 줄이고 세로로 길게
# 패널 색은 **조명 방향을 따르는 명도 흐름**이다. 무작위로 교차시키면
# 서커스 우산처럼 보인다. 키 라이트가 +38도에서 오므로 그쪽 열이 밝고
# 반대쪽이 그늘진다. 같은 블루 계열 안에서 명도만 갈린다.
# 인덱스 밝기 순서: 3(가장 어두움) < 0(기본) < 2(중간) < 1(밝음).
# 키 라이트가 +38도이므로 k=1(45도)이 가장 밝고 k=4~5(180~225도)가 그늘이다.
CAN_MATS = [M_UMB, M_UMB_LIT, M_UMB_MID, M_UMB_DEEP]
CAN_PATTERN = [2, 1, 2, 0, 3, 3, 0, 2]
CAN_WOBBLE = (1.00, 0.90, 1.05, 0.95, 1.02, 0.87, 1.06, 0.93)

_parts = [
    tube("umb_hook", HOOK, HOOK_R, 7, M_UMB_GRIP),
    lobed("umb_shaft", [(0.028, 0.0050), (CAN_LO + 0.006, 0.0050)], 6, M_UMB_METAL),
    # 아래쪽이 갑자기 좁아지면 위아래가 별개 부품으로 보인다 — 완만하게 잇는다.
    lobed("umb_canopy",
          [(CAN_LO, 0.0152), (CAN_LO + 0.022, 0.0182), (CAN_LO + 0.058, 0.0196),
           (CAN_LO + 0.104, 0.0204), (CAN_HI - 0.062, 0.0198), (CAN_HI - 0.024, 0.0182),
           (CAN_HI, 0.0150)],
          8, CAN_MATS, lobe=0.10, wobble=CAN_WOBBLE, mat_pattern=CAN_PATTERN),
    # 스트랩 — 얇은 링이 아니라 천을 감는 띠. 넓히고 채도를 낮췄다.
    lobed("umb_strap", [(CAN_LO + 0.062, 0.0206), (CAN_LO + 0.086, 0.0206)],
          8, M_UMB_DEEP, wobble=CAN_WOBBLE),
    lobed("umb_strap_pt", [(CAN_LO + 0.0665, 0.0210), (CAN_LO + 0.0815, 0.0210)],
          8, M_UMB_STRAP_PT, wobble=CAN_WOBBLE),
    lobed("umb_ferrule", [(CAN_HI - 0.002, 0.0076), (CAN_HI + 0.010, 0.0062),
                          (CAN_HI + 0.019, 0.0028)], 6, M_UMB_METAL),
]
for _p in _parts:
    bevel(_p, BEVEL_S, 1)
    shade(_p, False)
ITEMS["ITM09_Umbrella"] = finish("ITM09_Umbrella", _parts)

# ======================================= ITM-06B 접힌 마스크 (판매 상태)
# 펼친 마스크와 **같은 제품**으로 보여야 한다 — 재질·색·주름 언어를 공유하고
# 상태만 다르다. 착용 전이라 더 단정하고 평평하다.
FW, FH = 0.096, 0.036
FPLEAT = 0.0013       # 접힌 상태의 주름은 펼친 것보다 얕다
FCOL, FROW = 5, 10
_vs, _fs = [], []
for ri in range(FROW):
    v = ri / (FROW - 1.0)
    t = 3.0 * v                                        # 가로 주름 3개 (같은 언어)
    pleat = FPLEAT * (2.0 * abs(t - round(t)) - 0.5)
    for ci in range(FCOL):
        u = ci / (FCOL - 1.0) - 0.5
        ur = (u / 0.5) ** 2
        # 위·아래 끝만 아주 살짝 좁혀 모서리를 정돈한다
        wsc = 1.0 - 0.05 * (2.0 * abs(v - 0.5)) ** 2
        bow = -0.0016 * (1.0 - ur)                     # 아주 완만한 배부름
        _vs.append((u * FW * wsc, bow + pleat, (0.5 - v) * FH))
for ri in range(FROW - 1):
    for ci in range(FCOL - 1):
        i = ri * FCOL + ci
        _fs.append((i, i + 1, i + FCOL + 1, i + FCOL))
_fold = _mesh("maskf_panel", _vs, _fs, [M_CLOTH, M_FOLDSH])
set_active(_fold)
_sol = _fold.modifiers.new("Solidify", 'SOLIDIFY')
_sol.thickness = 0.0042                                # 접혀서 겹친 두께
_sol.offset = 0.0
_sol.material_offset = 1
_sol.material_offset_rim = 1
_apply(_fold, _sol)
shade(_fold, True)
_parts = [_fold]
# 끈은 뒤로 넘겨 납작하게 정리한다. 판매 상태에서 끈이 퍼져 있으면
# 접힌 마스크의 외형이 흐트러진다.
for sx in (1, -1):
    x0 = FW * 0.46 * sx
    npt = 8
    arc, rad = [], []
    for i in range(npt):
        a_ = math.pi * i / (npt - 1.0)
        arc.append((x0 + 0.010 * sx * math.sin(a_),
                    0.0034 + 0.006 * math.sin(a_),
                    math.cos(a_) * FH * 0.34))
        edge = min(i, npt - 1 - i) / 2.0
        rad.append(0.0008 * (0.6 + 0.4 * min(1.0, edge)))
    _parts.append(shade(tube("maskf_loop%s" % ("L" if sx > 0 else "R"),
                             arc, rad, 6, M_LOOP), True))
ITEMS["ITM06_MaskFolded"] = finish("ITM06_MaskFolded", _parts)

# ======================================= ITM-09B 펼친 우산
# 접힌 우산과 **같은 제품**이다 — 손잡이·축·팁·색을 그대로 쓰고 캐노피만
# 펼쳐진 상태다. 스트랩은 천을 감고 있지 않으므로 없다.
# 8개 살 + 살 사이가 처지는 스캘럽 가장자리로 '펼쳐진 우산'이 읽힌다.
# 돔 형상. 이전 것은 낮고 옆으로 퍼져 천막처럼 보였다 —
# 중앙을 35% 높이고 지름을 12% 줄여 측면에서 아치가 분명히 보이게 한다.
# 완전히 펼친 우산은 높이가 아니라 **폭**이다. H/R 이 1.0 이면 반쯤 펴진
# 차양막으로 읽힌다 — 실제 개방 우산은 0.45~0.55 다.
O_R = 0.290                            # 반지름 (0.207 → +40%)
O_H = 0.145                            # 돔 높이 (H/R = 0.50)
O_EDGE_Z = 0.175
O_APEX = O_EDGE_Z + O_H
O_SHAFT_TOP = O_APEX + 0.018
NRIB = 8
NSEG = NRIB * 2
# z = 가장자리 + H·(1 − t^1.8). 타원으로 잡으면 위가 납작해 버섯이 되고,
# 원뿔로 잡으면 고깔이 된다. 이 지수라야 우산 아치가 나온다.
# dz 는 살과 살 사이의 굴곡 — 이전 0.022 는 꽃잎처럼 크게 꺾였다.
# t^2.2 — 꼭대기는 둥글고 가장자리로 갈수록 곧게 뻗는다. 지수가 낮으면
# 고깔, 높으면 버섯이 된다. 마지막 두 링(0.93·1.00)이 테두리를 살짝 말아
# 패널 끝이 뾰족해지지 않게 한다.
O_RINGS = []
for _t, _dz in ((0.28, 0.0008), (0.55, 0.0018), (0.78, 0.0028),
                (0.93, 0.0036), (1.00, 0.0040)):
    O_RINGS.append((O_R * _t, O_EDGE_Z + O_H * (1.0 - _t ** 2.2), _dz))

_vs = [(0.0, 0.0, O_APEX)]
for r, z, dz in O_RINGS:
    for k in range(NSEG):
        a_ = 2.0 * math.pi * k / NSEG
        rib = (k % 2 == 0)
        rr = r if rib else r * 0.993    # 골을 아주 살짝만 당긴다 — 원형 테두리 유지
        zz = z + (dz if rib else -dz)
        _vs.append((rr * math.cos(a_), rr * math.sin(a_), zz))

# 패널은 **전부 같은 기본색**이다. 링마다 어둡게 하거나 패널을 번갈아 칠하면
# 서커스 우산이 된다. 조명 방향(키 라이트 +38도)에 가까운 열만 밝게 준다.
def _lit(k):
    """조명 방향에 따른 명도 단계. 패널을 임의로 칠하지 않는다 —
    같은 네이비 계열 안에서 밝은 면 / 중간 면 / 기본색 셋뿐이다."""
    d = abs(((k * 360.0 / NSEG) - 38.0 + 180.0) % 360.0 - 180.0)
    return 1 if d < 46.0 else (2 if d < 104.0 else 0)

_fs, _idx = [], []
for k in range(NSEG):
    _fs.append((0, 1 + k, 1 + (k + 1) % NSEG))
    _idx.append(_lit(k))
for ri in range(len(O_RINGS) - 1):
    b0, b1 = 1 + ri * NSEG, 1 + (ri + 1) * NSEG
    for k in range(NSEG):
        kn = (k + 1) % NSEG
        _fs.append((b0 + k, b0 + kn, b1 + kn, b1 + k))
        _idx.append(_lit(k))
_canopy = _mesh("umbo_canopy", _vs, _fs,
                [M_UMB, M_UMB_LIT, M_UMB_MID, M_UMB_DEEP], _idx)
set_active(_canopy)
_sol = _canopy.modifiers.new("Solidify", 'SOLIDIFY')
_sol.thickness = 0.0026
_sol.offset = 0.0
_sol.material_offset = 3                # 아랫면은 가장 어두운 네이비. 검정을 쓰지 않는다
_sol.material_offset_rim = 3
_apply(_canopy, _sol)
shade(_canopy, False)

# 손잡이는 조금 더 크고 매끄러운 J 자. 멀리서 우산으로 읽히는 건 이 갈고리다.
O_HOOK = [(0.0, 0.0, 0.034), (0.0, 0.0, -0.012)]
_OHR, _OHC = 0.030, -0.030
for _i in range(1, 10):
    _a = math.pi * _i / 9.0
    O_HOOK.append((0.0, _OHR * (1.0 - math.cos(_a)), _OHC - _OHR * math.sin(_a) * 0.60))
O_HOOK_R = [0.0100, 0.0100] + [0.0100 - 0.0028 * (i / 8.0) ** 1.4 for i in range(9)]

_parts = [
    tube("umbo_hook", O_HOOK, O_HOOK_R, 8, M_UMB_GRIP),
    # 축은 12% 굵게. 캐노피 중심(0,0)과 정확히 정렬된다.
    lobed("umbo_shaft", [(0.030, 0.0057), (O_SHAFT_TOP, 0.0053)], 8, M_UMB_METAL),
    lobed("umbo_tip", [(O_SHAFT_TOP, 0.0072), (O_SHAFT_TOP + 0.018, 0.0028)], 8, M_UMB_METAL),
    _canopy,
]
for k in range(NRIB):
    a_ = 2.0 * math.pi * k / NSEG * 2.0
    pts, rad = [], []
    for r, z, dz in [(0.028, O_APEX - 0.030, 0.0)] + O_RINGS:
        pts.append((r * math.cos(a_), r * math.sin(a_), z + dz - 0.0036))
        rad.append(0.0024 if r < 0.11 else 0.0017)
    _parts.append(tube("umbo_rib%d" % k, pts, rad, 4, M_UMB_METAL))
for _p in _parts:
    if _p is not _canopy:
        bevel(_p, BEVEL_S, 1)
        shade(_p, False)
ITEMS["ITM09_UmbrellaOpen"] = finish("ITM09_UmbrellaOpen", _parts)

# ======================================= ITM-13 노선도 (종이)
# **이 저장소에서 텍스처를 쓰는 유일한 물건이다.** 역명을 폴리곤으로 넣으면
# 글리프 하나가 폴리곤 덩어리라 43개 역만으로 역사 전체보다 무거워진다.
# 그림은 tools/routemap_texture.py 가 실제 호선 색·노선 구조·역명으로
# 직접 그린다 — 서울교통공사 도판 파일을 굽지 않는다.
# 앞면만 인쇄면이고 뒷면·옆면은 무지 종이다. 재질을 나눠 UV 는 앞면에만 준다.
_TEX = os.path.join(_REPO_DIR, "assets", "tex", "itm13_routemap.png")
if not os.path.exists(_TEX):
    raise RuntimeError("노선도 텍스처가 없다. 먼저 tools/routemap_texture.py 를 "
                       "돌려라: %s" % _TEX)
M_MAPTEX = bpy.data.materials.new("ITM_MapPrint")
M_MAPTEX.use_nodes = True
_bsdf = next(n for n in M_MAPTEX.node_tree.nodes
             if n.bl_idname == 'ShaderNodeBsdfPrincipled')
_bsdf.inputs["Roughness"].default_value = 0.92
_bsdf.inputs["Base Color"].default_value = (0.92, 0.92, 0.90, 1.0)
_img = M_MAPTEX.node_tree.nodes.new('ShaderNodeTexImage')
_img.image = bpy.data.images.load(_TEX)
_img.image.pack()                       # GLB 에 함께 실리도록 파일을 물고 간다
_img.location = (-340, 240)
M_MAPTEX.node_tree.links.new(_bsdf.inputs["Base Color"], _img.outputs["Color"])

# 종이 비율을 텍스처(2048x1344 = 1.524)에 맞춘다. 안 맞추면 지도가 늘어난다.
MW_, MH_, MT_ = 0.082, 0.0538, 0.0014
_ring = round_rect(MW_, MH_, 0.0020, 3)
_n = len(_ring)
_vs = ([(x, -MT_ / 2.0, z) for x, z in _ring]
       + [(x, MT_ / 2.0, z) for x, z in _ring])
_fs = [tuple(range(_n))]                                            # 앞면(인쇄)
_fs += [(_n + i, _n + (i + 1) % _n, (i + 1) % _n, i) for i in range(_n)]   # 옆면
_fs.append(tuple(range(2 * _n - 1, _n - 1, -1)))                     # 뒷면
_idx = [0] + [1] * _n + [1]
_map = _mesh("map_paper", _vs, _fs, [M_MAPTEX, M_PAPER], _idx)
# UV — 앞면 루프만 종이 평면에 맞춘다. 나머지 면은 무지 재질이라 값이 무의미하다.
_uv = _map.data.uv_layers.new(name="UVMap")
for poly in _map.data.polygons:
    for li in poly.loop_indices:
        v = _map.data.vertices[_map.data.loops[li].vertex_index].co
        _uv.data[li].uv = ((v.x + MW_ / 2.0) / MW_, (v.z + MH_ / 2.0) / MH_)
shade(_map, False)
ITEMS["ITM13_RouteMap"] = finish("ITM13_RouteMap", [_map])

# ======================================= ITM-01 효자손 (기존 자산 복제)
# 새로 짜지 않는다. mc_character.blend 에 이미 있고 GP(할아버지)가 쓰는
# 물건이라 형태가 검증돼 있다 — 다만 그 파일 안에만 있어서 **어떤 GLB 로도
# 나가지 않았다.** P1 인데 게임에 도달할 경로가 없었다. 여기로 복제해 온다.
# 원본은 열지 않고 라이브러리에서 읽기만 한다 (mc_character.blend 무수정).
with bpy.data.libraries.load(os.path.join(_REPO_DIR, "assets", "mc_character.blend")) as (_src, _dst):
    if "PR_Hyojason" not in _src.objects:
        raise RuntimeError("PR_Hyojason not found in mc_character.blend")
    _dst.objects = ["PR_Hyojason"]
_hyo = next(o for o in _dst.objects if o and o.name.startswith("PR_Hyojason"))
bpy.context.collection.objects.link(_hyo)
_hyo.parent = None
_hyo.modifiers.clear()
# 라이브러리 로드는 부모 아마추어(GP_Rig)까지 딸려 온다. 씬에 남기지 않는다.
for _o in list(bpy.data.objects):
    if _o is not _hyo and _o.name not in ITEMS:
        bpy.data.objects.remove(_o, do_unlink=True)
for _a in list(bpy.data.armatures):
    bpy.data.armatures.remove(_a)
_hyo.name = "ITM01_Backscratcher"
_hyo.data.name = "ITM01_Backscratcher"
# 원본은 원점(손잡이)에서 **아래로** 뻗는다 — 손에 매달린 상태 그대로다.
# 세트의 다른 물건은 원점에서 위로 서므로 X 축 180도로 세운다. 거울이 아니라
# 회전이라 형태는 그대로다.
_hyo.matrix_world.identity()
_hyo.rotation_euler = (math.pi, 0.0, 0.0)
set_active(_hyo)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
_hyo.location = (0.0, 0.0, 0.0)
# 머티리얼은 색을 바꾸지 않고 이름만 세트 규약에 맞춘다 — 나무는 갈색이 맞다.
for _m in _hyo.data.materials:
    if _m and not _m.name.startswith("ITM_"):
        _m.name = "ITM_Wood"
shade(_hyo, False)
ITEMS["ITM01_Backscratcher"] = _hyo

# ======================================= ITM-12 편의점 진열 상품 5종
# 할아버지 선물 후보다. 플레이어는 이 다섯 중 **하나만** 골라 산다.
#
# 정답은 양갱. 나머지 넷은 오답인데, 오답에도 등급이 있다 —
#   헷갈리는 오답 (바나나우유 · 초콜릿)  단 것·부드러운 것. 따뜻한 색이라 정답과 한 무리로 보인다.
#   명확한 오답 (탄산음료 · 새우맛 과자)  초록·코랄. 색만 보고 무리에서 떨어져 나온다.
# 먼저 시끄러운 둘을 걷어내고 남은 셋에서 고민하는 2단 판단이다.
#
# 실루엣만으로 품목이 읽혀야 한다. 다섯이 전부 다른 형태 부류를 갖는다.
#   양갱      세로로 선 작은 바 · 위아래 밀봉 날개  (bar + fin)
#   바나나우유 짧고 통통한 병                       (squat bottle)
#   초콜릿    가로로 긴 얇은 바 · 양끝 밀봉 필름    (long flat bar)
#   탄산음료   길쭉한 원통 · 은색 뚜껑과 탭          (cylinder)
#   새우맛과자 세로로 긴 필로우 파우치              (puffed pouch)
#
# **포장 그림은 전부 인쇄다.** 팥알·바나나·초콜릿 조각·기포·새우 — 하나도
# 도드라진 부품이 아니다. 두께 0.26mm 에 돌출 0.12~0.24mm 로, 포장 두께의
# 1~2% 다. 옆에서 보면 보이지 않는다. 브랜드명·상표·가짜 글자는 넣지 않는다.
#
# 원점 규약 — 이 다섯만 **바닥면 중앙**이다. 매대에 세우는 물건이라 바닥이
# z=0 이라야 뜨거나 파묻히지 않는다. 손에 들릴 때는 `bone_attach` 가 월드
# 위치를 유지하므로 원점이 어디든 상관없다(카드·우산과 다른 이유가 이것).
#
# 크기는 실물 × 0.62 다. 봉지과자만 예외로 × 0.42 — 실물 비율대로면 캔의
# 두 배가 되어 다른 넷이 부스러기로 보인다. 그래도 다섯 중 가장 크다.

# === 상품별 팔레트 ===================================================
# 레퍼런스 사진에서 **색 배치**만 가져왔다. 로고·상표·글자는 쓰지 않는다.

# --- 양갱 (정답) — 금박 필름을 한쪽만 벗긴 개별 포장. 다섯 중 가장 납작하다.
M_YG_FILM = new_mat("ITM_YanggaengFilm", "C6A24E", 0.50)   # 금박 (필름 0.50)
M_YG_FILM_L = new_mat("ITM_YanggaengFilmLit", "E0C078", 0.48)  # 금박 광택면
M_YG_PAT = new_mat("ITM_YanggaengPattern", "9C7A31", 0.50)  # 문양·접힘 자국
M_YG_BEIGE = new_mat("ITM_YanggaengBeige", "E4D3A6", 0.50)  # 베이지 인쇄 구역
M_YG_BEAN = new_mat("ITM_YanggaengBean", "6B2E22", 0.52)   # 팥알 (진한 팥색)
M_YG_BODY = new_mat("ITM_YanggaengBody", "35190F", 0.64)   # 드러난 양갱 (팥 흑갈색)

# --- 바나나우유 — 원뿔로 벌어지다 중간에 턱이 있는 단지형. 뚜껑은 진초록.
M_BM = new_mat("ITM_MilkBody", "F8ECB4", 0.42)            # 바나나 크림 몸통 (플라스틱 0.42)
M_BM_LIT = new_mat("ITM_MilkLit", "FFF6CE", 0.42)         # 밝은 면
M_BM_CAP = new_mat("ITM_MilkCap", "2E4A2A", 0.42)         # 진초록 뚜껑 (플라스틱 0.42)
M_BM_GRN = new_mat("ITM_MilkAccent", "4E7A3A", 0.42)      # 초록 포인트·꼭지
M_BM_BAN = new_mat("ITM_MilkBanana", "EFBE2E", 0.42)      # 바나나 아이콘

# --- 초콜릿 — 은박을 아래만 감은 '먹기 직전' 상태. 블록 2×3.
M_CH = new_mat("ITM_ChocoBlock", "4E2E22", 0.58)          # 진한 초콜릿
M_CH_LIT = new_mat("ITM_ChocoBlockLit", "6B4231", 0.56)   # 조각 옆면
M_CH_FOIL = new_mat("ITM_ChocoFoil", "C2C8CD", 0.30)      # 은박 (금속 0.30)
M_CH_FOIL_D = new_mat("ITM_ChocoFoilShade", "8E969D", 0.30)  # 은박 접힘면

# --- 탄산음료 — 초록 캔에 흰↔초록 대각 필드 분할 + 별 포인트.
M_SD = new_mat("ITM_SodaBody", "3EA832", 0.42)            # 사이다 그린 (플라스틱 0.42)
M_SD_LIT = new_mat("ITM_SodaLit", "5CC24C", 0.40)         # 밝은 초록
M_SD_WHT = new_mat("ITM_SodaField", "F2F7EE", 0.42)       # 흰 필드
M_SD_MET = new_mat("ITM_SodaMetal", "B3BCC0", 0.30)       # 상하 림·탭 (금속 0.30)
M_SD_GUN = new_mat("ITM_SodaGunmetal", "6E7A80", 0.30)    # 탭 구멍

# --- 새우깡 — 상단 금색 띠 + 오렌지 필드 + 하단 크림 조각 더미.
M_SN = new_mat("ITM_SnackBag", "F0742C", 0.62)            # 오렌지 필드
M_SN_LIT = new_mat("ITM_SnackLit", "F9993F", 0.60)        # 밝은 오렌지
M_SN_TOP = new_mat("ITM_SnackTopBand", "D9A85A", 0.52)    # 상단 금색 띠
M_SN_SHR = new_mat("ITM_SnackShrimp", "D4381C", 0.60)     # 새우 (붉은 코랄)
M_SN_Y = new_mat("ITM_SnackLower", "F6BC3C", 0.60)        # 하단 옐로 구역
M_SN_PC = new_mat("ITM_SnackPiece", "F7E6BE", 0.64)       # 과자 조각 (크림)
M_SN_DK = new_mat("ITM_SnackShade", "B8501A", 0.60)       # 밀봉·접힘선


# --------------------------------------------------------- 도우미 2 : 회전체
def revolve(name, rings, seg, mats, row_mat=None, mat_fn=None):
    """(z, 반경) 고리를 쌓은 회전체 — `lobed` 와 달리 **행마다** 재질을 준다.

    `lobed` 는 우산살(세로 골)이 목적이라 재질이 열 단위로만 갈린다. 캔의
    은색 상하단이나 우유병 라벨 띠는 **가로 띠**라 그 함수로는 못 만든다.
    띠마다 오브젝트를 쪼개면 이음매에 안 보이는 뚜껑 면이 끼므로 여기서 낸다.
    """
    verts, faces, idx = [], [], []
    for z, r in rings:
        for k in range(seg):
            a = 2.0 * math.pi * k / seg
            verts.append((r * math.cos(a), r * math.sin(a), z))
    d = 2.0 * math.pi / seg
    for i in range(len(rings) - 1):
        mi = row_mat[i] if row_mat else 0
        zc = (rings[i][0] + rings[i + 1][0]) / 2.0
        for k in range(seg):
            a, b = i * seg + k, i * seg + (k + 1) % seg
            faces.append((a, b, b + seg, a + seg))
            # `mat_fn(u, z)` 는 **가로 띠가 아닌** 배색을 만든다. u 는 정면에서
            # 옆으로 잰 호 길이다. 캔의 대각 필드 분할처럼 세로로 기운 경계는
            # 행 단위(row_mat)로는 낼 수 없다.
            if mat_fn is None:
                idx.append(mi)
            else:
                phi = (k + 0.5) * d + math.pi / 2.0
                u = ((phi + math.pi) % (2.0 * math.pi) - math.pi) * rings[i][1]
                idx.append(mat_fn(u, zc, mi))
    faces.append(tuple(range(seg - 1, -1, -1)))              # 바닥
    idx.append(row_mat[0] if row_mat else 0)
    base = (len(rings) - 1) * seg
    faces.append(tuple(range(base, base + seg)))             # 윗면
    idx.append(row_mat[-1] if row_mat else 0)
    return _mesh(name, verts, faces, mats, idx)


# --------------------------------------------------------- 도우미 3 : 봉지
def _puff(u, v, fmin, pw, ph):
    """가운데가 부풀고 가장자리로 꺼지는 두께. `pw`·`ph` 는 **꺼지기 시작하는
    지점**이다 (0 이면 한가운데부터, 0.9 면 끝에서만).

    처음엔 (1−|x|ⁿ)^0.55 를 썼다. 이 식은 가장자리에서 기울기가 무한대라
    **마지막 한 행에서 두께가 통째로 떨어진다.** 그 행이 아래를 향한 급경사가
    되어 빛을 못 받고 밑동에 검은 사다리꼴로 보였다 — 포장이 벌어진 것처럼.
    행을 늘리고 지수를 낮춰도 소용없었다. 기울기가 발산하는 게 원인이라
    지수를 못 고른다. 스무스스텝은 양 끝에서 기울기가 0 이라 그 면이 아예
    생기지 않는다.
    """
    def S(x, x0):
        t = min(1.0, max(0.0, (abs(x) - x0) / (1.0 - x0)))
        return 1.0 - t * t * (3.0 - 2.0 * t)
    return fmin + (1.0 - fmin) * S(u, pw) * S(v, ph)


def pillow(name, w, h, d, nx, nz, mats, fmin=0.05, pw=0.30, ph=0.35, taper=0.03,
           zone=None):
    """공기 든 봉지. 가운데가 부풀고 가장자리로 갈수록 얇아지는 높이장이다.

    판(`plate`)에 베벨을 두껍게 먹여 흉내 내면 **모서리만 둥근 단단한 상자**가
    된다 — 실제로 그렇게 나왔고 도시락통·물티슈통으로 읽혔다.

    테두리를 두께 0 으로 보내지 않고 `fmin` 만큼 남긴다. 0 이면 앞뒤 정점이
    겹쳐 면적 0 인 면이 생기고, 남겨 두면 그게 그대로 **필름 접힘선**이 된다.
    접힘선(좌우 테두리)에만 mats[1] 이 붙는다 — 위아래 테두리까지 어둡게
    칠했더니 밀봉부 모서리에 검은 삼각형이 생겨 포장 불량으로 보였다.

    `pw`·`ph` 는 두께가 꺼지기 시작하는 지점이다. 0 에 가까우면 한가운데부터
    줄어 렌즈(볼록거울)가 되고 — 봉지가 아니라 쿠션이다.
    """
    hw, hh, hd = w / 2.0, h / 2.0, d / 2.0
    F, B = [], []
    for j in range(nz):
        v = -1.0 + 2.0 * j / (nz - 1)
        xs = 1.0 - taper * abs(v) ** 3.0     # 밀봉부로 갈수록 폭이 조금 준다
        for i in range(nx):
            u = -1.0 + 2.0 * i / (nx - 1)
            y = hd * _puff(u, v, fmin, pw, ph)
            F.append((u * hw * xs, -y, v * hh))
            B.append((u * hw * xs, +y, v * hh))
    n = nx * nz

    def f(i, j):
        return j * nx + i

    def b(i, j):
        return n + j * nx + i

    def _zone(u0, v0):
        """면마다 재질 인덱스. 봉지 과자는 인쇄면이 곧 봉지라 배색을 데칼로
        흉내 내면 '스티커 붙인 단색 봉지'가 된다. 면 자체가 갈려야 한다.

        `zone(u, v)` 로 받는 이유 — 상단 띠와 하단 구역이 동시에 필요하고,
        경계가 가로 직선이면 포장이 아니라 색칠한 블록으로 보인다."""
        return zone(u0, v0) if zone else 0

    faces, idx = [], []
    for j in range(nz - 1):
        v0 = -1.0 + 2.0 * j / (nz - 1)
        for i in range(nx - 1):
            u0 = -1.0 + 2.0 * i / (nx - 1)
            mi = _zone(u0, v0)
            faces.append((f(i, j), f(i + 1, j), f(i + 1, j + 1), f(i, j + 1)))
            idx.append(mi)
            faces.append((b(i, j), b(i, j + 1), b(i + 1, j + 1), b(i + 1, j)))
            idx.append(mi)
    peri = ([(i, 0) for i in range(nx)]
            + [(nx - 1, j) for j in range(1, nz)]
            + [(i, nz - 1) for i in range(nx - 2, -1, -1)]
            + [(0, j) for j in range(nz - 2, 0, -1)])
    for k in range(len(peri)):
        p, q = peri[k], peri[(k + 1) % len(peri)]
        faces.append((f(*p), b(*p), b(*q), f(*q)))
        # 좌우 세로 테두리만 접힘선. 위아래는 몸통 색이라야 밀봉부와 이어진다.
        side = p[0] in (0, nx - 1) and q[0] == p[0]
        uu = -1.0 + 2.0 * min(p[0], q[0]) / (nx - 1)
        vv = -1.0 + 2.0 * min(p[1], q[1]) / (nz - 1)
        idx.append(1 if side else _zone(uu, vv))
    return _mesh(name, F + B, faces, mats, idx)


def ground(o):
    """바닥면을 z=0 에, 가로 중심을 x=y=0 에 맞춘다. 원점은 (0,0,0) 그대로라
    **피벗이 바닥 중앙**이 된다 — 매대에 놓을 때 뜨거나 파묻히지 않는다.

    좌우 중심까지 맞추는 이유: 양갱은 필름이 한쪽만 덮여 좌우가 비대칭이라
    바닥만 맞추면 피벗이 4.6mm 치우친다. 나란히 세울 때 혼자 어긋나 보인다.
    """
    xs = [v.co.x for v in o.data.vertices]
    ys = [v.co.y for v in o.data.vertices]
    dx = (min(xs) + max(xs)) / 2.0
    dy = (min(ys) + max(ys)) / 2.0
    dz = min(v.co.z for v in o.data.vertices)
    for v in o.data.vertices:
        v.co.x -= dx
        v.co.y -= dy
        v.co.z -= dz
    return o


# ------------------------------------------------- 도우미 4 : 인쇄(데칼)
# 포장 그림을 **표면 위에 얹은 부품**으로 만들면 장난감 블록에 장식을 붙인
# 꼴이 된다. 인쇄는 두께가 없어야 한다 — 그런데 두께를 0 으로 두면 면이
# 겹쳐 깜빡이므로, 보이지 않을 만큼만 남긴다.
PRINT_T = 0.00026        # 인쇄층 두께 0.26mm
PRINT_LIFT = 0.00012     # 층당 돌출 0.12mm (2층이면 0.24mm)


def _densify(ring, step):
    """긴 변을 잘게 나눈다. **곡면에 앉히기 전에** 해야 한다.

    양 끝점만 표면에 올려 두면 그 사이를 잇는 직선이 표면 안으로 파고들어
    가운데가 잘려 보인다 — 실측: 캔 뒷면 정보 바가 양끝만 남고 「‹ ›」로
    쪼개졌다. 라운드 사각형은 긴 변이 한 조각이라 특히 잘 걸린다.
    """
    out = []
    for i in range(len(ring)):
        a, b = ring[i], ring[(i + 1) % len(ring)]
        out.append(a)
        k = int(math.hypot(b[0] - a[0], b[1] - a[1]) / step)
        for j in range(1, k + 1):
            f = j / float(k + 1)
            out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
    return out


def decal(name, ring, place, mat, layer=0, step=None, subdiv=1):
    """포장에 인쇄된 그림. 평면이든 곡면이든 **표면을 따라** 앉는다.

    평평한 판을 곡면에 붙이면 가운데가 파묻히고 양끝이 뜬다. 두껍게 만들어
    피할 수 있지만 그 순간 인쇄가 아니라 붙인 장식물이 된다. 그래서 그림
    자체가 곡면을 따르게 한다 — `place(u, z, lift)` 가 그 자리의 표면 좌표를 준다.

    `layer` 0 은 바탕(라벨판), 1 은 그 위에 얹는 아이콘이다. 1 층의 뒷면은
    0 층 안에 묻히므로 두 층이 겹쳐 보이지 않는다.

    `subdiv` 는 **안쪽**을 몇 겹으로 나눌지다. 외곽선만 표면에 올리면 안쪽이
    한 장의 평면이라 가운데가 표면 아래로 파고들어 **테두리만 남는다**
    (실측: 봉지 크림 라벨이 액자처럼 테두리만 보였다). 넓은 라벨은 3~4 를 준다.
    평면 포장에서는 1 이 정확하고 가장 싸다.
    """
    lift = PRINT_LIFT * (layer + 1)
    if step:
        ring = _densify(ring, step)
    n = len(ring)
    cu = sum(p[0] for p in ring) / n
    cz = sum(p[1] for p in ring) / n
    shells = [[(cu + (u - cu) * (1.0 - j / float(subdiv)),
                cz + (z - cz) * (1.0 - j / float(subdiv))) for u, z in ring]
              for j in range(subdiv)]
    F = [place(u, z, lift) for sh in shells for u, z in sh]
    F.append(place(cu, cz, lift))
    B = [place(u, z, lift - PRINT_T) for sh in shells for u, z in sh]
    B.append(place(cu, cz, lift - PRINT_T))
    nf = len(F)

    def fi(j, i):
        return j * n + i % n

    def bi(j, i):
        return nf + j * n + i % n

    faces = []
    for j in range(subdiv - 1):                       # 껍질 사이 띠
        for i in range(n):
            faces.append((fi(j, i), fi(j, i + 1), fi(j + 1, i + 1), fi(j + 1, i)))
            faces.append((bi(j + 1, i), bi(j + 1, i + 1), bi(j, i + 1), bi(j, i)))
    for i in range(n):                                # 가장 안쪽 부채꼴
        faces.append((fi(subdiv - 1, i), fi(subdiv - 1, i + 1), nf - 1))
        faces.append((bi(subdiv - 1, i + 1), bi(subdiv - 1, i), nf + nf - 1))
    for i in range(n):                                # 테두리
        faces.append((bi(0, i), bi(0, i + 1), fi(0, i + 1), fi(0, i)))
    return _mesh(name, F + B, faces, mat)


def flat_place(y0):
    """평면 포장 앞면. `y0` 이 그 면의 y 다."""
    def p(u, z, lift):
        return (u, y0 - lift, z)
    return p


def flat_back(y0):
    """평면 포장 **뒷면**. 바깥이 +y 라 밀어내는 방향이 앞면과 반대다.
    외곽선도 뒤집어 넘겨야 한다 — 그대로 두면 법선이 안쪽을 본다."""
    def p(u, z, lift):
        return (u, y0 + lift, z)
    return p


def _poly_r(R, seg, phi):
    """정 seg 각형 단면에서 방향 `phi` 쪽 표면까지 거리.

    회전체는 원기둥이 아니라 각기둥이다. 원 반경으로 그림을 앉히면 **면
    한가운데에서 0.5mm 뜬다** — 돌출 0.12mm 짜리 인쇄에는 치명적이다.
    """
    d = 2.0 * math.pi / seg
    c = (math.floor(phi / d) + 0.5) * d          # 그 방향이 속한 면의 중심각
    return R * math.cos(math.pi / seg) / math.cos(phi - c)


def _ring_r(rings, z):
    for i in range(len(rings) - 1):
        z0, r0 = rings[i]
        z1, r1 = rings[i + 1]
        if z0 <= z <= z1 and z1 > z0:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return rings[-1][1]


def body_place(rings, seg, back=False):
    """회전체 표면. `u` 는 정면(-y)에서 옆으로 잰 **호 길이**다.

    `back=True` 면 뒷면(+y)에 앉힌다. 이때 u 가 커질수록 x 가 줄어 좌우가
    뒤집히므로, 외곽선도 뒤집어 넘겨야 법선이 바깥을 본다.
    """
    base = math.pi / 2.0 if back else -math.pi / 2.0
    def p(u, z, lift):
        R = _ring_r(rings, z)
        phi = base + u / R
        r = _poly_r(R, seg, phi) + lift
        return (r * math.cos(phi), r * math.sin(phi), z)
    return p


def _rr(w, h, r, seg=3, cx=0.0, cz=0.0, rot=0.0):
    ring = round_rect(w, h, r, seg)
    if rot:
        c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        ring = [(x * c - z * s, x * s + z * c) for x, z in ring]
    return [(x + cx, z + cz) for x, z in ring]


def _circ(d, cx=0.0, cz=0.0, seg=9):
    return [(cx + d / 2.0 * math.cos(2.0 * math.pi * k / seg),
             cz + d / 2.0 * math.sin(2.0 * math.pi * k / seg)) for k in range(seg)]


def _spin(ring, deg, cx=0.0, cz=0.0):
    """외곽선을 (cx, cz) 둘레로 돌린다. **좌우 대칭 도형은 얼굴 부품으로
    읽힌다** — 아치는 눈썹, 그 아래 두 점은 눈이 된다. 기울이면 그 해석이 깨진다."""
    c, sn = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return [(cx + (x - cx) * c - (z - cz) * sn,
             cz + (x - cx) * sn + (z - cz) * c) for x, z in ring]


def _center(ring, cx=0.0, cz=0.0):
    """외곽선의 바운딩 박스 중심을 (cx, cz) 로 옮긴다.

    `_spin` 은 지정한 점 둘레로 돌리므로 도형의 무게중심이 함께 이동한다 —
    라벨 한가운데 두려고 만든 아이콘이 모서리로 밀려난다(실측: 새우가 라벨
    밖으로, 바나나가 병 왼쪽으로 나갔다). 돌린 다음 다시 앉힌다.
    """
    xs = [p[0] for p in ring]
    zs = [p[1] for p in ring]
    dx = cx - (min(xs) + max(xs)) / 2.0
    dz = cz - (min(zs) + max(zs)) / 2.0
    return [(x + dx, z + dz) for x, z in ring]


def _edges(pt, hw, n=7):
    """중심선 + 폭 → 위·아래 두 모서리. `decal_strip` 에 그대로 넘긴다."""
    lo, up = [], []
    for i in range(n):
        t = -1.0 + 2.0 * i / (n - 1)
        x, z = pt(t)
        x1, z1 = pt(min(t + 0.02, 1.0))
        x0, z0 = pt(max(t - 0.02, -1.0))
        dx, dz = x1 - x0, z1 - z0
        L = math.hypot(dx, dz) or 1.0
        nx, nz = -dz / L, dx / L
        w = hw(t)
        up.append((x + nx * w, z + nz * w))
        lo.append((x - nx * w, z - nz * w))
    return lo, up


def _refine(lo, up, step):
    """스트립의 두 모서리를 나란히 잘게 나눈다.

    각기둥 표면에서는 표본 간격이 **면 폭보다 작아도** 부족하다. 모서리를
    건너뛰는 쿼드 하나가 생기면 그 면의 중심이 현 위에 얹혀 표면 위로
    0.013mm 밖에 안 뜬다(실측). 돌출이 0.24mm 인데 그 한 장만 사실상 표면과
    같은 높이가 되어 깜빡이고, 렌더에서는 **인쇄에 뚫린 구멍**으로 보인다.
    """
    L, U = [], []
    for i in range(len(lo) - 1):
        d = max(math.hypot(lo[i + 1][0] - lo[i][0], lo[i + 1][1] - lo[i][1]),
                math.hypot(up[i + 1][0] - up[i][0], up[i + 1][1] - up[i][1]))
        k = max(1, int(math.ceil(d / step)))
        for j in range(k):
            f = j / float(k)
            L.append((lo[i][0] + (lo[i + 1][0] - lo[i][0]) * f,
                      lo[i][1] + (lo[i + 1][1] - lo[i][1]) * f))
            U.append((up[i][0] + (up[i + 1][0] - up[i][0]) * f,
                      up[i][1] + (up[i + 1][1] - up[i][1]) * f))
    L.append(lo[-1])
    U.append(up[-1])
    return L, U


def decal_strip(name, lo, up, place, mat, layer=0, step=None, lift=None,
                cross=1):
    """굽은 띠 모양 인쇄 — 바나나·새우·과자 조각.

    `decal` 로는 안 된다. 굽은 리본의 외곽선은 **강하게 오목한 다각형**이라
    n각형 한 장으로 두면 삼각분할이 깨져 나비넥타이가 나온다(실측: 바나나가
    ⋈ 로 찢어졌다). 자기 교차는 없었다 — 외곽선은 멀쩡한데 면 나누기가 틀린 것이다.
    위·아래 모서리를 쿼드로 잇는 스트립은 그 위험이 아예 없다.

    `step` 은 **길이 방향**, `cross` 는 **폭 방향** 분할이다. 길이만 잘게 나눴을
    때 바나나 한가운데에 노란 세로줄이 그어졌다 — 폭이 3.8mm 한 조각이라 그
    변이 각기둥 모서리를 통째로 건너뛰고, 그 자리에서 면이 표면 아래로 잠긴
    것이다. 곡면에 앉히는 띠는 두 방향 다 나눠야 한다.
    """
    lift = PRINT_LIFT * (layer + 1) if lift is None else lift
    if step:
        lo, up = _refine(lo, up, step)
    m = len(lo)
    rows = []
    for j in range(cross + 1):
        t = j / float(cross)
        rows.append([(lo[i][0] + (up[i][0] - lo[i][0]) * t,
                      lo[i][1] + (up[i][1] - lo[i][1]) * t) for i in range(m)])
    F = [place(u, z, lift) for r in rows for u, z in r]
    B = [place(u, z, lift - PRINT_T) for r in rows for u, z in r]
    nf = len(F)

    def fi(j, i):
        return j * m + i

    def bi(j, i):
        return nf + j * m + i

    faces = []
    for j in range(cross):
        for i in range(m - 1):
            faces.append((fi(j, i), fi(j, i + 1), fi(j + 1, i + 1), fi(j + 1, i)))
            faces.append((bi(j, i + 1), bi(j, i), bi(j + 1, i), bi(j + 1, i + 1)))
    for i in range(m - 1):                                   # 바깥·안쪽 모서리
        faces.append((fi(cross, i), fi(cross, i + 1),
                      bi(cross, i + 1), bi(cross, i)))
        faces.append((fi(0, i), bi(0, i), bi(0, i + 1), fi(0, i + 1)))
    for j in range(cross):                                   # 양 끝단
        faces.append((fi(j, 0), fi(j + 1, 0), bi(j + 1, 0), bi(j, 0)))
        faces.append((fi(j, m - 1), bi(j, m - 1),
                      bi(j + 1, m - 1), fi(j + 1, m - 1)))
    return _mesh(name, F + B, faces, mat)


def _ribbon(pt, hw, n=7):
    """중심선 + 폭 함수 → 닫힌 외곽선.

    바나나·새우처럼 '가운데가 굵고 양끝이 뾰족한' 그림은 폭이 일정한 호로는
    안 나온다 — 그렇게 만들면 갈고리나 웃는 입으로 읽힌다.
    """
    lo, up = [], []
    for i in range(n):
        t = -1.0 + 2.0 * i / (n - 1)
        x, z = pt(t)
        x1, z1 = pt(min(t + 0.02, 1.0))
        x0, z0 = pt(max(t - 0.02, -1.0))
        dx, dz = x1 - x0, z1 - z0
        L = math.hypot(dx, dz) or 1.0
        nx, nz = -dz / L, dx / L
        w = hw(t)
        up.append((x + nx * w, z + nz * w))
        lo.append((x - nx * w, z - nz * w))
    return lo + up[::-1]


# ---------------------------------------------------- 양갱 (정답) · 금박 필름
# 두 덩어리를 이어 붙인 것처럼 보이던 원인은 **속과 포장의 단면이 같아서**였다.
# 실물은 필름이 바를 감싸므로 포장부가 조금 더 굵고, 드러난 속은 그보다 얇다.
# 전체 두께도 11 → 8mm 로 낮춰 '두꺼운 플라스틱 케이스' 인상을 지운다.
YG_L, YG_H, YG_D = 0.090, 0.019, 0.008
YG_CUT = 0.0300                      # 필름이 끝나는 x. 오른쪽 17% 만 드러난다
# 필름 벽 두께 0.25mm — 이전 0.55mm 의 절반 이하다. **벽이 두꺼울수록 필름 끝의
# 턱이 커지고, 그 턱 하나가 '금색 케이스 뒤에 갈색 블록을 붙인 것'으로 읽히게
# 만든다.** 얇을수록 속과 겉이 이어져 보인다.
_p = [plate("yg_body", YG_L, YG_H - 0.0005, 0.0018, YG_D - 0.0005, M_YG_BODY,
            seg=3)]
bevel(_p[0], 0.0007, 3)              # 젤리 바라 모서리가 부드럽다
# 금박 필름 — 모서리 반경 1.2mm · 얕은 베벨. 반경이 크고 베벨이 깊으면 얇게
# 만들어도 사출로 찍은 셸로 보인다. 필름은 두께가 아니라 **면이 평평하고
# 모서리가 날카롭다**는 사실로 읽힌다.
_FW = (YG_L / 2.0 + 0.0005) + YG_CUT
_p.append(plate("yg_film", _FW, YG_H, 0.0012, YG_D, M_YG_FILM, seg=3,
                cx=YG_CUT - _FW / 2.0, edge_mat=M_YG_FILM_L))
bevel(_p[-1], 0.0003, 2)
# 접힌 밀봉 끝 — 넓고 0.35mm 로 얇게. 두 겹으로 나눠 바깥쪽을 더 얇게 하면
# 눌러 접은 필름처럼 보인다. 좁고 두꺼우면 캡·기계 부품이다.
_FX = -(YG_L / 2.0 + 0.0005)
_p.append(plate("yg_seal", 0.0110, YG_H * 0.74, 0.0008, 0.00030, M_YG_FILM,
                seg=2, cx=_FX - 0.0053, edge_mat=M_YG_FILM_L))
# 인쇄 — **왼쪽 절반의 베이지 판 하나.** 길이를 가로지르는 가는 띠는 인쇄가
# 아니라 파인 홈으로 읽혔다. 구역을 나누는 넓은 색면이라야 인쇄로 보인다.
_p.append(decal("yg_beige", _rr(_FW * 0.52, YG_H * 0.44, 0.0014, 3,
                                cx=YG_CUT - _FW / 2.0 - _FW * 0.16),
                flat_place(-YG_D / 2.0), M_YG_BEIGE))
for _i, (_bx, _br) in enumerate(((-0.0088, -24.0), (0.0000, 12.0),
                                 (0.0088, -34.0))):
    _p.append(decal("yg_bean%d" % _i,
                    _rr(0.0044, 0.0026, 0.0013, 2,
                        cx=YG_CUT - _FW / 2.0 - _FW * 0.16 + _bx, rot=_br),
                    flat_place(-YG_D / 2.0), M_YG_BEAN, layer=1))
for _o in _p:
    shade(_o, False)
ITEMS["ITM12_Yanggaeng"] = ground(finish("ITM12_Yanggaeng", _p))

# ------------------------------------------ 바나나우유 · 플라스틱 단지 용기
# 도자기 단지로 읽히던 원인은 **아래가 위만큼 굵고 배가 부풀어서**였다.
# 실물은 아래 통이 오히려 조금 좁고, 턱 위로 부드럽게 원뿔이 서며, 바닥이
# 평평하다. 그 셋을 맞추면 도자기가 아니라 플라스틱 음료 용기가 된다.
BM_SEG = 18
# **턱(돌출 링)을 없앴다.** 지름이 튀는 고리 하나가 용기를 위아래 두 부품으로
# 갈라 보이게 만든 원인이었다. 바닥에서 목까지 반경이 단조롭게만 변하는
# 연속 곡면으로 다시 잡고, 초록은 지오메트리가 아니라 **인쇄 띠**로만 남긴다.
BM_RINGS = [(0.0000, 0.0158), (0.0016, 0.0180), (0.0042, 0.0194),
            (0.0090, 0.0201),
            (0.0180, 0.0206), (0.0260, 0.0207), (0.0330, 0.0202),
            (0.0390, 0.0190), (0.0450, 0.0170), (0.0505, 0.0144),
            (0.0550, 0.0116), (0.0578, 0.0100)]
#             바닥 ─── 배 ───┬── 초록 인쇄 띠 ──┬── 어깨 ── 목(밝은 면)
_rows = [0, 0, 0, 0, 0, 3, 3, 3, 0, 1, 1]
_p = [revolve("bm_body", BM_RINGS, BM_SEG,
              [M_BM, M_BM_LIT, M_BM_CAP, M_BM_GRN], _rows)]
_p.append(revolve("bm_cap", [(0.0578, 0.0103), (0.0588, 0.0118),
                             (0.0618, 0.0116), (0.0626, 0.0108)],
                  BM_SEG, M_BM_CAP))
_BMP = body_place(BM_RINGS, BM_SEG)
# 바나나 — 초록 라벨 아래, 턱 바로 위. 인쇄 그래픽이라 돌출 0.20mm.
_BAN_R, _BAN_CZ, _BAN_A, _BAN_T = 0.0056, 0.0358, 1.32, -30.0
_blo, _bup = _edges(
    lambda t: (_BAN_R * math.sin(t * _BAN_A), _BAN_R * math.cos(t * _BAN_A)),
    lambda t: 0.0018 * max(0.10, 1.0 - 0.90 * ((t - 0.15) / 1.15) ** 2), 15)
_bc, _bs = math.cos(math.radians(_BAN_T)), math.sin(math.radians(_BAN_T))
_blo = [(x * _bc - z * _bs, x * _bs + z * _bc) for x, z in _blo]
_bup = [(x * _bc - z * _bs, x * _bs + z * _bc) for x, z in _bup]
_bxs = [q[0] for q in _blo + _bup]
_bzs = [q[1] for q in _blo + _bup]
_bdx = -(min(_bxs) + max(_bxs)) / 2.0
_bdz = _BAN_CZ - (min(_bzs) + max(_bzs)) / 2.0
_blo = [(x + _bdx, z + _bdz) for x, z in _blo]
_bup = [(x + _bdx, z + _bdz) for x, z in _bup]
_p.append(decal_strip("bm_banana", _blo, _bup, _BMP, M_BM_BAN, layer=1,
                      step=0.0019, lift=0.00020, cross=3))
_btx, _btz = _BAN_R * math.sin(_BAN_A), _BAN_R * math.cos(_BAN_A)
_bt = (_btx * _bc - _btz * _bs + _bdx, _btx * _bs + _btz * _bc + _bdz)
_p.append(decal("bm_stem", _rr(0.0030, 0.0017, 0.0007, 1, cx=_bt[0] + 0.0011,
                               cz=_bt[1] + 0.0008, rot=-32.0),
                _BMP, M_BM_GRN, layer=1, step=0.0007))
for _o in _p:
    shade(_o, False)
ITEMS["ITM12_BananaMilk"] = ground(finish("ITM12_BananaMilk", _p))

# --------------------------------------- 초콜릿 · 은박에서 반쯤 꺼낸 판
# 조각을 낱개 판으로 세워 놨더니 **벽돌담**이 됐고, 은박은 직육면체라
# **받침대**가 됐다. 실물은 판 하나에 홈이 파여 여섯으로 갈린 것이고,
# 포일은 그 판을 감싸며 윗변에서 바깥으로 접혀 있다.
CH_W, CH_H, CH_D = 0.092, 0.054, 0.011
CH_COL, CH_ROW = 3, 2
CH_TEAR = -0.0152                    # 포일이 끝나는 x. 오른쪽 짧은 끝이 뜯겼다
_p = [plate("ch_bar", CH_W, CH_H, 0.0024, CH_D, M_CH, seg=2,
            edge_mat=M_CH_LIT)]
bevel(_p[0], 0.0008, 1)
# 조각 여섯 — 판 위로 0.8mm 솟은 칸. 사이 간격이 그대로 **쪼개는 홈**이 된다.
# 낱개로 떼어 놓지 않았으므로 '한 판에서 갈린 것'으로 읽힌다.
_CW = (CH_W - 0.0060 - 0.0022 * (CH_COL - 1)) / CH_COL
_CHH = (CH_H - 0.0050 - 0.0022 * (CH_ROW - 1)) / CH_ROW
_BLK = []
for _r in range(CH_ROW):
    for _c in range(CH_COL):
        _cx = -CH_W / 2.0 + 0.0030 + _CW / 2.0 + (_CW + 0.0022) * _c
        _cz = -CH_H / 2.0 + 0.0025 + _CHH / 2.0 + (_CHH + 0.0022) * _r
        _BLK.append((_cx, _cz, _c))
        _b = plate("ch_blk%d%d" % (_r, _c), _CW, _CHH, 0.0016, CH_D + 0.0016,
                   M_CH, seg=1, cx=_cx, cz=_cz, edge_mat=M_CH_LIT)
        bevel(_b, 0.0006, 1)         # 약한 베벨 — 각지면 장난감 블록이다
        _p.append(_b)
# 은박 — **좁은 쪽 끝에서 뜯긴다.** 넓은 아래쪽을 통째로 벗겨 놨더니 포일이
# 바를 감싼 게 아니라 **회색 받침대 위에 초콜릿을 올려 놓은 것**이 됐다.
# 실물은 짧은 끝을 조금 까서 먹는다. 포일이 몸통 대부분을 덮고, 오른쪽
# 짧은 끝에서만 초콜릿이 드러난다.
CH_FD = CH_D + 0.0028
_FL = CH_W / 2.0 + 0.0008 + CH_TEAR          # 덮는 길이
_p.append(plate("ch_foil", _FL, CH_H + 0.0012, 0.0022, CH_FD, M_CH_FOIL,
                seg=2, cx=CH_TEAR - _FL / 2.0, edge_mat=M_CH_FOIL_D))
bevel(_p[-1], 0.0006, 1)
# 포일 위로 비치는 조각 자국 — 실물도 포일이 칸을 따라 눌려 격자가 보인다.
# 이게 있어야 '초콜릿을 감싼 포일'이지, 은색 판을 덧댄 것이 아니다.
for _cx, _cz, _c in _BLK:
    if _cx > CH_TEAR:                        # 뜯긴 쪽 조각은 맨살이다
        continue
    _f = plate("ch_fblk%d%d" % (int(_cz * 1e5), _c), _CW + 0.0010,
               _CHH + 0.0010, 0.0018, CH_FD + 0.0016, M_CH_FOIL, seg=1,
               cx=_cx, cz=_cz, edge_mat=M_CH_FOIL_D)
    bevel(_f, 0.0006, 1)
    _p.append(_f)
# 뜯긴 경계 — 완전한 직선이 아니라 세 단으로 어긋난다. 본판과 겹치게 덧붙여
# 조각 사이에 틈이 생기지 않게 한다.
for _i, (_tz, _th, _tw) in enumerate(((-0.0170, 0.0170, 0.0034),
                                      (0.0010, 0.0180, 0.0022),
                                      (0.0180, 0.0160, 0.0040))):
    _p.append(plate("ch_tear%d" % _i, _tw, _th, 0.0008, CH_FD, M_CH_FOIL,
                    seg=1, cx=CH_TEAR + _tw / 2.0 - 0.0006, cz=_tz,
                    edge_mat=M_CH_FOIL_D))
# 접힘면 둘 — 넓고 얕게. 셋 이상 고르게 늘어놓으면 반복 무늬가 된다.
for _i, (_fx, _fz, _fw, _fh) in enumerate(((-0.0398, 0.0062, 0.0036, 0.0250),
                                           (-0.0250, -0.0142, 0.0030, 0.0170))):
    _p.append(slab("ch_fold%d" % _i, (_fx, 0.0, _fz),
                   (_fw, CH_FD + 0.0030, _fh), M_CH_FOIL_D))
for _o in _p:
    shade(_o, False)
ITEMS["ITM12_Chocolate"] = ground(finish("ITM12_Chocolate", _p))

# ------------------------------------------- 탄산음료 · 대각 리본 초록 캔
# 필드 분할은 정면에서 **세로 띠**로 보여 레퍼런스의 경쾌함이 사라졌다.
# 굵은 대각 리본으로 되돌리되 폭을 14mm 로 키우고 기울기를 세워, 캔을
# 비스듬히 감아 도는 흐름이 정면에서 한눈에 보이게 한다.
SD_SEG = 18
SD_R = 0.0170
SD_RINGS = [(0.0000, 0.0132), (0.0026, 0.0164), (0.0056, SD_R),
            (0.0668, SD_R), (0.0730, 0.0154), (0.0788, 0.0127),
            (0.0808, 0.0121), (0.0822, 0.0125)]
#           은 ─ 얇은 림 ── 초록 몸통 ── 어깨 ─ 어깨 ─ 은 ─ 림
_rows = [2, 2, 0, 1, 1, 2, 2]
_p = [revolve("sd_body", SD_RINGS, SD_SEG, [M_SD, M_SD_LIT, M_SD_MET], _rows)]
# 뚜껑 — 오목한 면 + 따는 홈 + 고리 + 구멍 + 리벳. 다섯이 다 있어야
# '따서 마시는 뚜껑'으로 읽힌다. 판 하나만 얹으면 뭔가 붙은 수준에 머문다.
_p.append(revolve("sd_lid", [(0.0822, 0.0122), (0.0828, 0.0116)],
                  SD_SEG, M_SD_GUN))
_p.append(slab("sd_score", (-0.0086, 0.0, 0.0827), (0.0092, 0.0104, 0.0008),
               M_SD_GUN))
_p.append(slab("sd_tab", (0.0034, 0.0, 0.0831), (0.0142, 0.0052, 0.0013),
               M_SD_MET))
_p.append(slab("sd_tab_hole", (0.0062, 0.0, 0.0837), (0.0066, 0.0026, 0.0010),
               M_SD_GUN))
_p.append(slab("sd_rivet", (-0.0036, 0.0, 0.0836), (0.0042, 0.0042, 0.0015),
               M_SD_MET))
_SDP = body_place(SD_RINGS, SD_SEG)
# 리본 — 한 바퀴 반을 감는다. 정면에서 사선 하나가 통째로 보이도록 기울기를
# 세웠다. 양끝은 좁혀 두어 끊긴 자리가 눈에 걸리지 않게 한다.
_RB = math.pi * SD_R * 1.00
# 한 바퀴를 다 감아 끊긴 자리가 정면에 걸리지 않게 한다. 양끝 폭을 좁혀
# 시작과 끝이 뒤에서 자연스럽게 만난다.
_rlo, _rup = _edges(lambda t: (t * _RB, 0.0380 + t * 0.0250),
                    lambda t: 0.0070 * max(0.22, 1.0 - 0.74 * t * t), 19)
_p.append(decal_strip("sd_ribbon", _rlo, _rup, _SDP, M_SD_WHT, layer=1,
                      step=0.0038, lift=0.00020, cross=2))
# 기포 — 리본 위 초록 면에서 올라간다. 별은 뺐다.
for _i, (_bx, _bz, _bd) in enumerate((
        (-0.0040, 0.0596, 0.0034), (0.0026, 0.0644, 0.0026),
        (0.0072, 0.0568, 0.0021))):
    _p.append(decal("sd_bub%d" % _i, _circ(_bd, cx=_bx, cz=_bz),
                    _SDP, M_SD_WHT, layer=1, step=0.0007))
for _o in _p:
    shade(_o, False)
ITEMS["ITM12_Soda"] = ground(finish("ITM12_Soda", _p))

# --------------------------------- 새우깡 · 금색 띠 + 오렌지/옐로 + 조각 더미
# 레이아웃을 실물처럼 3단으로 되돌린다 — **상단 금색 띠 / 오렌지 필드에 큰
# 붉은 새우 / 옐로 바닥에 쌓인 스낵 조각**. 조각은 길고 얇은 초승달이 아니라
# **짧고 통통한 곡선 스틱**이라야 과자로 보인다(앞선 판은 물결 무늬였다).
SN_W, SN_H, SN_D = 0.070, 0.098, 0.0420
SN_FMIN, SN_PW, SN_PH, SN_TAPER = 0.36, 0.58, 0.48, 0.012


def SN_ZONE(u, v):
    """상단 금색 띠(2) / 오렌지 필드(0) / 하단 옐로(3). 경계를 살짝 기울여
    자로 그은 직선처럼 보이지 않게 한다."""
    if v > 0.80:
        return 2
    return 3 if v < -0.26 - 0.05 * u else 0


_p = [pillow("sn_body", SN_W, SN_H, SN_D, 11, 11,
             [M_SN, M_SN_DK, M_SN_TOP, M_SN_Y],
             SN_FMIN, SN_PW, SN_PH, SN_TAPER, zone=SN_ZONE)]


def _sn_place(u, z, lift):
    v = max(-1.0, min(1.0, z / (SN_H / 2.0)))
    xs = 1.0 - SN_TAPER * abs(v) ** 3.0
    uu = max(-1.0, min(1.0, u / (SN_W / 2.0 * xs)))
    y = (SN_D / 2.0) * _puff(uu, v, SN_FMIN, SN_PW, SN_PH)
    return (u, -y - lift, z)


for _s in (-1, 1):
    _p.append(plate("sn_seal%d" % (_s > 0), SN_W * 0.90, 0.0058, 0.0010, 0.0012,
                    M_SN_TOP if _s > 0 else M_SN_Y, seg=1,
                    cz=_s * (SN_H / 2.0 + 0.0005)))
    for _i in range(5):
        _p.append(slab("sn_crimp%d%d" % (_s > 0, _i),
                       (-0.0230 + 0.0115 * _i, 0.0, _s * (SN_H / 2.0 + 0.0005)),
                       (0.0007, 0.0012, 0.0022), M_SN_DK))
# 새우 — 오렌지 필드를 가득 채운다. 머리 · 마디 있는 굽은 몸통 · 부채꼴 꼬리.
_SHR_R, _SHR_CZ, _SHR_A = 0.0156, 0.0074, -32.0


def _shr_pt(t):
    a = math.radians(_SHR_A)
    x, z = _SHR_R * math.sin(t * 1.14), _SHR_R * math.cos(t * 1.14)
    return (x * math.cos(a) - z * math.sin(a) + _SHR_DX,
            x * math.sin(a) + z * math.cos(a) + _SHR_DZ)


_SHR_DX, _SHR_DZ = 0.0, 0.0
_slo, _sup = _edges(_shr_pt,
                    lambda t: 0.0046 * max(0.28, 1.0 - 0.66
                                           * ((t + 0.55) / 1.55) ** 2), 15)
_sxs = [q[0] for q in _slo + _sup]
_szs = [q[1] for q in _slo + _sup]
_SHR_DX = -0.0014 - (min(_sxs) + max(_sxs)) / 2.0
_SHR_DZ = 0.0166 - (min(_szs) + max(_szs)) / 2.0
_slo = [(x + _SHR_DX, z + _SHR_DZ) for x, z in _slo]
_sup = [(x + _SHR_DX, z + _SHR_DZ) for x, z in _sup]
_p.append(decal_strip("sn_shr_body", _slo, _sup, _sn_place, M_SN_SHR, layer=1,
                      step=0.0034, cross=2))
for _i, _mt in enumerate((-0.36, -0.02, 0.32)):
    _m0, _m1, _mc = _shr_pt(_mt - 0.03), _shr_pt(_mt + 0.03), _shr_pt(_mt)
    _p.append(decal("sn_shr_seg%d" % _i,
                    _rr(0.0012, 0.0084, 0.00052, 1, cx=_mc[0], cz=_mc[1],
                        rot=math.degrees(math.atan2(_m1[1] - _m0[1],
                                                    _m1[0] - _m0[0]))),
                    _sn_place, M_SN_DK, layer=2, step=0.0040))
_hx, _hz = _shr_pt(-1.0)
_p.append(decal("sn_shr_head", _rr(0.0128, 0.0092, 0.0040, 2,
                                   cx=_hx - 0.0013, cz=_hz + 0.0019, rot=26.0),
                _sn_place, M_SN_SHR, layer=1, step=0.0060))
_tx, _tz = _shr_pt(1.0)
_ta0, _ta1 = _shr_pt(0.92), _shr_pt(1.0)
_tdx, _tdz = _ta1[0] - _ta0[0], _ta1[1] - _ta0[1]
_tn = math.hypot(_tdx, _tdz) or 1.0
_tdx, _tdz = _tdx / _tn, _tdz / _tn
_tlo, _tup = _edges(lambda t, L=0.0060: (_tx + _tdx * L * (t + 1.0),
                                         _tz + _tdz * L * (t + 1.0)),
                    lambda t: 0.0014 + 0.0054 * (t + 1.0) / 2.0, 5)
_p.append(decal_strip("sn_shr_tail", _tlo, _tup, _sn_place, M_SN_SHR,
                      layer=1, step=0.0050, cross=2))
# 스낵 조각 — 열 개를 흩었더니 국수 가락·뼈다귀로 읽혔다. **넷만 크게** 두고
# 각각에 얕은 세로 홈 셋을 넣는다. 새우맛 스낵의 정체는 굽은 막대가 아니라
# 그 위의 골이라, 홈이 없으면 무엇이든 될 수 있는 곡선일 뿐이다.
for _i, (_cx, _cz, _cl, _cw, _cd) in enumerate((
        (-0.0186, -0.0248, 0.0082, 0.0096, -14.0),
        (0.0000, -0.0248, 0.0086, 0.0100, 8.0),
        (0.0186, -0.0248, 0.0082, 0.0096, -20.0))):
    _cc, _cs = math.cos(math.radians(_cd)), math.sin(math.radians(_cd))

    def _put(x, z, cc=_cc, cs=_cs, ox=_cx, oz=_cz):
        return (x * cc - z * cs + ox, x * cs + z * cc + oz)

    _clo, _cup = _edges(lambda t, L=_cl: (t * L, 0.0030 * (t * t - 0.5)),
                        lambda t, W=_cw: W / 2.0 * (1.0 - 0.14 * abs(t) ** 3.0),
                        9)
    _p.append(decal_strip("sn_pc%d" % _i,
                          [_put(x, z) for x, z in _clo],
                          [_put(x, z) for x, z in _cup],
                          _sn_place, M_SN_PC, layer=1, step=0.0055, cross=1))
    for _k, _gt in enumerate((-0.44, 0.0, 0.44)):
        _gx, _gz = _gt * _cl, 0.0030 * (_gt * _gt - 0.5)
        _p.append(decal("sn_pcg%d%d" % (_i, _k),
                        _rr(0.0007, _cw * 0.70, 0.00030, 1,
                            cx=_put(_gx, _gz)[0], cz=_put(_gx, _gz)[1],
                            rot=_cd + math.degrees(math.atan2(
                                0.0060 * _gt, 1.0))),
                        _sn_place, M_SN_DK, layer=2, step=0.0040))
for _o in _p:
    shade(_o, False)
shade(_p[0], True)          # 몸통만 부드럽게 — 밑동 명암 띠를 없애는 열쇠다
ITEMS["ITM12_SnackBag"] = ground(finish("ITM12_SnackBag", _p))

# ======================================= 물품보관소 (독립형 모듈 · 가구)
# 배치 존과 상호작용은 아직 정해지지 않았다. 어느 구역에도 놓을 수 있는
# **모듈 한 칸**으로 만든다 — 가로로 이어 붙이면 보관소 벽이 된다.
# 매니페스트에 항목이 없으므로 OBJ 번호를 지어내지 않는다. 이름은 FURN_.
#
# **문은 본체와 분리한다.** 문마다 원점을 경첩 자리(왼쪽 모서리)에 두므로
# rotation_euler.z 만 돌리면 열린다. 원점을 가운데 두면 문이 벽을 파고든다.
#
# 크기는 캐릭터 기준이다. 전신 0.888 에 대해 높이 1.02 — 사람보다 조금 큰
# 실제 코인로커 비율(1.8m 대 1.5m)이다.
LK_D, LK_H = 0.26, 1.02
LK_PANEL = 0.09              # 오른쪽 조작반 폭
LK_T = 0.012                 # 판 두께
# 칸 크기는 **두 가지**다.
#   작은 칸 S — 가방·쇼핑백
#   큰 칸  L — 작은 칸 두 개를 합친 크기. 칸을 합치면 사이의 칸막이 한 장도
#              같이 먹으므로 L = 2S + 판두께 다. 이래야 큰 칸 하나와 작은 칸
#              두 개가 같은 자리를 정확히 차지한다.
# 아래 2행이 L, 위 3행이 S. 큰 짐이 아래로 가야 넣기 쉽다.
# 5행이 높이를 정확히 채우도록 S 를 역산한다 — 2L + 3S = 높이 - 판 두 장.
LK_ROWS_L, LK_ROWS_S = 2, 3
_usable = LK_H - 2 * LK_T
LK_S = (_usable - LK_ROWS_L * LK_T) / (2 * LK_ROWS_L + LK_ROWS_S)
LK_L = 2 * LK_S + LK_T
LK_ROWS = (LK_L,) * LK_ROWS_L + (LK_S,) * LK_ROWS_S
LK_COLS = 4
# 칸 하나가 실물 코인로커 폭(약 0.34m)이 되게 전체 폭을 역산한다.
# 열 수만 늘리고 폭을 그대로 두면 칸이 좁고 길어져 사물함으로 보인다.
LK_W = 0.2095 * LK_COLS + LK_PANEL + LK_T
_cw = (LK_W - LK_PANEL - LK_T) / LK_COLS

M_LK_BODY = new_mat("FURN_LockerBody", "B8C0C6", 0.46)     # 도장 강판
M_LK_DOOR = new_mat("FURN_LockerDoor", "9FAAB2", 0.44)     # 문짝 — 한 톤 어둡게
M_LK_TRIM = new_mat("FURN_LockerTrim", "4A525C", 0.40)     # 손잡이·자물쇠·조작반
# 사용 상태 램프. 엔진이 이 **재질만 바꿔** 빈칸/사용중을 표시한다.
# 램프를 별도 오브젝트로 빼지 않는 이유는 문이 열릴 때 같이 돌아야 해서다.
# 문 메시 안에 있되 재질이 달라 glTF 에서 별도 프리미티브로 나간다.
M_LK_FREE = new_mat("FURN_LockerLampFree", "4FC172", 0.36)   # 빈칸
M_LK_USED = new_mat("FURN_LockerLampUsed", "E05A4E", 0.36)   # 사용중

_x0 = -LK_W / 2.0
_parts = []
# 몸통 — 뒤판·양옆·천장·바닥
_parts.append(slab("lk_back", (0, LK_D / 2 - LK_T / 2, LK_H / 2),
                   (LK_W, LK_T, LK_H), M_LK_BODY))
for _sx in (-1, 1):
    _parts.append(slab("lk_side%d" % _sx, (_sx * (LK_W / 2 - LK_T / 2), 0, LK_H / 2),
                       (LK_T, LK_D, LK_H), M_LK_BODY))
for _z, _n in ((LK_T / 2, "lk_floor"), (LK_H - LK_T / 2, "lk_top")):
    _parts.append(slab(_n, (0, 0, _z), (LK_W, LK_D, LK_T), M_LK_BODY))
# 세로 칸막이
for _c in range(1, LK_COLS + 1):
    _parts.append(slab("lk_div%d" % _c, (_x0 + _cw * _c, 0, LK_H / 2),
                       (LK_T, LK_D, LK_H), M_LK_BODY))
# 가로 선반
_z = LK_T
for _h in LK_ROWS[:-1]:
    _z += _h
    _parts.append(slab("lk_shelf%.0f" % (_z * 1000),
                       (_x0 + (LK_W - LK_PANEL - LK_T) / 2, 0, _z),
                       (LK_W - LK_PANEL - LK_T, LK_D, LK_T), M_LK_BODY))
# 조작반 — 이게 있어야 '보관소'로 읽힌다. 없으면 그냥 사물함이다.
_pcx = LK_W / 2 - LK_PANEL / 2 - LK_T
# 앞면을 막는다. 없으면 그 칸만 앞이 뚫려 캐비닛 속이 들여다보인다.
_parts.append(slab("lk_panel_face", (_pcx, -LK_D / 2 + LK_T / 2, LK_H / 2),
                   (LK_PANEL, LK_T, LK_H - LK_T * 2), M_LK_BODY))
# 조작반은 앞판보다 **앞으로** 나와야 한다. 뒤에 두면 통째로 묻힌다(실측).
_parts.append(slab("lk_panel", (_pcx, -LK_D / 2 - LK_T * 0.25, LK_H * 0.62),
                   (LK_PANEL * 0.86, LK_T * 0.9, 0.22), M_LK_TRIM))
# 조작반 화면은 빈칸 램프와 같은 초록을 쓴다. 여기에 색을 하나 더 들이면
# 한 물건이 쓰는 색 계열이 5개가 되어 세트 규칙을 넘는다.
_parts.append(slab("lk_screen", (_pcx, -LK_D / 2 - LK_T * 0.72, LK_H * 0.685),
                   (LK_PANEL * 0.62, LK_T * 0.45, 0.072), M_LK_FREE))
# 동전 투입구 — 작지만 '코인로커'라는 신호다.
_parts.append(slab("lk_coin", (_pcx, -LK_D / 2 - LK_T * 0.72, LK_H * 0.575),
                   (LK_PANEL * 0.30, LK_T * 0.45, 0.012), M_LK_BODY))
BODY = finish("FURN_Locker__Body", _parts)
shade(BODY, False)
ITEMS["FURN_Locker__Body"] = BODY

# 문 — 칸마다 하나. 원점은 왼쪽 경첩.
# 기본 상태. 배경 소품이라 반쯤 차 있어야 자연스럽다 — 전부 초록이면
# 아무도 안 쓰는 보관소로 보이고, 전부 빨강이면 고장난 것처럼 보인다.
LK_USED = {0, 2, 5, 6, 9, 10, 13, 14, 17, 19}

_di = 0
_z = LK_T
for _row, _h in enumerate(LK_ROWS):
    for _c in range(LK_COLS):
        _lx = _x0 + LK_T / 2 + _cw * _c                  # 칸 왼쪽(경첩) x
        _dw, _dh = _cw - LK_T, _h - LK_T
        _hinge = (_lx, -LK_D / 2 + LK_T * 0.6, _z + _h / 2.0)
        _p = [slab("door_face", (_dw / 2, 0, 0), (_dw, LK_T, _dh), M_LK_DOOR),
              # 손잡이 — 경첩 반대쪽. 문이 어느 쪽으로 열리는지 이걸로 읽는다.
              slab("door_grip", (_dw * 0.82, -LK_T * 0.9, 0),
                   (_dw * 0.16, LK_T * 0.9, _dh * 0.16), M_LK_TRIM),
              slab("door_lock", (_dw * 0.82, -LK_T * 0.8, -_dh * 0.26),
                   (_dw * 0.10, LK_T * 0.7, _dh * 0.10), M_LK_TRIM),
              slab("door_lamp", (_dw * 0.82, -LK_T * 0.85, _dh * 0.27),
                   (_dw * 0.13, LK_T * 0.6, _dh * 0.11),
                   M_LK_USED if _di in LK_USED else M_LK_FREE)]
        _door = finish("FURN_Locker__Door%02d" % _di, _p)
        _door.location = _hinge
        shade(_door, False)
        ITEMS["FURN_Locker__Door%02d" % _di] = _door
        _di += 1
    _z += _h

# --------------------------------------------------------------------- 검산
def _family(mat):
    """색 계열 이름. 채도가 낮으면 전부 'neutral', 아니면 30도 색상 버킷."""
    b = next(n for n in mat.node_tree.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled')
    lin = b.inputs["Base Color"].default_value[:3]
    srgb = [(1.055 * c ** (1 / 2.4) - 0.055) if c > 0.0031308 else c * 12.92 for c in lin]
    import colorsys
    h, sv, v = colorsys.rgb_to_hsv(*srgb)
    if sv < 0.16:
        return "neutral"
    return "hue%d" % (int(round(h * 12)) % 12)


PURE = {(0.0, 0.0, 0.0), (1.0, 1.0, 1.0)}
for m in bpy.data.materials:
    b = next((n for n in m.node_tree.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
    c = tuple(round(v, 3) for v in b.inputs["Base Color"].default_value[:3])
    if c in PURE:
        raise RuntimeError("%s is pure black/white: %s" % (m.name, c))

for name, o in ITEMS.items():
    rep[name] = measure(o)
    me = o.data
    used = {vi for p in me.polygons for vi in p.vertices}
    loose = [v.index for v in me.vertices if v.index not in used]
    if loose:
        raise RuntimeError("%s has %d loose vertices" % (name, len(loose)))
    if not me.materials:
        raise RuntimeError("%s has no material" % name)
    # '주요 색상 3~4개' 는 슬롯 수가 아니라 **색 계열** 수다. 접힘 음영은
    # 같은 색상 계열의 명도 차이로 내라는 지시였으므로 한 계열로 센다.
    fams = {_family(m) for m in me.materials if m}
    if len(fams) > 4:
        raise RuntimeError("%s uses %d colour families %s (3~4개까지)"
                           % (name, len(fams), sorted(fams)))
    rep[name]["colour_families"] = sorted(fams)
    # 원점 규약은 손에 드는 소품에만 해당한다. 가구의 문은 경첩이 원점이라야
    # Z 회전만으로 열린다.
    if name.startswith("ITM") and max(abs(v) for v in o.location) > 1e-6:
        raise RuntimeError("%s origin is not at 0: %s" % (name, list(o.location)))
    # polygon.area 는 편집 모드 조작 뒤 갱신되지 않은 값을 돌려준다 —
    # 멀쩡한 면을 0 으로 보고했다(실측 4개). 좌표로 직접 잰다 (뉴얼 법).
    degen = []
    for poly in me.polygons:
        n = Vector((0.0, 0.0, 0.0))
        vs = [me.vertices[i].co for i in poly.vertices]
        for i, a in enumerate(vs):
            b = vs[(i + 1) % len(vs)]
            n += Vector(((a.y - b.y) * (a.z + b.z),
                         (a.z - b.z) * (a.x + b.x),
                         (a.x - b.x) * (a.y + b.y)))
        if n.length * 0.5 < 1e-9:
            degen.append(poly.index)
    if degen:
        raise RuntimeError("%s has %d zero-area faces" % (name, len(degen)))

rep["scale_reference"] = {"body_height": BODY_H, "phone_longest": PHONE_L,
                          "bevel": BEVEL_S}
rep["total_tris"] = sum(rep[k]["tris"] for k in ITEMS)
rep["materials"] = sorted(m.name for m in bpy.data.materials)

extra = sorted(o.name for o in bpy.data.objects if o.name not in ITEMS)
if extra:
    raise RuntimeError("unexpected objects in scene: %s" % extra)

OUT = os.path.abspath(OUT)
bpy.ops.wm.save_as_mainfile(filepath=OUT)
rep["saved"] = OUT
with open(REPORT, "w") as fh:
    json.dump(rep, fh, indent=1, ensure_ascii=False)
print("ITEMS_BUILD OK ->", OUT)
print(json.dumps(rep, ensure_ascii=False, indent=1))
