"""
천장 재구성 — 격자 패널 · 매입 조명 트로퍼 · 환기 그릴.

레퍼런스(TurboSquid 1402902)와 실사 홍대입구를 대조한 결과, 우리 천장이 가장 크게
어긋난 부분이었다.

  · 실사 홍대입구 2호선 : 흰 각형 패널을 T-바로 나눈 **격자**. 그 사이로 연속 슬롯 조명
                          2~3열이 통로 방향으로 달리고, 어두운 환기 그릴이 규칙적으로 낀다.
  · 우리(수정 전)       : Z5 는 x 방향 리브만 167개(선형 루버), Z4 는 **아무것도 없는 평면**.
                          위를 올려다보면 색만 다른 판때기라 실내로 안 읽혔다.

리브를 격자로 바꾸는 것만으로 인상이 크게 달라진다. 천장은 1인칭 시야의 위쪽 1/3을
항상 차지하는데, 그 면적 전체가 무늬 없는 단색이었다.

    exec(open(r"C:\\Users\\User\\Documents\\HACKERTON\\tools\\build_ceiling.py").read())

드로우 콜은 늘지 않는다 — 전부 기존 머티리얼(CEIL_RIB · FIXTURE · DUCT)만 쓴다.
로더가 머티리얼별로 병합하므로 오브젝트를 몇 개로 쪼개든 콜 수는 머티리얼 종류가 정한다.
"""

import bpy

CELL = 1.20        # 격자 한 칸 (실사 텐바 간격)
BAR_W = 0.050      # T-바 폭
BAR_D = 0.045      # 바가 패널 아래로 내려오는 깊이

TROF_W = 0.36      # 조명 하우징 폭
TROF_D = 0.10      # 하우징 깊이
LAMP_W = 0.28      # 발광면 폭

VENT_W, VENT_L = 0.60, 1.10    # 환기 그릴
VENT_SLATS = 5

MAT_BAR = "CEIL_RIB"
MAT_LAMP = "FIXTURE"
MAT_DARK = "DUCT"


def _mesh(name, verts, faces, matname, collname):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    if not verts:
        return None
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    me.materials.append(bpy.data.materials[matname])
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    bpy.data.collections[collname].objects.link(ob)
    return ob


def _box(acc, x0, y0, z0, x1, y1, z1):
    """축 정렬 상자를 (verts, faces) 누산기에 넣는다.

    ⚠ 감김 방향이 전부 **바깥**을 향해야 한다. 게임은 three 기본값인 `FrontSide` 컬링이라
    안팎이 뒤집힌 상자는 바깥 면이 잘리고 **반대쪽 안쪽 면**이 대신 보인다.
    얇은 판이면 색은 비슷해서 눈치채기 어려운데, 판을 겹쳐 놓는 순간 드러난다 —
    초록 사인판 안에 검은 테두리 판을 넣었더니 검은 판의 먼 쪽 안쪽 면이
    초록보다 앞에 와서 **사인 전체가 검게** 나왔다.
    """
    v, f = acc
    n = len(v)
    v += [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
          (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f += [(n + 3, n + 2, n + 1, n), (n + 4, n + 5, n + 6, n + 7),
          (n + 1, n + 5, n + 4, n), (n + 2, n + 6, n + 5, n + 1),
          (n + 3, n + 7, n + 6, n + 2), (n, n + 4, n + 7, n + 3)]


def _bands(lo, hi, cell):
    """lo~hi 를 cell 로 나눈 격자선 좌표. 양 끝은 벽에 묻히므로 안쪽만."""
    out, k = [], 1
    while lo + k * cell < hi - 0.05:
        out.append(lo + k * cell)
        k += 1
    return out


def _hits(v, bands, half):
    return any(b[0] - half < v < b[1] + half for b in bands)


def grid(zone, coll, x0, x1, y0, y1, z, lights, vents_at=(), long_axis="x"):
    """천장 격자 + 조명 트로퍼 + 환기 그릴.

    `lights` 는 (중심좌표, [(구간시작, 구간끝), …]) 목록이다. 구간을 쪼개서 받는 이유는
    Z5 처럼 천장에 **개구부**(하강 샤프트)가 뚫려 있으면 조명이 허공을 가로지르기 때문이다.
    """
    bars = ([], [])
    # 조명이 지나가는 띠 — 그 위에는 바를 놓지 않는다 (하우징과 겹쳐 z-파이팅)
    lit = [(c - TROF_W / 2 - 0.02, c + TROF_W / 2 + 0.02) for c, _ in lights]

    if long_axis == "x":
        # 통로 방향(x)으로 달리는 바 — 조명 띠는 건너뛴다
        for y in _bands(y0, y1, CELL):
            if _hits(y, lit, 0.0):
                continue
            _box(bars, x0, y - BAR_W / 2, z - BAR_D, x1, y + BAR_W / 2, z)
        # 가로지르는 바 — 조명 띠에서 끊는다
        for x in _bands(x0, x1, CELL):
            segs, cur = [], y0
            for a, b in sorted(lit):
                if b > cur:
                    segs.append((cur, a))
                    cur = b
            segs.append((cur, y1))
            for a, b in segs:
                if b - a > 0.08:
                    _box(bars, x - BAR_W / 2, a, z - BAR_D, x + BAR_W / 2, b, z)
    else:
        for x in _bands(x0, x1, CELL):
            if _hits(x, lit, 0.0):
                continue
            _box(bars, x - BAR_W / 2, y0, z - BAR_D, x + BAR_W / 2, y1, z)
        for y in _bands(y0, y1, CELL):
            segs, cur = [], x0
            for a, b in sorted(lit):
                if b > cur:
                    segs.append((cur, a))
                    cur = b
            segs.append((cur, x1))
            for a, b in segs:
                if b - a > 0.08:
                    _box(bars, a, y - BAR_W / 2, z - BAR_D, b, y + BAR_W / 2, z)

    _mesh(f"{zone}_ceil_grid", bars[0], bars[1], MAT_BAR, coll)

    # 조명 — 하우징(어두운 테두리) + 발광면. 전에는 두께 0.04 짜리 판 한 장이라
    # 천장에 스티커를 붙인 것처럼 보였다.
    hous, lamp = ([], []), ([], [])
    for c, spans in lights:
        for a, b in spans:
            if long_axis == "x":
                _box(hous, a, c - TROF_W / 2, z - TROF_D, b, c + TROF_W / 2, z)
                _box(lamp, a, c - LAMP_W / 2, z - TROF_D + 0.012, b, c + LAMP_W / 2, z - TROF_D + 0.030)
            else:
                _box(hous, c - TROF_W / 2, a, z - TROF_D, c + TROF_W / 2, b, z)
                _box(lamp, c - LAMP_W / 2, a, z - TROF_D + 0.012, c + LAMP_W / 2, b, z - TROF_D + 0.030)
    _mesh(f"{zone}_ceil_trof", hous[0], hous[1], MAT_DARK, coll)
    _mesh(f"{zone}_ceil_lamp", lamp[0], lamp[1], MAT_LAMP, coll)

    # 환기 그릴 — 어두운 오목판 + 슬랫. 흰 천장에 어두운 점이 규칙적으로 찍히면
    # 그것만으로 천장에 '설비가 있다'고 읽힌다.
    vent = ([], [])
    for (vx, vy) in vents_at:
        if long_axis == "x":
            hw, hl = VENT_L / 2, VENT_W / 2
        else:
            hw, hl = VENT_W / 2, VENT_L / 2
        _box(vent, vx - hw, vy - hl, z - 0.02, vx + hw, vy + hl, z)
        for i in range(VENT_SLATS):
            t = (i + 0.5) / VENT_SLATS
            if long_axis == "x":
                sy = vy - hl + 2 * hl * t
                _box(vent, vx - hw + 0.03, sy - 0.018, z - 0.055, vx + hw - 0.03, sy + 0.018, z - 0.02)
            else:
                sx = vx - hw + 2 * hw * t
                _box(vent, sx - 0.018, vy - hl + 0.03, z - 0.055, sx + 0.018, vy + hl - 0.03, z - 0.02)
    _mesh(f"{zone}_ceil_vent", vent[0], vent[1], MAT_DARK, coll)

    n = sum(len(o.data.polygons) for o in bpy.data.objects
            if o.name.startswith(f"{zone}_ceil_") and o.type == "MESH")
    print(f"  {zone}: 격자 {CELL}m · 조명 {len(lights)}열 · 환기 {len(vents_at)}개 · 면 {n}")


def sloped_ribs(name, coll, target, x0, x1, y0, y1, pitch=1.2):
    """경사 소핏(하강부)의 가로 리브.

    기울어진 면에 정사각 격자를 얹으면 셀이 마름모로 찌그러진다. 실제 경사 천장도
    격자가 아니라 **경사 방향에 직교하는 리브**를 쓴다 — 그쪽을 따라간다.

    소핏 높이를 x 에 대한 1차식으로 가정하면 안 된다. 하강부 중간에 **계단참**이 있어
    실제 면이 꺾인다 — 전에 소핏을 곧은 각기둥으로 깎았다가 같은 이유로 어긋났다.
    그래서 실제 면에 **레이를 쏴서** 높이를 읽는다.
    """
    obj = bpy.data.objects[target]
    mw_inv = obj.matrix_world.inverted()
    import mathutils
    acc = ([], [])
    made = 0
    x = x0 + pitch
    dirv = (mw_inv.to_3x3() @ mathutils.Vector((0, 0, 1))).normalized()
    while x < x1 - 0.05:
        # 아래에서 위로 쏴 소핏 하단을 맞힌다
        y = (y0 + y1) / 2
        org = mw_inv @ mathutils.Vector((x, y, -30.0))
        ok, loc, _, _ = obj.ray_cast(org, dirv)
        hitz = (obj.matrix_world @ loc).z if ok else None
        if hitz is not None:
            _box(acc, x - 0.05, y0, hitz - 0.07, x + 0.05, y1, hitz)
            made += 1
        x += pitch
    _mesh(name, acc[0], acc[1], MAT_BAR, coll)
    print(f"  {name}: 경사 리브 {made}개")


def main():
    # 옛 리브·루버는 격자로 대체된다. 남겨두면 같은 자리에서 z-파이팅이 난다.
    for n in ("Z2_ceil_rib", "Z3_ceil_rib", "Z5_ceil_louver",
              "Z2_ceil_light", "Z3_ceil_light", "Z5_ceil_light"):
        o = bpy.data.objects.get(n)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)

    print("천장 재구성")

    grid("Z2", "Z2_CONCOURSE", 0.2, 55.8, 0.2, 29.8, -2.80,
         lights=[(7.0, [(0.6, 55.4)]), (15.5, [(0.6, 55.4)]), (24.0, [(0.6, 21.3)])],
         vents_at=[(x, y) for x in range(4, 56, 8) for y in (4.0, 12.0, 20.0)])

    grid("Z3", "Z3_GATES", 56.2, 71.8, 0.2, 31.8, -2.80,
         lights=[(8.0, [(56.4, 71.6)]), (16.0, [(56.4, 71.6)]), (24.0, [(56.4, 71.6)])],
         vents_at=[(x, y) for x in (60.0, 68.0) for y in (4.0, 12.0, 20.0, 28.0)])

    grid("Z4", "Z4_DESCENT", 72.2, 95.8, 2.2, 11.8, -2.80,
         lights=[(4.5, [(72.4, 95.6)]), (9.5, [(72.4, 95.6)])],
         vents_at=[(x, 7.0) for x in (76.0, 84.0, 92.0)])

    # Z5 는 x 111.8~120.4 가 하강 샤프트 개구부다. 조명을 통으로 깔면 허공을 가로지른다.
    seg = [(78.4, 111.8), (120.4, 205.6)]
    grid("Z5", "Z5_PLATFORM", 78.4, 205.6, 0.3, 11.7, -15.50,
         lights=[(3.0, seg), (9.0, seg)],
         vents_at=[(x, 6.0) for x in range(84, 206, 12) if not 110 < x < 122])

    # x1 은 **계단이 끝나는 곳**까지다. 127.0 은 승강장 천장 개구(x 121)를
    # 6 m 넘어서라 리브가 승강장 위 경사 램프에 얹혔다 — `hq_descent.X1` 이
    # 같은 이유로 이미 120.4 로 내려와 있었는데 여기만 안 따라왔다.
    sloped_ribs("Z4_desc_ribs", "Z4_DESCENT", "Z4_desc_ceil", 96.4, 121.0, 1.1, 9.4)


main()
