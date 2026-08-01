"""
Z2 대합실 상가 재건 — 파사드 · 간판 · 내부 집기.

수정 전 상태가 이 맵에서 가장 나빴다. 순회 사진 `09-z2-shops` 를 보면
**흰 빈 상자에 색 띠 하나**가 전부다. 유리 너머가 텅 비어 있으니 점포로 안 읽히고,
간판이 벽면과 같은 평면이라 깊이도 없다.

실사 홍대입구 대합실 기준으로 다시 짓는다.

  편의점 : 뒷벽 음료 냉장고(유리문·내부 발광) · 곤돌라 2열 · 입구 옆 계산대 · 돌출 간판
  카페   : 진열 쇼케이스(발광) · 백카운터와 에스프레소 머신 · 백라이트 메뉴보드 ·
           창가 바 카운터와 스툴

**새 머티리얼을 한 개도 만들지 않는다.** 로더가 머티리얼별로 병합하므로 새 머티리얼은
곧 드로우 콜이고, Z2 는 예산 200 중 194 를 이미 쓰고 있다. 여기 쓰는 것은 전부
이미 Z2 에 있던 것들이다(VM_* 는 자판기, ST_COUNTER 는 매표 창구에서 온다).

    exec(open(r"C:\\Users\\User\\Documents\\HACKERTON\\tools\\build_shops.py").read())
"""

import bpy

COLL = "Z2_CONCOURSE"
FLOOR = -6.00
FRONT = 25.75          # 유리 파사드 면 (대합실 쪽 = -y)
BACK = 29.95
SHOP_CEIL = -3.15

# 자재는 전부 기존 것
M_GLASS, M_FRAME = "ST_GLASS", "BN_FRAME"
M_SHELF, M_GOODS = "SH_SHELF", "SH_GOODS"
M_COUNTER, M_DARK = "ST_COUNTER", "TXT_DARK"
M_LIT, M_COOL = "VM_LIGHT", "VM_GLASS"
M_TRIM = "VM_TRIM"
M_CAN = ("VM_CAN_A", "VM_CAN_B", "VM_CAN_C")
M_CEIL, M_LAMP = "ST_CEIL", "FIXTURE"
M_TXT = "TXT_WHITE"


class Acc:
    """머티리얼별 정점·면 누산기. 한 머티리얼 = 한 오브젝트 = (병합 후) 한 드로우 콜."""

    def __init__(self):
        self.d = {}

    def box(self, mat, x0, y0, z0, x1, y1, z1):
        """감김은 전부 **바깥**을 향한다 — 게임이 `FrontSide` 컬링이라 뒤집히면
        바깥 면이 잘리고 반대쪽 안쪽 면이 대신 보인다 (build_ceiling.py `_box` 주석 참고)."""
        v, f = self.d.setdefault(mat, ([], []))
        n = len(v)
        v += [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
              (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        f += [(n + 3, n + 2, n + 1, n), (n + 4, n + 5, n + 6, n + 7),
              (n + 1, n + 5, n + 4, n), (n + 2, n + 6, n + 5, n + 1),
              (n + 3, n + 7, n + 6, n + 2), (n, n + 4, n + 7, n + 3)]

    def emit(self, prefix):
        made = 0
        for mat, (v, f) in self.d.items():
            name = f"{prefix}_{mat}"
            old = bpy.data.objects.get(name)
            if old:
                bpy.data.objects.remove(old, do_unlink=True)
            me = bpy.data.meshes.new(name)
            me.from_pydata(v, [], f)
            me.validate()
            me.update()
            me.materials.append(bpy.data.materials[mat])
            for p in me.polygons:
                p.use_smooth = False
            ob = bpy.data.objects.new(name, me)
            bpy.data.collections[COLL].objects.link(ob)
            made += 1
        return made


def text(name, body, x, y, z, size, matname, rot_z=0.0):
    """rotX(90°)만 걸면 글자가 **-y 를 향하고 +x 로 읽힌다** — 대합실(-y)에서 보는 방향이다.
    여기에 rotZ(π)를 더하면 +y 를 향해 거울상이 된다. 기본값을 π 로 뒀다가 실제로 뒤집혔다.
    """
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    cu = bpy.data.curves.new(name, type="FONT")
    cu.body = body
    cu.font = bpy.data.fonts["Malgun Gothic Bold"]
    cu.size = size
    cu.align_x = cu.align_y = "CENTER"
    cu.extrude = 0.002
    cu.resolution_u = 1
    cu.materials.append(bpy.data.materials[matname])
    ob = bpy.data.objects.new(name, cu)
    ob.location = (x, y, z)
    ob.rotation_euler = (1.5707963, 0.0, rot_z)
    bpy.data.collections[COLL].objects.link(ob)
    return ob


def facade(a, x0, x1, door0, door1, sign_mat, blade_mat):
    """유리 파사드 + 문틀 + 출입 개구부 + 돌출 간판.

    개구부를 뚫는 이유는 통행이 아니라 **시선**이다. 유리 한 장으로 막아 두면
    안이 반사판처럼 보여 내부를 아무리 채워도 티가 안 난다.
    돌출 간판(파사드에 직각)은 한국 지하상가의 특징이면서, 벽면이 통짜 평면으로
    보이는 것을 깨 주는 가장 싼 수단이다.
    """
    top = -3.42
    # 유리 — 문 구간을 비운다
    for (a0, a1) in ((x0 + 0.06, door0), (door1, x1 - 0.06)):
        if a1 - a0 > 0.1:
            a.box(M_GLASS, a0, FRONT, FLOOR + 0.10, a1, FRONT + 0.04, top - 0.10)
    # 하부 걸레받이 · 상부 인방 · 세로 문설주
    a.box(M_FRAME, x0, FRONT - 0.02, FLOOR, x1, FRONT + 0.06, FLOOR + 0.10)
    a.box(M_FRAME, x0, FRONT - 0.02, top - 0.10, x1, FRONT + 0.06, top)
    # 문설주는 가늘어야 한다. 0.04 로 뒀더니 실내를 가리는 검은 기둥 다섯 개가 됐다 —
    # 실제 점포 새시는 손가락 두 개 폭이다.
    for mx in [x0, door0, door1, x1] + [x0 + (door0 - x0) * t for t in (0.5,)]:
        a.box(M_FRAME, mx - 0.026, FRONT - 0.02, FLOOR, mx + 0.026, FRONT + 0.06, top)
    # 출입구 상부 헤더
    a.box(M_FRAME, door0, FRONT - 0.02, top - 0.42, door1, FRONT + 0.06, top - 0.10)

    # 창 상부 조명 밴드 — 실제 점포는 쇼윈도 위에 조명이 숨어 있다.
    # 천장 다운라이트만으로는 유리 너머가 어두워 애써 채운 내부가 안 읽혔다.
    a.box(M_LAMP, x0 + 0.10, FRONT + 0.12, top - 0.30, x1 - 0.10, FRONT + 0.32, top - 0.18)
    a.box(M_FRAME, x0 + 0.08, FRONT + 0.10, top - 0.18, x1 - 0.08, FRONT + 0.34, top - 0.10)

    # 돌출 간판 — 파사드에서 0.55m 튀어나온 양면 블레이드
    cx = (x0 + x1) / 2
    a.box(blade_mat, cx - 0.03, FRONT - 0.62, -4.30, cx + 0.03, FRONT - 0.06, -3.55)
    a.box(M_FRAME, cx - 0.05, FRONT - 0.66, -3.60, cx + 0.05, FRONT - 0.02, -3.52)
    return sign_mat


def shop_ceiling(a, x0, x1, lamps):
    a.box(M_CEIL, x0 + 0.05, FRONT + 0.06, SHOP_CEIL, x1 - 0.05, BACK, SHOP_CEIL + 0.12)
    for (lx, ly) in lamps:
        a.box(M_LAMP, lx - 0.28, ly - 0.14, SHOP_CEIL - 0.03, lx + 0.28, ly + 0.14, SHOP_CEIL)


def cvs(a, x0=21.5, x1=26.5):
    """편의점 — 뒷벽 냉장고 · 곤돌라 2열 · 계산대."""
    door0, door1 = x1 - 1.15, x1 - 0.25
    facade(a, x0, x1, door0, door1, "SH_GREEN", "SH_GREEN")
    shop_ceiling(a, x0, x1, [(x0 + 1.3, 26.5), (x0 + 3.6, 26.5),
                             (x0 + 1.3, 27.9), (x0 + 3.6, 27.9),
                             (x0 + 1.3, 29.2), (x0 + 3.6, 29.2)])

    # 음료 냉장고 5칸 — 유리문 안쪽이 밝아야 '켜져 있는 가게'로 읽힌다
    n = 5
    w = (x1 - x0 - 0.5) / n
    for i in range(n):
        cx = x0 + 0.25 + i * w
        a.box(M_TRIM, cx, BACK - 0.75, FLOOR, cx + w, BACK - 0.05, FLOOR + 2.05)
        a.box(M_LIT, cx + 0.05, BACK - 0.70, FLOOR + 0.08, cx + w - 0.05, BACK - 0.10, FLOOR + 1.97)
        # 캔 진열 4단
        for r in range(4):
            z = FLOOR + 0.22 + r * 0.44
            a.box(M_CAN[(i + r) % 3], cx + 0.10, BACK - 0.62, z, cx + w - 0.10, BACK - 0.34, z + 0.26)
        a.box(M_COOL, cx + 0.04, BACK - 0.78, FLOOR + 0.06, cx + w - 0.04, BACK - 0.75, FLOOR + 1.99)

    # 곤돌라 2열 — 양면 진열대
    for gx in (x0 + 1.35, x0 + 3.15):
        a.box(M_SHELF, gx - 0.42, 26.70, FLOOR, gx + 0.42, 28.90, FLOOR + 0.12)
        a.box(M_SHELF, gx - 0.06, 26.70, FLOOR, gx + 0.06, 28.90, FLOOR + 1.55)
        for r in range(4):
            z = FLOOR + 0.42 + r * 0.36
            a.box(M_SHELF, gx - 0.42, 26.70, z, gx + 0.42, 28.90, z + 0.03)
            for k in range(5):
                y = 26.78 + k * 0.42
                a.box(M_GOODS if (r + k) % 2 else M_CAN[k % 3],
                      gx - 0.36, y, z + 0.03, gx - 0.06, y + 0.34, z + 0.28)
                a.box(M_CAN[(r + k) % 3] if (r + k) % 2 else M_GOODS,
                      gx + 0.06, y, z + 0.03, gx + 0.36, y + 0.34, z + 0.28)

    # 계산대 — 입구 안쪽. POS 화면이 켜져 있다
    a.box(M_COUNTER, x1 - 1.95, 26.05, FLOOR, x1 - 0.35, 26.75, FLOOR + 0.95)
    a.box(M_SHELF, x1 - 1.98, 26.02, FLOOR + 0.95, x1 - 0.32, 26.78, FLOOR + 1.00)
    a.box(M_DARK, x1 - 1.30, 26.20, FLOOR + 1.00, x1 - 0.90, 26.55, FLOOR + 1.36)
    a.box(M_LIT, x1 - 1.28, 26.18, FLOOR + 1.06, x1 - 0.92, 26.20, FLOOR + 1.32)


def cafe(a, x0=27.0, x1=32.0):
    """카페 — 진열 쇼케이스 · 백카운터 · 메뉴보드 · 창가 바."""
    door0, door1 = x0 + 0.25, x0 + 1.15
    facade(a, x0, x1, door0, door1, "SH_RED", "SH_RED")
    shop_ceiling(a, x0, x1, [(x0 + 1.4, 26.5), (x0 + 3.6, 26.5),
                             (x0 + 1.4, 27.9), (x0 + 3.6, 27.9),
                             (x0 + 1.4, 29.2), (x0 + 3.6, 29.2)])

    # 진열 쇼케이스 — 몸통 + 유리 + 내부 발광 + 빵
    cs0, cs1 = x0 + 1.45, x0 + 4.30
    a.box(M_COUNTER, cs0, 26.30, FLOOR, cs1, 27.05, FLOOR + 0.90)
    a.box(M_LIT, cs0 + 0.05, 26.35, FLOOR + 0.90, cs1 - 0.05, 27.00, FLOOR + 1.02)
    for k in range(7):
        px = cs0 + 0.16 + k * (cs1 - cs0 - 0.32) / 7
        a.box(M_GOODS, px, 26.46, FLOOR + 1.02, px + 0.26, 26.88, FLOOR + 1.14)
    a.box(M_COOL, cs0, 26.28, FLOOR + 0.90, cs1, 26.32, FLOOR + 1.50)
    a.box(M_FRAME, cs0, 26.28, FLOOR + 1.50, cs1, 27.05, FLOOR + 1.56)

    # 계산대
    a.box(M_COUNTER, x1 - 1.70, 26.30, FLOOR, x1 - 0.35, 27.05, FLOOR + 0.98)
    a.box(M_DARK, x1 - 1.25, 26.45, FLOOR + 0.98, x1 - 0.85, 26.80, FLOOR + 1.34)
    a.box(M_LIT, x1 - 1.23, 26.43, FLOOR + 1.04, x1 - 0.87, 26.45, FLOOR + 1.30)

    # 백카운터 + 에스프레소 머신 + 컵 스택
    a.box(M_COUNTER, x0 + 0.35, BACK - 0.70, FLOOR, x1 - 0.35, BACK - 0.05, FLOOR + 0.92)
    a.box(M_TRIM, x0 + 1.20, BACK - 0.62, FLOOR + 0.92, x0 + 2.05, BACK - 0.18, FLOOR + 1.44)
    a.box(M_DARK, x0 + 1.28, BACK - 0.64, FLOOR + 1.00, x0 + 1.97, BACK - 0.62, FLOOR + 1.36)
    for k in range(4):
        a.box(M_SHELF, x0 + 2.45 + k * 0.28, BACK - 0.50, FLOOR + 0.92,
              x0 + 2.65 + k * 0.28, BACK - 0.26, FLOOR + 1.20)

    # 백라이트 메뉴보드 3연
    for k in range(3):
        bx = x0 + 0.55 + k * 1.42
        a.box(M_LIT, bx, BACK - 0.06, FLOOR + 1.70, bx + 1.22, BACK - 0.02, FLOOR + 2.55)
        a.box(M_FRAME, bx - 0.04, BACK - 0.09, FLOOR + 1.66, bx + 1.26, BACK - 0.02, FLOOR + 2.59)

    # 창가 바 카운터 + 스툴 — 유리 안쪽에 사람이 앉는 자리가 보이면 가게가 산다
    a.box(M_GOODS, x0 + 1.45, FRONT + 0.10, FLOOR + 1.02, x1 - 0.35, FRONT + 0.55, FLOOR + 1.08)
    for k in range(4):
        sx = x0 + 1.85 + k * 0.85
        a.box(M_TRIM, sx - 0.04, FRONT + 0.28, FLOOR, sx + 0.04, FRONT + 0.36, FLOOR + 0.62)
        a.box(M_COUNTER, sx - 0.18, FRONT + 0.14, FLOOR + 0.62, sx + 0.18, FRONT + 0.50, FLOOR + 0.68)


def main():
    # 옛 파사드·집기는 새 것으로 대체된다
    for suffix in ("glass", "mullion", "fit", "goods"):
        for tag in ("OBJ18_cafe", "OBJ19_cvs"):
            o = bpy.data.objects.get(f"Z2_{tag}_{suffix}")
            if o:
                bpy.data.objects.remove(o, do_unlink=True)
    for o in [o for o in bpy.data.objects if o.name.startswith("Z2_SHOP_")]:
        bpy.data.objects.remove(o, do_unlink=True)

    a = Acc()
    cvs(a)
    cafe(a)
    n = a.emit("Z2_SHOP")

    # 간판 글자를 키우고 돌출 간판에도 넣는다
    text("Z2_OBJ19_cvs_txt", "편의점", 24.0, 25.58, -3.22, 0.26, M_TXT)
    text("Z2_OBJ18_cafe_txt", "카페", 29.5, 25.58, -3.22, 0.26, M_TXT)
    # 돌출 간판은 양면이다 — 한 면만 쓰면 반대쪽에서 접근할 때 빈 판때기로 보인다
    for tag, body, cx, size in (("cvs", "CU", 24.0, 0.20), ("cafe", "CAFE", 29.5, 0.17)):
        for s, sfx in ((-1, "W"), (1, "E")):
            ob = text(f"Z2_SHOP_blade_{tag}{sfx}", body, cx + s * 0.045, FRONT - 0.34,
                      -3.95, size, M_TXT, rot_z=1.5707963 * (3 if s < 0 else 1))
            ob.rotation_euler = (1.5707963, 0.0, 1.5707963 * (3 if s < 0 else 1))

    tri = sum(len(o.data.polygons) * 2 for o in bpy.data.objects
              if o.name.startswith("Z2_SHOP_") and o.type == "MESH")
    print(f"상가 재건 — 머티리얼 {n}종(전부 기존) · 사각면 약 {tri // 2}개")
    print("  편의점: 냉장고 5칸 · 곤돌라 2열(상품 80) · 계산대 · 돌출 간판")
    print("  카페  : 쇼케이스 · 백카운터 · 메뉴보드 3연 · 창가 바 4석")


main()
