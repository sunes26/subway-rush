"""
Z2 화장실(OBJ-14) · 유실물 보관소(OBJ-13)를 다시 짓는다.

지금까지 화장실은 **통짜 박스에 픽토그램만 붙인 것**이었다 — 문도 안이 없었다.
실제 도시철도 화장실 치수로 남/여/다목적 3실을 짓고, 들어갈 수 있게 만든다.

치수 근거 (「도시철도 정거장 및 환승·편의시설 설계지침」· 공중화장실법 시행령)
  · 대변기 부스   0.90~1.00 W × 1.40~1.50 D, 칸막이 하부 0.15 띄움, 상단 1.90
  · 소변기        중심 간격 0.75~0.80, 립 높이 0.60
  · 세면 카운터   높이 0.80, 깊이 0.55, 거울 하단 0.95
  · 통로          1.20 이상
  · 다목적(장애인) 2.00 × 2.00 이상, 회전 지름 1.50 확보

배치 원칙 — 입구에서 안이 바로 보이면 안 된다. 각 실 입구 안쪽에 가림벽을 세운다.

    exec(open(r"C:\\Users\\User\\Documents\\HACKERTON\\tools\\build_wc.py").read())

충돌(`game/src/data/world.ts`)은 이 파일의 상수와 **같은 값**을 써야 한다.
한쪽만 고치면 벽이 없는 곳에서 막히거나 벽을 통과한다.
"""

import bpy

COLL = bpy.data.collections["Z2_CONCOURSE"]

FLOOR = -6.00
CEIL = -3.20          # 화장실 천장 (개찰층 천장 −2.80보다 낮게)
T = 0.20              # 벽 두께

# 실 경계 (외곽). 15.0 × 5.0 m — 처음 13.0 × 4.0 은 통로가 1.2m라 답답했다.
# 남쪽으로 1m 더 나오면서 OBJ-11 벤치를 y24.73 으로 물렸다(world.ts 동시 수정).
X0, X1 = 36.00, 51.00
Y0, Y1 = 25.00, 30.00
DIV_M_F = 42.00       # 남 | 여
DIV_F_A = 48.60       # 여 | 다목적

# 출입구 (남측 벽의 개구) — 각 실 동쪽 끝
DOORS = {
    "M": (40.30, 41.50),
    "F": (46.90, 48.10),
    "A": (49.30, 50.50),
}

# 가림벽 x (출입구 바로 안쪽 — 대합실에서 안이 보이지 않게)
SCREEN_M, SCREEN_F = 39.70, 46.30

BOOTH_Y0, BOOTH_Y1 = 28.20, Y1 - T      # 부스 깊이 1.60 (통로 1.30 확보)
PART_T = 0.04                            # 칸막이 두께
COUNTER_Y1 = Y0 + T + 0.55               # 세면 카운터 깊이
COUNTER_Z = FLOOR + 0.80


# ─────────────────────────── 머티리얼 ───────────────────────────

def mat(name, rgba):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes.get("Principled BSDF")
        if b:
            b.inputs["Base Color"].default_value = rgba
    m.diffuse_color = rgba      # Workbench MATERIAL 모드는 이 값을 읽는다
    return m


# 로더가 머티리얼별로 병합하므로 **머티리얼 한 종 = 드로우 콜 한 개**다.
# 새 머티리얼은 꼭 필요한 둘(도기·칸막이)만 만들고 나머지는 Z2에 이미 있는 것을 쓴다.
# 처음에 7종을 새로 만들었더니 Z2 드로우 콜이 예산을 넘겼다.
M_TILE = bpy.data.materials["COL_TILE"]      # 기둥 타일과 같은 백색 타일
M_PART = mat("WC_PART", (0.78, 0.76, 0.71, 1.0))
M_FIX = mat("WC_FIX", (0.96, 0.96, 0.95, 1.0))
M_CNTR = bpy.data.materials["ST_COUNTER"]    # 역무 카운터와 같은 짙은 마감
M_METAL = bpy.data.materials["DUCT"]         # 덕트와 같은 금속
M_MIRROR = mat("WC_MIRROR", (0.72, 0.76, 0.78, 1.0))   # 게임에서 실제 반사면으로 대체된다
M_LIGHT = bpy.data.materials["FIXTURE"]


# ─────────────────────────── 빌더 ───────────────────────────

def emit(name, boxes, material):
    """월드 좌표 박스 목록을 오브젝트 하나로. 머티리얼별로 묶어야 드로우 콜이 안 는다."""
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    if not boxes:
        return None
    verts, faces = [], []
    for (x0, y0, z0, x1, y1, z1) in boxes:
        n = len(verts)
        verts += [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                  (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        faces += [(n + 3, n + 2, n + 1, n), (n + 4, n + 5, n + 6, n + 7),
                  (n, n + 1, n + 5, n + 4), (n + 1, n + 2, n + 6, n + 5),
                  (n + 2, n + 3, n + 7, n + 6), (n + 3, n, n + 4, n + 7)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    return ob


def emit_planes(name, quads, material):
    """단면 평면들을 오브젝트 하나로. 거울은 박스가 아니라 **평면**이어야 한다 —
    게임 렌더러가 이 면을 통째로 반사면(Reflector)으로 바꿔 끼우기 때문에,
    박스로 두면 뒷면·옆면까지 거울이 된다. 법선은 +y(실내 쪽)."""
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    verts, faces = [], []
    for (x0, z0, x1, z1, y) in quads:
        n = len(verts)
        verts += [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)]
        faces.append((n + 3, n + 2, n + 1, n))   # 법선이 +y(실내)를 향하게
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    return ob


def booths(x_start, x_end, count):
    """부스 칸막이 x좌표 쌍을 돌려준다. 균등 분할."""
    span = (x_end - x_start) / count
    return [(x_start + i * span, x_start + (i + 1) * span) for i in range(count)]


# 양변기는 실측 모델(`WC_TOILET` 메시)을 쓴다. 0.566 W × 0.595 D × 0.780 H,
# 로컬 원점이 바닥이고 물탱크가 +y — 부스 뒷벽이 북쪽이라 회전 없이 붙는다.
#
# 원본(toilet_bowl.obj)은 10만 삼각형이라 6개를 그대로 넣으면 Z2가 69만이 되고
# **W를 3초 눌러도 15m가 아니라 6.4m밖에 못 간다**(feel.spec). Decimate 0.10 으로
# 1만까지 줄였다 — 부스 안에서 보는 크기라 형상 차이가 안 보인다.
TOILET_MESH = "WC_TOILET"
TOILET_BACK_OFF = 0.357      # 원점에서 탱크 뒷면까지 (+y)
TOILET_X_OFF = 0.027         # 원점에서 좌우 중심까지 (+x)


def place_toilets(spots):
    """(부스 중심x, 뒷벽y) 목록에 변기를 놓는다. 메시가 없으면 건너뛴다."""
    mesh = bpy.data.meshes.get(TOILET_MESH)
    for o in [o for o in bpy.data.objects if o.name.startswith("Z2_OBJ14_toilet")]:
        bpy.data.objects.remove(o, do_unlink=True)
    if mesh is None:
        print("  ⚠ WC_TOILET 메시 없음 — 변기 생략")
        return 0
    for i, (cx, back_y) in enumerate(spots):
        ob = bpy.data.objects.new(f"Z2_OBJ14_toilet{i}", mesh)   # 메시 공유
        ob.location = (cx - TOILET_X_OFF, back_y - 0.02 - TOILET_BACK_OFF, FLOOR)
        COLL.objects.link(ob)
    return len(spots)


# ─────────────────────────── 조립 ───────────────────────────

tile, part, fixt, cntr, metal, light = [], [], [], [], [], []
toilets = []          # (부스 중심x, 뒷벽y)
mirror = []           # (x0, z0, x1, z1, y) — 단면 평면

# 남측 벽 — 출입구 3곳만 뚫는다
cuts = sorted(DOORS.values())
edges = [X0] + [v for c in cuts for v in c] + [X1]
for i in range(0, len(edges) - 1, 2):
    a, b = edges[i], edges[i + 1]
    if b > a:
        tile.append((a, Y0, FLOOR, b, Y0 + T, CEIL))
# 출입구 상부 인방. 유효고 2.10m — 그 위 0.70m가 사인 자리다.
# 벽 상단이 FLOOR+2.80(CEIL)뿐이라, 인방을 더 올리면 사인을 붙일 데가 없어진다.
DOOR_H = 2.10
for a, b in cuts:
    tile.append((a, Y0, FLOOR + DOOR_H, b, Y0 + T, CEIL))

tile += [
    (X0, Y1 - T, FLOOR, X1, Y1, CEIL),          # 북 (개찰층 북벽에 접함)
    (X0, Y0, FLOOR, X0 + T, Y1, CEIL),          # 서
    (X1 - T, Y0, FLOOR, X1, Y1, CEIL),          # 동
    (DIV_M_F - T / 2, Y0, FLOOR, DIV_M_F + T / 2, Y1, CEIL),   # 남|여
    (DIV_F_A - T / 2, Y0, FLOOR, DIV_F_A + T / 2, Y1, CEIL),   # 여|다목적
]
# 천장
tile.append((X0, Y0, CEIL, X1, Y1, CEIL + 0.10))
# 바닥은 따로 깔지 않는다 — 개찰층 바닥(ST_FLOOR)이 그대로 이어진다.
# 마감을 다르게 주려면 머티리얼이 한 종 더 늘고, 그만큼 드로우 콜이 는다.

# ── 남자 화장실 ───────────────────────────────────────────────
MX0, MX1 = X0 + T, DIV_M_F - T / 2
part.append((SCREEN_M, Y0 + T, FLOOR, SCREEN_M + 0.20, 26.60, FLOOR + 2.00))   # 가림벽

for (a, b) in booths(MX0, SCREEN_M, 3):                             # 부스 3칸
    part.append((a, BOOTH_Y0, FLOOR + 0.15, a + PART_T, BOOTH_Y1, FLOOR + 1.90))
    part.append((a + 0.06, BOOTH_Y0, FLOOR + 0.15, b - 0.06, BOOTH_Y0 + PART_T, FLOOR + 1.90))  # 문
    toilets.append(((a + b) / 2, BOOTH_Y1))
part.append((SCREEN_M - PART_T, BOOTH_Y0, FLOOR + 0.15, SCREEN_M, BOOTH_Y1, FLOOR + 1.90))

for i in range(3):                                                   # 소변기 3기 (간격 0.78)
    y = 26.35 + i * 0.78
    fixt.append((MX1 - 0.34, y - 0.16, FLOOR + 0.60, MX1, y + 0.16, FLOOR + 1.28))
    if i:
        part.append((MX1 - 0.42, y - 0.39 - PART_T / 2, FLOOR + 0.55,
                     MX1, y - 0.39 + PART_T / 2, FLOOR + 1.70))

cntr.append((MX0 + 0.20, Y0 + T, COUNTER_Z - 0.05, MX0 + 2.75, COUNTER_Y1, COUNTER_Z))
for i in range(4):                                                   # 세면기 볼
    x = MX0 + 0.55 + i * 0.55
    fixt.append((x - 0.20, Y0 + T + 0.08, COUNTER_Z - 0.16, x + 0.20, COUNTER_Y1 - 0.08, COUNTER_Z - 0.05))
    metal.append((x - 0.02, Y0 + T + 0.04, COUNTER_Z, x + 0.02, Y0 + T + 0.10, COUNTER_Z + 0.16))
mirror.append((MX0 + 0.20, COUNTER_Z + 0.15, MX0 + 2.75, COUNTER_Z + 0.95, Y0 + T + 0.012))

# ── 여자 화장실 ───────────────────────────────────────────────
FX0, FX1 = DIV_M_F + T / 2, DIV_F_A - T / 2
part.append((SCREEN_F, Y0 + T, FLOOR, SCREEN_F + 0.20, 26.60, FLOOR + 2.00))   # 가림벽

for (a, b) in booths(FX0, SCREEN_F, 4):                             # 부스 4칸
    part.append((a, BOOTH_Y0, FLOOR + 0.15, a + PART_T, BOOTH_Y1, FLOOR + 1.90))
    part.append((a + 0.06, BOOTH_Y0, FLOOR + 0.15, b - 0.06, BOOTH_Y0 + PART_T, FLOOR + 1.90))
    toilets.append(((a + b) / 2, BOOTH_Y1))
part.append((SCREEN_F - PART_T, BOOTH_Y0, FLOOR + 0.15, SCREEN_F, BOOTH_Y1, FLOOR + 1.90))

cntr.append((FX0 + 0.20, Y0 + T, COUNTER_Z - 0.05, FX0 + 3.30, COUNTER_Y1, COUNTER_Z))
for i in range(5):
    x = FX0 + 0.55 + i * 0.55
    fixt.append((x - 0.20, Y0 + T + 0.08, COUNTER_Z - 0.16, x + 0.20, COUNTER_Y1 - 0.08, COUNTER_Z - 0.05))
    metal.append((x - 0.02, Y0 + T + 0.04, COUNTER_Z, x + 0.02, Y0 + T + 0.10, COUNTER_Z + 0.16))
mirror.append((FX0 + 0.20, COUNTER_Z + 0.15, FX0 + 3.30, COUNTER_Z + 0.95, Y0 + T + 0.012))

# ── 다목적 화장실 ─────────────────────────────────────────────
AX0, AX1 = DIV_F_A + T / 2, X1 - T
toilets.append((AX0 + 0.50, Y1 - T))
cntr.append((AX1 - 0.70, Y0 + T, COUNTER_Z - 0.05, AX1, COUNTER_Y1, COUNTER_Z))
fixt.append((AX1 - 0.58, Y0 + T + 0.08, COUNTER_Z - 0.16, AX1 - 0.18, COUNTER_Y1 - 0.08, COUNTER_Z - 0.05))
mirror.append((AX1 - 0.70, COUNTER_Z + 0.15, AX1, COUNTER_Z + 0.95, Y0 + T + 0.012))
# 안전 손잡이 — 다목적 화장실을 다목적으로 읽히게 하는 유일한 단서다
metal += [
    (AX0 + 0.10, Y1 - T - 0.70, FLOOR + 0.75, AX0 + 0.14, Y1 - T - 0.10, FLOOR + 0.79),
    (AX0 + 0.84, Y1 - T - 0.70, FLOOR + 0.75, AX0 + 0.88, Y1 - T - 0.10, FLOOR + 0.79),
]

# ── 조명 ─────────────────────────────────────────────────────
for a, b in ((X0 + T, DIV_M_F), (DIV_M_F, DIV_F_A), (DIV_F_A, X1 - T)):
    light.append((a + 0.4, 27.4, CEIL - 0.06, b - 0.4, 27.7, CEIL))
    light.append((a + 0.4, 28.9, CEIL - 0.06, b - 0.4, 29.2, CEIL))

emit("Z2_OBJ14_shell", tile, M_TILE)
emit("Z2_OBJ14_part", part, M_PART)
emit("Z2_OBJ14_fixture", fixt, M_FIX)
emit("Z2_OBJ14_counter", cntr, M_CNTR)
emit("Z2_OBJ14_metal", metal, M_METAL)
emit_planes("Z2_OBJ14_mirror", mirror, M_MIRROR)
emit("Z2_OBJ14_mirrorframe",
     [b for (x0, z0, x1, z1, y) in mirror for b in (
         (x0 - 0.03, Y0 + T, z0 - 0.03, x1 + 0.03, y, z0),
         (x0 - 0.03, Y0 + T, z1, x1 + 0.03, y, z1 + 0.03),
         (x0 - 0.03, Y0 + T, z0, x0, y, z1),
         (x1, Y0 + T, z0, x1 + 0.03, y, z1),
     )], M_METAL)
emit("Z2_OBJ14_light", light, M_LIGHT)
n_toilet = place_toilets(toilets)


# ─────────────────────────── 사인 ───────────────────────────
# 글자면은 **-Y(개찰층 쪽)를 향해야** 한다. rotZ를 π로 두면 +Y를 향해 뒷면이 보이고,
# 게임은 백페이스를 걷어내므로 아예 안 보인다. Blender에서는 좌우 반전된 글씨로 보인다.
FACE_S = (1.5708, 0.0, 0.0)
SIGN_Y = Y0 - 0.05
PIC = {"M": "WC_BLUE", "F": "WC_RED", "A": "LINE2_GRN"}
LABEL = {"M": "남자", "F": "여자", "A": "다목적"}

plate, pics = [], {}
for k, (a, b) in DOORS.items():
    plate.append((a - 0.10, SIGN_Y, FLOOR + 2.16, b + 0.10, Y0, FLOOR + 2.72))
    cx = (a + b) / 2
    pics.setdefault(PIC[k], []).append(
        (cx - 0.16, SIGN_Y - 0.015, FLOOR + 2.38, cx + 0.16, SIGN_Y, FLOOR + 2.68))
plate.append((42.90, SIGN_Y, FLOOR + 1.86, 45.60, Y0, FLOOR + 2.72))   # 큰 안내 사인
emit("Z2_OBJ14_signplate", plate, bpy.data.materials["SIGN_INFO"])
for col, bl in pics.items():
    emit(f"Z2_OBJ14_pic_{col.split('_')[-1].lower()}", bl, bpy.data.materials[col])

FONT = bpy.data.fonts["Malgun Gothic Bold"]


def text(name, body, x, z, size, matname):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    cu = bpy.data.curves.new(name, type="FONT")
    cu.body, cu.font, cu.size = body, FONT, size
    cu.align_x = cu.align_y = "CENTER"
    cu.extrude = 0.003
    cu.resolution_u = 1          # 글리프 분할 수가 glTF 용량을 지배한다
    cu.materials.append(bpy.data.materials[matname])
    ob = bpy.data.objects.new(name, cu)
    ob.location = (x, Y0 - 0.075, z)
    ob.rotation_euler = FACE_S
    COLL.objects.link(ob)
    return ob


for k, (a, b) in DOORS.items():
    text(f"Z2_OBJ14_txt_{k.lower()}", LABEL[k], (a + b) / 2, FLOOR + 2.26, 0.085, "TXT_WHITE")
text("Z2_OBJ14_txt_kr", "화 장 실", 44.25, FLOOR + 2.44, 0.20, "TXT_WHITE")
text("Z2_OBJ14_txt_en", "Restroom", 44.25, FLOOR + 2.10, 0.11, "TXT_WHITE")

# ── 옛 통짜 박스·잔재 철거 ────────────────────────────────────
for n in ("Z2_OBJ14_room", "Z2_OBJ14_frame", "Z2_OBJ14_dark",
          "Z2_OBJ14_picM", "Z2_OBJ14_picF", "Z2_OBJ14_sign", "Z2_OBJ14_txt",
          "Z2_OBJ14_band", "Z2_OBJ14_floor", "Z2_OBJ14_pic_green"):
    o = bpy.data.objects.get(n)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)

print(f"화장실 재건 — 벽 {len(tile)} · 칸막이 {len(part)} · 위생기구 {len(fixt)} 박스 · 양변기 {n_toilet}")
print(f"  남 {X0:.1f}~{DIV_M_F:.1f} · 여 {DIV_M_F:.1f}~{DIV_F_A:.1f} · 다목적 {DIV_F_A:.1f}~{X1:.1f}")
print("  출입구: " + " · ".join(f"{k} x[{a:.2f},{b:.2f}]" for k, (a, b) in DOORS.items()))
print("  새 머티리얼 2종만 사용 (WC_PART · WC_FIX)")
