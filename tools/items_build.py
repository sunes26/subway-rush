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

# ============================================== ITM-02 동전 (P1)
# GDD 초안은 동전을 3D 소품 없이 "이펙트로 대체"하기로 했었다 — 여기서
# 뒤집는다. 바닥에 흩어진 동전은 달리는 중에 실루엣만 보고 찾아야 하는
# 물건이라(MAP-LAYOUT §4.5, "C1 홀 남측 눈에 띔") 실제로 보일 무언가가
# 필요하다.
#
# 손에 드는 소품이 아니라 **선 채로 바닥에 놓여 찾아지는** 소품이다.
# plate() 는 폭·높이를 지름 하나로 맞추면(r = 지름/2) 네 귀퉁이가 서로
# 맞물려 그대로 원판이 된다(hw=hh=0) — 카드와 같은 함수를 그대로 쓴다.
#
# 색은 카드의 옐로 계열과 겹치지 않는 골드로 따로 잡는다. 카드·마스크·
# 우산 세 소품이 공유하는 세트 신호를 흐리지 않기 위해서다.
#
# 원점은 바닥 접지점(하단 중앙) — ITM-12 다섯 상품과 같은 규약이다. 손에
# 붙는 소품이 아니라 바닥에 놓인 채로 사라지는 소품이라서다.
COIN_D = 0.046                 # 지름 — 실물 500원(26.5mm)의 1.7배.
                                # 카드(1.5배 과장)보다 더 키운다: 달리는 중
                                # 원거리 실루엣으로 찾아야 해서다.
COIN_T = 0.0034                # 두께 — 실물(1.9~2.0mm) 대비 같은 비율로 확대
COIN_SEG = 11                  # 4*11=44변 — 저해상도에서도 원으로 읽히는 선

M_COIN = new_mat("ITM_CoinBody", "D9A039", 0.40, metallic=0.55)         # 본체 골드
M_COIN_LIT = new_mat("ITM_CoinLit", "F2C766", 0.30, metallic=0.55)      # 베벨 모서리(빛 받는 면)
M_COIN_FIELD = new_mat("ITM_CoinField", "FADD8F", 0.26, metallic=0.48)  # 도드라진 안쪽 판
M_COIN_DEEP = new_mat("ITM_CoinDeep", "A9752A", 0.46, metallic=0.55)    # 옆면(테두리) — 가장 어두운 골드, 검정 아님

_body = plate("coin_body", COIN_D, COIN_D, COIN_D / 2.0, COIN_T, M_COIN,
             seg=COIN_SEG, edge_mat=M_COIN_DEEP, cz=COIN_D / 2.0)
_body.data.materials.append(M_COIN_LIT)          # 슬롯 2 = 깎인 모서리
bevel(_body, BEVEL_S * 0.8, 2, mat_index=2)
_parts = [_body]

# 안쪽 판 — 앞뒤 양면 모두. 표면과 같은 높이로 읽혀야 하므로 FLAT 만큼만 띄운다.
# 두 판의 중심은 코인 자체와 같은 높이(COIN_D/2)에 둬야 동심원이 된다.
_coin_fd = COIN_D * 0.64
_parts.append(plate("coin_field_f", _coin_fd, _coin_fd, _coin_fd / 2.0, FLAT * 2, M_COIN_FIELD,
                    seg=COIN_SEG, y=-COIN_T / 2.0 - FLAT, cz=COIN_D / 2.0))
_parts.append(plate("coin_field_b", _coin_fd, _coin_fd, _coin_fd / 2.0, FLAT * 2, M_COIN_FIELD,
                    seg=COIN_SEG, y=COIN_T / 2.0 + FLAT, cz=COIN_D / 2.0))
for _p in _parts:
    shade(_p, False)                     # 몸통·안쪽 판은 저해상도 각짐 그대로

# 가운데 $ 표식 — 안쪽 판보다 한 겹 더 튀어나온 골드 와이어다. 사인 곡선
# 하나로 훑었더니 룬 문자처럼 보였다(실측) — 진짜 S 자는 사인파가 아니라
# **반원 둘을 이어 붙인 모양**이다(위 반원은 오른쪽으로, 아래 반원은
# 왼쪽으로 부푼다).
#
# 반지름을 그냥 키우면 이음매(가운데, x=0)가 안 맞아 끊어진다 — z 는
# 반지름 그대로(h/4) 두고 **x 만 따로 넓힌다**. cos(±90°)=0 이라 이음매는
# x=0 그대로 유지되면서 굴곡만 커진다. 기울임은 전혀 안 섞는다 — x 가
# 항상 좌우 대칭이라 기울 수가 없다.
_g_h = _coin_fd * 0.62                   # 표식 전체 높이
_g_ra = _g_h / 4.0                       # z 진행용 반지름 — 이걸 바꾸면 이음매가 어긋난다
_g_width = 1.6                           # 굴곡(가로 폭) 배수 — z 와 분리해서 이것만 키운다
_g_r = _g_h * 0.050                      # 와이어 굵기
_g_over = _g_h * 0.16                    # 세로 막대가 S 위아래로 튀어나오는 길이
_g_cz = COIN_D / 2.0                     # 코인 중심 높이 — 필드 판과 같은 중심
_G_N = 16                                # 반원 하나당 표본 수 — 늘려서 매끈하게

def _s_half(center_z, a0_deg, a1_deg, n):
    out = []
    for i in range(n + 1):
        a = math.radians(a0_deg + (a1_deg - a0_deg) * i / n)
        out.append((_g_ra * _g_width * math.cos(a), center_z + _g_ra * math.sin(a)))
    return out

# 위 반원 — 중심 +h/4, 90°(꼭대기)→−90°(가운데)로 오른쪽을 지나며 부푼다.
# 아래 반원 — 중심 −h/4, 90°(가운데, 위 반원 끝과 겹침)→270°(바닥)로 왼쪽을 지나며 부푼다.
_S_XZ = (_s_half(_g_h / 4.0, 90.0, -90.0, _G_N)
         + _s_half(-_g_h / 4.0, 90.0, 270.0, _G_N)[1:])   # 가운데 겹침점 하나는 버린다
_S_PTS = [(x, 0.0, _g_cz + z) for x, z in _S_XZ]
_BAR_PTS = [(0.0, 0.0, _g_cz + _g_h * 0.5 + _g_over),
            (0.0, 0.0, _g_cz - _g_h * 0.5 - _g_over)]
_dollar_parts = []
# 뒷면은 앞면과 같은 좌표를 그대로 쓰면 **뒤에서 봤을 때 좌우가 뒤집힌 $** 로 읽힌다
# (거울에 비친 것과 같은 이치) — 뒷면만 x 를 반전해서 제 방향으로 읽히게 한다.
for _side, _gy, _mirror in (("f", -COIN_T / 2.0 - FLAT * 3, 1.0), ("b", COIN_T / 2.0 + FLAT * 3, -1.0)):
    _s_pts = [(x * _mirror, _gy, z) for x, _, z in _S_PTS]
    _bar_pts = [(x * _mirror, _gy, z) for x, _, z in _BAR_PTS]
    _dollar_parts.append(tube("coin_dollar_s%s" % _side, _s_pts, _g_r, 14, M_COIN_DEEP))
    _dollar_parts.append(tube("coin_dollar_bar%s" % _side, _bar_pts, _g_r * 0.85, 10, M_COIN_DEEP))
for _p in _dollar_parts:
    shade(_p, True)                      # 표식만 매끈하게 — 둥근 와이어로 읽혀야 한다
_parts += _dollar_parts

# 눕힌다 — `plate()`는 로컬 XZ 평면(수직으로 선 판)을 만든다. 카드처럼 세워
# 드는 물건은 그대로 쓰지만, 동전은 바닥에 누워 있어야 달리며 내려다볼 때
# 원판 면($ 각인)이 보인다. 세운 채로 두면 얇은 옆면만 보여 실측(인게임
# 스크린샷)에서 사각형 실루엣으로 읽혔다.
# X 축 -90도 — front 면(거울 안 된 $, 법선 -Y)이 +Z(위)로 돌아간다.
for _p in _parts:
    set_active(_p)
    _p.rotation_euler = (math.radians(-90.0), 0.0, 0.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

ITEMS["ITM02_Coin"] = finish("ITM02_Coin", _parts)

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

# ============================================== ITM-05 무선이어폰 케이스
# 항상 닫힌 채로만 보인다 — `holdable:false` 라 귀에 꽂는 순간 손에도 안
# 잡히므로 열림 상태를 만들 이유가 없다. 스폰 벤치 옆 첫 픽업(P3 튜토리얼의
# 전제)이라 실루엣이 즉시 읽혀야 한다 — 세로로 긴 라운드 캡슐(필통형) +
# 위쪽 힌지선 하나로 "이건 케이스다"는 신호를 준다.
#
# 원점은 바닥 접지점(하단 중앙) — 벤치에 놓인 채로 발견되는 물건이라 손에
# 붙는 소품(우산)이 아니라 동전·ITM-12 와 같은 규약을 따른다.
EW, EH, ET = 0.068, 0.091, 0.033   # 실물(45×60×22mm) × 1.5배 과장 — 카드·마스크와 같은 비율
ER = 0.026                         # 큰 라운딩 — 옆면이 거의 남지 않는 캡슐. 굵은 베벨(아래)이
                                    # 더 파먹으므로 너무 크면 힌지·LED 자리가 곡면에 걸린다
ESEG = 6

M_EAR = new_mat("ITM_EarbudsBody", "F4F8F8", 0.34)           # 본체 오프화이트
M_EAR_LIT = new_mat("ITM_EarbudsLit", "FCFEFE", 0.28)        # 베벨 하이라이트(빛 받는 모서리)
M_EAR_EDGE = new_mat("ITM_EarbudsEdge", "E3E8EA", 0.40)      # 옆면 그늘 — 순수 회색 대신 같은 계열
M_EAR_HINGE = new_mat("ITM_EarbudsHinge", "D3DADD", 0.42)    # 뚜껑 이음선 밴드
M_EAR_AXLE = new_mat("ITM_EarbudsAxle", "AEB6BA", 0.36, metallic=0.35)  # 힌지 축
M_EAR_LED = new_mat("ITM_EarbudsLed", "6FE7DD", 0.30)        # 충전 LED — 세트에서 유일한 포인트

_ey = -ET / 2.0 - FLAT
_body = plate("ear_body", EW, EH, ER, ET, M_EAR, seg=ESEG, edge_mat=M_EAR_EDGE, cz=EH / 2.0)
_body.data.materials.append(M_EAR_LIT)          # 슬롯 2 = 깎인 모서리
# 실제 에어팟 케이스는 앞뒤 판이 아니라 **비누 덩이**에 가깝다 — 옆면과
# 앞뒤 면 사이 각을 얇게 깎는 카드식 베벨(BEVEL_S) 대신, 두께(ET)의 1/3
# 가까이 되는 굵은 베벨을 여러 세그먼트로 먹여 둥근 필렛을 만든다. 각짐이
# 남지 않게 본체만 매끈 셰이딩(둥근 덩어리로 읽혀야 광택 케이스가 된다).
bevel(_body, ET * 0.30, 6, mat_index=2)
shade(_body, True)
_parts = [_body]

# 힌지 이음선 — 뚜껑과 본체가 갈리는 자리를 앞면에 얕은 밴드로만 낸다.
# 카드의 하단 바(card_band)와 같은 방법 — 부품을 더 만들지 않고 색 하나로
# 구조를 읽힌다. 굵은 베벨이 위쪽 둥근 캡을 넓게 파먹으므로, 밴드는 그
# 곡면에 걸리지 않는 평평한 중단부에 둔다.
_parts.append(plate("ear_hinge_band", EW * 0.86, EH * 0.045, 0.0016, FLAT * 2, M_EAR_HINGE,
                    seg=2, y=_ey, cz=EH * 0.64))

# 충전 LED — 정면 하단 중앙의 작은 원판. 코인의 안쪽 판과 같은 트릭
# (w=h, r=w/2 로 두면 원판이 된다). 아래쪽 캡 곡면 반경 안쪽이라 평면에 붙는다.
_parts.append(plate("ear_led", 0.007, 0.007, 0.0035, FLAT * 2, M_EAR_LED,
                    seg=6, y=_ey, cz=EH * 0.16))

shade(_parts[1], False)
shade(_parts[2], False)

# 힌지 축 — 뒷면 중상단을 가로지르는 얇은 금속 원통. 밴드와 같은 평평한
# 구간(0.64) 높이에 둬 굵은 베벨 곡면 밖으로 뜨지 않게 한다.
_axle_y = ET / 2.0 + FLAT * 3
_axle_z = EH * 0.64
_parts.append(shade(tube("ear_hinge_axle",
                         [(-EW * 0.28, _axle_y, _axle_z), (EW * 0.28, _axle_y, _axle_z)],
                         0.0030, 8, M_EAR_AXLE), True))

ITEMS["ITM05_Earbuds"] = finish("ITM05_Earbuds", _parts)

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

# ======================================= ITM-08 신문지 (P2)
# 물청소 구역(OBS-05)에 까는 소모품. `PLACEHOLDER_LOOK`(props.ts)의 자리표시자
# 치수(0.26 × 0.04 × 0.19)를 그대로 최종 치수로 쓴다 — 접힌 신문 여러 장이
# 겹친 두께라 이미 치비 과장이 들어가 있었다.
#
# 카드·마스크와 같은 세로 판 규약(원점 = 중심, 손에 쥐는 자리)을 따른다.
# 텍스처는 쓰지 않는다(노선도가 이 저장소의 유일한 예외). 대신 카드의
# `card_band`·`card_wave` 와 같은 방법 — **표면과 같은 높이의 색 판**으로
# 헤드라인 바·기사 텍스트 줄·사진 블록·가운데 접힘선을 낸다.
#
# 두꺼운 옆면이 그냥 한 색이면 종이 뭉치가 아니라 플라스틱 블록으로 읽힌다
# (실측: 첫 버전). 트임면(오른쪽, +X)에 명도 두 단으로 번갈아 색을 칠한
# 가로줄을 넣어 "겹쳐 접힌 낱장"이라는 신호를 준다.
NW_, NH_, NT_ = 0.26, 0.19, 0.04

M_NEWS_BODY = new_mat("ITM_PaperBody", "F0EAD8", 0.90)
M_NEWS_LIT = new_mat("ITM_PaperLit", "F8F4E8", 0.86)
M_NEWS_EDGE = new_mat("ITM_PaperEdge", "D8CFB6", 0.90)
M_NEWS_INK = new_mat("ITM_PaperInk", "342E26", 0.72)
M_NEWS_TEXT = new_mat("ITM_PaperText", "AFA588", 0.80)
M_NEWS_PHOTO = new_mat("ITM_PaperPhoto", "C4BAA0", 0.78)
M_NEWS_FOLD = new_mat("ITM_PaperFold", "C9BFA6", 0.90)

_body = plate("news_body", NW_, NH_, 0.007, NT_, M_NEWS_BODY, seg=3, edge_mat=M_NEWS_EDGE)
_body.data.materials.append(M_NEWS_LIT)          # 슬롯 2 = 깎인 모서리
bevel(_body, BEVEL_S * 1.4, 2, mat_index=2)
_parts = [_body]

_ny = -NT_ / 2.0 - FLAT

# 헤드라인 바 — 카드 하단 바와 같은 트릭. 부품을 더 만들지 않고 색으로 구조를 읽힌다.
_parts.append(plate("news_masthead", NW_ * 0.82, NH_ * 0.14, 0.0015, FLAT * 2, M_NEWS_INK,
                    seg=1, y=_ny, cz=NH_ * 0.36))
# 가운데 접힘선 — 실제 신문처럼 좌우 전체 폭을 가로지르는 얕은 선.
_parts.append(plate("news_fold", NW_ * 0.94, NH_ * 0.02, 0.0008, FLAT * 2, M_NEWS_FOLD,
                    seg=1, y=_ny, cz=0.0))
# 사진/그래픽 블록 — 좌하단. 헤드라인 하나로는 '표'로 보이므로 이질적인
# 사각 하나를 더 얹어 인쇄면이라는 신호를 강화한다.
_parts.append(plate("news_photo", NW_ * 0.30, NH_ * 0.24, 0.002, FLAT * 2, M_NEWS_PHOTO,
                    seg=1, y=_ny, cx=-NW_ * 0.20, cz=-NH_ * 0.10))
# 기사 텍스트 줄 — 우측 칼럼 4줄(문단처럼 폭을 흔든다) + 하단 전폭 2줄.
_tw = (NW_ * 0.34, NW_ * 0.30, NW_ * 0.34, NW_ * 0.24)
for _i, _w in enumerate(_tw):
    _parts.append(plate("news_text%d" % _i, _w, NH_ * 0.028, 0.0008, FLAT * 2, M_NEWS_TEXT,
                        seg=1, y=_ny, cx=NW_ * 0.15, cz=NH_ * 0.14 - _i * NH_ * 0.075))
for _i, _w in enumerate((NW_ * 0.90, NW_ * 0.60)):
    _parts.append(plate("news_textlo%d" % _i, _w, NH_ * 0.026, 0.0008, FLAT * 2, M_NEWS_TEXT,
                        seg=1, y=_ny, cz=-NH_ * 0.32 - _i * NH_ * 0.07))
for _p in _parts:
    shade(_p, False)

# 트임면(+X) 낱장 줄 — YZ 평면 얇은 사각 5개, 명도 두 단을 번갈아 배치.
_news_hh = NH_ / 2.0 - 0.007
_news_x = NW_ / 2.0 + FLAT
_NLINES = 5
for _i in range(_NLINES):
    _t0 = _i / _NLINES
    _t1 = _t0 + (1.0 / _NLINES) * 0.42
    _z0 = _news_hh - 2.0 * _news_hh * _t0
    _z1 = _news_hh - 2.0 * _news_hh * _t1
    _mat = M_NEWS_LIT if _i % 2 == 0 else M_NEWS_EDGE
    _line = _mesh("news_pageline%d" % _i,
                  [(_news_x, -NT_ * 0.985 / 2.0, _z1), (_news_x, NT_ * 0.985 / 2.0, _z1),
                   (_news_x, NT_ * 0.985 / 2.0, _z0), (_news_x, -NT_ * 0.985 / 2.0, _z0)],
                  [(0, 1, 2, 3)], _mat)
    shade(_line, False)
    _parts.append(_line)

ITEMS["ITM08_Paper"] = finish("ITM08_Paper", _parts)

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

# --- 양갱 (정답) — 닫힌 **종이 박스 패키지**. 짙은 갈색 + 황금빛 오렌지.
M_YG_BOX = new_mat("ITM_YanggaengBox", "D9A24B", 0.50)     # 골드 오렌지 본체
M_YG_BOX_L = new_mat("ITM_YanggaengBoxLit", "E8BE72", 0.48)  # 박스 옆면
M_YG_DARK = new_mat("ITM_YanggaengDark", "3A211A", 0.54)   # 짙은 갈색 끝 구역
M_YG_BEIGE = new_mat("ITM_YanggaengBeige", "EFE0BD", 0.50)  # 제품명 자리 베이지판
M_YG_BEAN = new_mat("ITM_YanggaengBean", "6B2E22", 0.52)   # 팥알 모티프

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
M_SN_PC = new_mat("ITM_SnackPiece", "F4E1B2", 0.64)       # 과자 조각 (크림)
M_SN_PCD = new_mat("ITM_SnackPieceGroove", "CBA666", 0.64)  # 조각 홈
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
# 실물 편의점 양갱은 **닫힌 종이 박스**다. 앞선 판은 금박을 벗겨 속을 드러낸
# 낱개 포장이었는데, 그 구조는 '케이스에 블록을 붙인 것'으로 계속 읽혔다.
# 박스로 바꾸면 그 문제가 통째로 사라진다 — 벗길 것이 없으면 붙일 것도 없다.
# 단면만 7% 줄인다(26×12 → 24.2×11.2). 길이는 그대로라 더 얇고 긴
# 박스가 된다 — 편의점 양갱은 손바닥에 납작하게 눕는 물건이다.
YG_L, YG_H, YG_D = 0.100, 0.0242, 0.0112
YG_DARK_W = YG_L * 0.145             # 한쪽 끝 14.5% 는 짙은 갈색 구역
_YGF = -YG_D / 2.0
# 박스는 두 판을 맞대 만든다. 단면이 같으므로 이음매가 안 보이고, 색만
# 갈린다 — 인쇄된 색 분할로 읽힌다. 종이라 모서리 반경과 베벨을 작게 준다.
_p = [plate("yg_box", YG_L - YG_DARK_W, YG_H, 0.0010, YG_D, M_YG_BOX, seg=2,
            cx=YG_DARK_W / 2.0, edge_mat=M_YG_BOX_L)]
_p.append(plate("yg_dark", YG_DARK_W, YG_H, 0.0010, YG_D, M_YG_DARK, seg=2,
                cx=-(YG_L - YG_DARK_W) / 2.0))
for _o in _p:
    bevel(_o, 0.0005, 1)
# 제품명 자리 — 베이지 장방형. 실물 패키지에서 이름이 앉는 자리다.
# 글자는 넣지 않는다. 자리만 있어도 '상품 포장'으로 읽힌다.
_p.append(decal("yg_panel", _rr(YG_L * 0.36, YG_H * 0.72, 0.0020, 2,
                                cx=YG_L * 0.08),
                flat_place(_YGF), M_YG_BEIGE))
# 글자 "양갱" — 상품 **종류** 이름이라 상표가 아니다. 추상 붓획을 얹어 봤더니
# 곡선 둘이 눈썹, 그 아래 팥알 줄이 입이 되어 통째로 웃는 얼굴이 됐고,
# 고쳐 쌓은 가로획 셋은 낙서로 읽혔다. 이름 두 글자를 그대로 새기면 그
# 문제가 없어지고 무엇인지도 한눈에 잡힌다. 획은 둥근 사각 막대와
# 고리로만 만든다 — 폰트를 옮겨 오지 않는다.
_YGT = 0.0015                                  # 획 굵기
_YGC = YG_L * 0.08                             # 판 중심


def _yg_bar(n, cx, cz, w, h):
    _p.append(decal("yg_%s" % n, _rr(w, h, min(w, h) * 0.32, 1, cx=cx, cz=cz),
                    flat_place(_YGF), M_YG_BEAN, layer=1))


def _yg_ring(n, cx, cz, od, seg=12):
    _ro, _ri = od / 2.0, od / 2.0 - _YGT
    _a = [2.0 * math.pi * i / seg for i in range(seg + 1)]
    _p.append(decal_strip(
        "yg_%s" % n,
        [(cx + _ri * math.cos(t), cz + _ri * math.sin(t)) for t in _a],
        [(cx + _ro * math.cos(t), cz + _ro * math.sin(t)) for t in _a],
        flat_place(_YGF), M_YG_BEAN, layer=1))


_YG1 = _YGC - 0.0068                           # 양
_yg_ring("y_ini", _YG1 - 0.0032, 0.0030, 0.0056)          # ㅇ
# ㅏ 의 짧은 획은 세로줄 **오른쪽**이다. 왼쪽에 붙이면 ㅓ 가 되어 "엉갱"이 된다.
_yg_bar("y_med", _YG1 + 0.0028, 0.0028, _YGT, 0.0074)     # ㅏ 세로
_yg_bar("y_nub", _YG1 + 0.0039, 0.0028, 0.0022, _YGT)     # ㅏ 가로
_yg_ring("y_fin", _YG1 + 0.0002, -0.0034, 0.0062)         # 받침 ㅇ
_YG2 = _YGC + 0.0066                           # 갱
_yg_bar("g_ini_h", _YG2 - 0.0032, 0.0058, 0.0044, _YGT)   # ㄱ 가로
_yg_bar("g_ini_v", _YG2 - 0.0017, 0.0036, _YGT, 0.0058)   # ㄱ 세로
_yg_bar("g_med1", _YG2 + 0.0014, 0.0028, _YGT, 0.0074)    # ㅐ 왼 세로
_yg_bar("g_med2", _YG2 + 0.0044, 0.0028, _YGT, 0.0074)    # ㅐ 오른 세로
_yg_bar("g_nub", _YG2 + 0.0029, 0.0026, 0.0030, _YGT)     # ㅐ 가로
_yg_ring("g_fin", _YG2 + 0.0000, -0.0034, 0.0062)         # 받침 ㅇ
# 팥알 셋 — 베이지판 **밖**, 오른쪽 금색 여백에 비스듬한 줄로. 판 아래에
# 깔면 그 자체가 입이 된다. 크기를 달리해 무늬가 반복으로 보이지 않게 한다.
for _i, (_bx, _bz, _bs, _br) in enumerate(((0.0000, 0.0052, 1.00, -26.0),
                                           (0.0044, -0.0006, 0.86, 16.0),
                                           (0.0088, -0.0064, 1.10, -38.0))):
    _p.append(decal("yg_bean%d" % _i,
                    _rr(0.0040 * _bs, 0.0025 * _bs, 0.0012 * _bs, 2,
                        cx=YG_L * 0.35 + _bx, cz=_bz, rot=_br),
                    flat_place(_YGF), M_YG_BEAN, layer=1))
# 뒷면 — 같은 색 분할이 이어지고 베이지판만 작게. 박스는 사방이 인쇄면이다.
# 후면 — 전면 폭의 42% 짜리 긴 흰 바를 두었더니 그것만으로 **다른 상품의
# 앞면**처럼 보였다. 실물 박스 뒷면에서 눈에 띄는 건 작은 성분표 한 칸이다.
_p.append(decal("yg_back", _rr(YG_L * 0.15, YG_H * 0.46, 0.0012, 2,
                               cx=YG_L * 0.20)[::-1],
                flat_back(YG_D / 2.0), M_YG_BEIGE))
for _o in _p:
    shade(_o, False)
ITEMS["ITM12_Yanggaeng"] = ground(finish("ITM12_Yanggaeng", _p))

# ------------------------------------------ 바나나우유 · 플라스틱 단지 용기
# 도자기 단지로 읽히던 원인은 **아래가 위만큼 굵고 배가 부풀어서**였다.
# 실물은 아래 통이 오히려 조금 좁고, 턱 위로 부드럽게 원뿔이 서며, 바닥이
# 평평하다. 그 셋을 맞추면 도자기가 아니라 플라스틱 음료 용기가 된다.
BM_SEG = 20
# **턱(돌출 링)을 없앴다.** 지름이 튀는 고리 하나가 용기를 위아래 두 부품으로
# 갈라 보이게 만든 원인이었다. 바닥에서 목까지 반경이 단조롭게만 변하는
# 연속 곡면으로 다시 잡고, 초록은 지오메트리가 아니라 **인쇄 띠**로만 남긴다.
# 반경만 줄였더니 이번엔 **눌린 항아리**가 됐다. 낮고 넓은 비율 자체가
# 그릇을 부르는 것이라, 높이를 +15% 세우고 폭을 −6% 더 좁힌다.
# 짧고 통통한 단지형은 남되, 그릇이나 화장품 단지와는 갈라진다.
# 어깨 위 기울기가 마지막 고리에서 완만해지며 꺾여 보이던 것도 이어서 폈다.
BM_RINGS = [(0.0000, 0.01351), (0.0017, 0.01542), (0.0046, 0.01666),
            (0.0099, 0.01708),
            (0.0197, 0.01767), (0.0314, 0.01787), (0.0368, 0.01752),
            (0.0428, 0.01665), (0.0494, 0.01499), (0.0554, 0.01296),
            (0.0604, 0.01050), (0.0634, 0.00879)]
#             바닥 ─── 배 ───┬── 초록 인쇄 띠 ──┬── 어깨 ── 목(밝은 면)
_rows = [0, 0, 0, 0, 0, 3, 3, 3, 0, 1, 1]   # 초록 인쇄 띠 = 밴드 5~7
_p = [revolve("bm_body", BM_RINGS, BM_SEG,
              [M_BM, M_BM_LIT, M_BM_CAP, M_BM_GRN], _rows)]
# 뚜껑은 목보다 **1.5mm 넓게** 벌린다. 지름 차이가 작으면 뚜껑이 몸통의
# 연장으로 보여, 어디까지가 병이고 어디부터가 뚜껑인지 읽히지 않았다.
# 뚜껑 밑동을 목 바로 위에 얹었더니 그 사이 고리 틈으로 속이 비쳐 **검은 띠**가
# 생겼다(반경을 0.15mm 만 띄우면 이번엔 각기둥 면끼리 교차해 깜빡인다).
# 밑동을 목 **안쪽**까지 내려 몸통이 좁아지는 지점에서 저절로 뚫고 나오게 한다 —
# 틈도 겹침도 없이 두 면이 가로지르고, 보이는 뚜껑 높이는 11mm 가 된다.
_p.append(revolve("bm_cap", [(0.0572, 0.01112), (0.0618, 0.01132),
                             (0.0632, 0.01162),
                             (0.0692, 0.01147), (0.0701, 0.01056)],
                  BM_SEG, M_BM_CAP))
_BMP = body_place(BM_RINGS, BM_SEG)
# 바나나 — 초록 라벨 아래, 턱 바로 위. 인쇄 그래픽이라 돌출 0.20mm.
_BAN_R, _BAN_CZ, _BAN_A, _BAN_T = 0.0056, 0.0393, 1.32, -30.0
_blo, _bup = _edges(
    lambda t: (_BAN_R * math.sin(t * _BAN_A), _BAN_R * math.cos(t * _BAN_A)),
    lambda t: 0.0023 * max(0.12, 1.0 - 0.88 * ((t - 0.15) / 1.15) ** 2), 15)
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
# 꼭지는 넣지 않는다. 가는 끝에 달면 부리, 굵은 끝에 달면 티끌이 된다 —
# 초승달 하나로 이미 바나나로 읽히고, 점 하나가 그걸 흐린다.
for _o in _p:
    shade(_o, False)
# 몸통만 부드럽게. 평면 음영이면 가로 고리마다 밝기가 계단으로 끊겨, 이어진
# 곡면이 아니라 **테를 쌓아 올린 통**으로 보인다. 뚜껑과 인쇄는 각을 살린다.
shade(_p[0], True)
ITEMS["ITM12_BananaMilk"] = ground(finish("ITM12_BananaMilk", _p))

# --------------------------------------- 초콜릿 · 은박에서 반쯤 꺼낸 판
# 조각을 낱개 판으로 세워 놨더니 **벽돌담**이 됐고, 은박은 직육면체라
# **받침대**가 됐다. 실물은 판 하나에 홈이 파여 여섯으로 갈린 것이고,
# 포일은 그 판을 감싸며 윗변에서 바깥으로 접혀 있다.
CH_W, CH_H, CH_D = 0.092, 0.046, 0.0100
CH_COL, CH_ROW = 3, 2
CH_TEAR = -0.0209                    # 포일이 끝나는 x. 오른쪽 짧은 끝이 뜯겼다
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
        _b = plate("ch_blk%d%d" % (_r, _c), _CW, _CHH, 0.0016, CH_D + 0.0007,
                   M_CH, seg=1, cx=_cx, cz=_cz, edge_mat=M_CH_LIT)
        bevel(_b, 0.0006, 1)         # 약한 베벨 — 각지면 장난감 블록이다
        _p.append(_b)
# 은박 — **좁은 쪽 끝에서 뜯긴다.** 넓은 아래쪽을 통째로 벗겨 놨더니 포일이
# 바를 감싼 게 아니라 **회색 받침대 위에 초콜릿을 올려 놓은 것**이 됐다.
# 실물은 짧은 끝을 조금 까서 먹는다. 포일이 몸통 대부분을 덮고, 오른쪽
# 짧은 끝에서만 초콜릿이 드러난다.
# 포일 두께는 **판 두께에 딸린 예산**이다. 조각이 판 위로 솟는 높이보다
# 포일이 두꺼워야 덮이는데, 그 조건 때문에 포일이 두꺼워지면 세워 놨을 때
# 회색 받침대가 된다. 그래서 조각을 0.7mm(한쪽 0.35)로 낮추고, 포일은
# 한쪽 0.45mm 만 내밀었다 — 1.3 → 0.9mm, 30% 얇아졌다.
CH_FD = CH_D + 0.0009
_FL = CH_W / 2.0 + 0.0006 + CH_TEAR          # 덮는 길이 31.4 → 25.7mm (−18%)
# 정면 폭은 몸통보다 0.3mm 만 넓다. 1.8mm 내밀었더니 감싼 것이 아니라
# 초콜릿을 담아 둔 **회색 상자**가 됐고, 딱 맞추면 옆으로 감긴 게 안 보였다.
_p.append(plate("ch_foil", _FL, CH_H + 0.0006, 0.0014, CH_FD, M_CH_FOIL,
                seg=2, cx=CH_TEAR - _FL / 2.0, edge_mat=M_CH_FOIL_D))
bevel(_p[-1], 0.0006, 1)
_FCX = CH_TEAR - _FL / 2.0
# 접힘 — 포일 **면 위에** 판을 얹는 방식은 세 번 다 실패했다. 가는 줄 셋은
# 눈금, 가운데 넓은 판은 회색 스티커, 가장자리 띠는 덧댄 패널이 됐다.
# 이 크기·이 음영에서 평평한 은색 면에 뭘 얹든 붙인 것으로 보인다.
# 접힘은 **뜯긴 경계에서** 나온다 — 한쪽으로 치우친 작은 탭 하나만 비스듬히
# 세우면 손으로 까다 접힌 자국이 되고, 위 경계도 그만큼 비대칭이 된다.
_p.append(plate("ch_fold", 0.0062, CH_H * 0.26, 0.0010, CH_FD + 0.0006,
                M_CH_FOIL_D, seg=1, cx=CH_TEAR - 0.0034,
                cz=-CH_H * 0.28, rot=-17.0))
# 뜯긴 경계 — 좌우가 **다르게** 어긋나야 손으로 깐 자국이 된다. 자리는
# CH_H 비율로 잡는다. 절대값으로 박아 뒀더니 폭을 줄였을 때 삐져나왔다.
_TH = CH_H / 2.0
for _i, (_t0, _t1, _tw) in enumerate(((-0.99, -0.46, 0.0038),
                                      (-0.46, 0.28, 0.0012),
                                      (0.28, 0.99, 0.0029))):
    _p.append(plate("ch_tear%d" % _i, _tw, (_t1 - _t0) * _TH, 0.0004, CH_FD,
                    M_CH_FOIL, seg=1, cx=CH_TEAR + _tw / 2.0 - 0.0005,
                    cz=(_t0 + _t1) / 2.0 * _TH, edge_mat=M_CH_FOIL_D))
for _o in _p:
    shade(_o, False)
_ch = finish("ITM12_Chocolate", _p)
# 세로로 세운다 — 긴 축을 Z 로 돌린다. 뜯긴 좁은 끝이 위, 포일이 아래를
# 감싸는 자세가 되어 진열대에 세워 둔 모습과 맞는다.
#
# **폭이 여기에 딸려 있다.** 54mm 로 세웠더니 새우깡 봉지와 실루엣 상이도가
# 48 → 32% 로 떨어졌다. 둘 다 '세로로 긴 둥근 사각'이 되어 작게 줄이면
# 구분이 안 된다. 46mm 로 좁히면 41% 로 회복하고, 다섯 중 최악 쌍은
# 바나나우유↔탄산음료 35% 자리로 되돌아온다 — 눕혔을 때와 같은 하한이다.
# 40mm 아래로 더 좁히면 이번엔 탄산음료 캔과 붙는다(32%).
_ch.rotation_euler = (0.0, math.radians(-90.0), 0.0)
set_active(_ch)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
ITEMS["ITM12_Chocolate"] = ground(_ch)

# ------------------------------------------- 탄산음료 · 대각 리본 초록 캔
# 필드 분할은 정면에서 **세로 띠**로 보여 레퍼런스의 경쾌함이 사라졌다.
# 굵은 대각 리본으로 되돌리되 폭을 14mm 로 키우고 기울기를 세워, 캔을
# 비스듬히 감아 도는 흐름이 정면에서 한눈에 보이게 한다.
SD_SEG = 18
# 짧고 굵어 미니캔으로 보였다. 높이 +13% · 지름 −6%. 바나나우유보다
# 확실히 높고 가늘어야 '캔'과 '단지'가 실루엣만으로 갈린다.
SD_R = 0.01466         # 지름 31.2 → 29.3mm
# 상하 금속 림은 **좁혔다** — 아래 6.3 → 5.0mm, 위 3.9 → 3.3mm.
SD_RINGS = [(0.0000, 0.01139), (0.0023, 0.01416), (0.0050, SD_R),
            (0.0755, SD_R), (0.0843, 0.01329), (0.0896, 0.01096),
            (0.0913, 0.01137), (0.0929, 0.01175)]
#           은 ─ 얇은 림 ── 초록 몸통 ── 어깨 ─ 어깨 ─ 은 ─ 림
_rows = [2, 2, 0, 1, 1, 2, 2]
_p = [revolve("sd_body", SD_RINGS, SD_SEG, [M_SD, M_SD_LIT, M_SD_MET], _rows)]
# 뚜껑 — 오목한 면 + 따는 홈 + 고리 + 구멍 + 리벳. 다섯이 다 있어야
# '따서 마시는 뚜껑'으로 읽힌다. 판 하나만 얹으면 뭔가 붙은 수준에 머문다.
_p.append(revolve("sd_lid", [(0.0929, 0.01147), (0.0936, 0.01090)],
                  SD_SEG, M_SD_GUN))
_p.append(slab("sd_score", (-0.0081, 0.0, 0.09345), (0.0086, 0.0098, 0.0008),
               M_SD_GUN))
_p.append(slab("sd_tab", (0.0032, 0.0, 0.09390), (0.0134, 0.0049, 0.0013),
               M_SD_MET))
_p.append(slab("sd_tab_hole", (0.0058, 0.0, 0.09458), (0.0062, 0.0024, 0.0010),
               M_SD_GUN))
_p.append(slab("sd_rivet", (-0.0034, 0.0, 0.09447), (0.0040, 0.0040, 0.0015),
               M_SD_MET))
_SDP = body_place(SD_RINGS, SD_SEG)
# 리본 — 한 바퀴 반을 감는다. 정면에서 사선 하나가 통째로 보이도록 기울기를
# 세웠다. 양끝은 좁혀 두어 끊긴 자리가 눈에 걸리지 않게 한다.
_RB = math.pi * SD_R * 1.00
# 한 바퀴를 다 감아 끊긴 자리가 정면에 걸리지 않게 한다. 양끝 폭을 좁혀
# 시작과 끝이 뒤에서 자연스럽게 만난다.
_rlo, _rup = _edges(lambda t: (t * _RB, 0.0429 + t * 0.0283),
                    lambda t: 0.0070 * max(0.22, 1.0 - 0.74 * t * t), 19)
_p.append(decal_strip("sd_ribbon", _rlo, _rup, _SDP, M_SD_WHT, layer=1,
                      step=0.0038, lift=0.00020, cross=2))
# 기포 — 리본 위 초록 면에서 올라간다. 별은 뺐다.
for _i, (_bx, _bz, _bd) in enumerate((
        (-0.0040, 0.0673, 0.0034), (0.0026, 0.0728, 0.0026),
        (0.0072, 0.0642, 0.0021))):
    _p.append(decal("sd_bub%d" % _i, _circ(_bd, cx=_bx, cz=_bz),
                    _SDP, M_SD_WHT, layer=1, step=0.0007))
for _o in _p:
    shade(_o, False)
ITEMS["ITM12_Soda"] = ground(finish("ITM12_Soda", _p))

# --------------------------------- 새우깡 · 금색 띠 + 오렌지/옐로 + 조각 더미
# 레이아웃을 실물처럼 3단으로 되돌린다 — **상단 금색 띠 / 오렌지 필드에 큰
# 붉은 새우 / 옐로 바닥에 쌓인 스낵 조각**. 조각은 길고 얇은 초승달이 아니라
# **짧고 통통한 곡선 스틱**이라야 과자로 보인다(앞선 판은 물결 무늬였다).
# 정면 실루엣(70×98)은 건드리지 않고 **두께만** 36 → 31.5mm (−12.5%).
SN_W, SN_H, SN_D = 0.070, 0.098, 0.0315
# SN_FMIN 은 **가장자리에 남는 두께 비율**이다. 0.36 이면 위아래 끝이
# 두께의 1/3 까지 급히 좁아져 뾰족한 쿠션 모서리가 된다. 0.46 으로 올리고
# 평평 구역(SN_PH)도 넓혀, 끝이 완만하게 눕는다.
SN_FMIN, SN_PW, SN_PH, SN_TAPER = 0.46, 0.58, 0.54, 0.012


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
_SHR_R, _SHR_CZ, _SHR_A = 0.0172, 0.0074, -32.0


def _shr_pt(t):
    a = math.radians(_SHR_A)
    x, z = _SHR_R * math.sin(t * 1.14), _SHR_R * math.cos(t * 1.14)
    return (x * math.cos(a) - z * math.sin(a) + _SHR_DX,
            x * math.sin(a) + z * math.cos(a) + _SHR_DZ)


_SHR_DX, _SHR_DZ = 0.0, 0.0
_slo, _sup = _edges(_shr_pt,
                    lambda t: 0.0051 * max(0.28, 1.0 - 0.66
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
                    _rr(0.0013, 0.0092, 0.00056, 1, cx=_mc[0], cz=_mc[1],
                        rot=math.degrees(math.atan2(_m1[1] - _m0[1],
                                                    _m1[0] - _m0[0]))),
                    _sn_place, M_SN_DK, layer=2, step=0.0040))
_hx, _hz = _shr_pt(-1.0)
_p.append(decal("sn_shr_head", _rr(0.0141, 0.0101, 0.0044, 2,
                                   cx=_hx - 0.0014, cz=_hz + 0.0021, rot=26.0),
                _sn_place, M_SN_SHR, layer=1, step=0.0060))
_tx, _tz = _shr_pt(1.0)
_ta0, _ta1 = _shr_pt(0.92), _shr_pt(1.0)
_tdx, _tdz = _ta1[0] - _ta0[0], _ta1[1] - _ta0[1]
_tn = math.hypot(_tdx, _tdz) or 1.0
_tdx, _tdz = _tdx / _tn, _tdz / _tn
# 꼬리 — 통짜 삼각형이면 몸통과 합쳐져 **화살표**가 된다. 실제 새우 꼬리는
# 갈라진 부챗살이라, 살 셋을 벌려 놓고 사이를 띄우면 화살촉이 되지 않는다.
_TA = math.atan2(_tdz, _tdx)
for _i, (_fa, _fl, _fw) in enumerate(((-0.46, 0.0057, 0.0018),
                                      (0.02, 0.0066, 0.0021),
                                      (0.50, 0.0055, 0.0017))):
    _fc, _fs = math.cos(_TA + _fa), math.sin(_TA + _fa)
    _flo, _fup = _edges(lambda t, L=_fl: (_tx + _fc * L * (t + 1.0),
                                          _tz + _fs * L * (t + 1.0)),
                        lambda t, W=_fw: 0.0010 + W * (t + 1.0) / 2.0, 5)
    _p.append(decal_strip("sn_shr_fin%d" % _i, _flo, _fup, _sn_place,
                          M_SN_SHR, layer=1, step=0.0045, cross=2))
# 스낵 조각 — 열 개를 흩었더니 국수 가락·뼈다귀로 읽혔다. **넷만 크게** 두고
# 각각에 얕은 세로 홈 셋을 넣는다. 길이:폭을 3:1 로 — 거의 정사각형이면
# 두툼한 게 아니라 **구겨진 종이 조각**이 된다. 새우맛 스낵의 정체는 굽은 막대가 아니라
# 그 위의 골이라, 홈이 없으면 무엇이든 될 수 있는 곡선일 뿐이다.
for _i, (_cx, _cz, _cl, _cw, _cd) in enumerate((
        (-0.0196, -0.0182, 0.0090, 0.0066, -16.0),
        (0.0000, -0.0172, 0.0095, 0.0070, 9.0),
        (0.0196, -0.0182, 0.0090, 0.0066, -22.0))):
    _cc, _cs = math.cos(math.radians(_cd)), math.sin(math.radians(_cd))

    def _put(x, z, cc=_cc, cs=_cs, ox=_cx, oz=_cz):
        return (x * cc - z * cs + ox, x * cs + z * cc + oz)

    _clo, _cup = _edges(lambda t, L=_cl: (t * L, 0.0024 * (t * t - 0.5)),
                        lambda t, W=_cw: W / 2.0 * (1.0 - 0.14 * abs(t) ** 3.0),
                        9)
    _p.append(decal_strip("sn_pc%d" % _i,
                          [_put(x, z) for x, z in _clo],
                          [_put(x, z) for x, z in _cup],
                          _sn_place, M_SN_PC, layer=1, step=0.0055, cross=1))
    for _k, _gt in enumerate((-0.44, 0.0, 0.44)):
        _gx, _gz = _gt * _cl, 0.0024 * (_gt * _gt - 0.5)
        _p.append(decal("sn_pcg%d%d" % (_i, _k),
                        _rr(0.0008, _cw * 0.56, 0.00034, 1,
                            cx=_put(_gx, _gz)[0], cz=_put(_gx, _gz)[1],
                            rot=_cd + math.degrees(math.atan2(
                                0.0060 * _gt, 1.0))),
                        _sn_place, M_SN_PCD, layer=2, step=0.0040))
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
