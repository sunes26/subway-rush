"""
모서리 챔퍼 패스 — "너무 사각형"을 없애는 기법.

레퍼런스(TurboSquid 1402902)를 확대해 보면 기둥 모서리, 카운터 모서리, 사인 프레임이
전부 **모따기**돼 있다. 상용 인테리어 모델이 공통으로 하는 일이고, 사진처럼 보이는
이유의 큰 몫이다. 현실에 완전한 직각 모서리는 없다 — 판재는 접히고 압출재는 둥글다.

우리 렌더러는 툰 셰이딩이라 효과가 오히려 더 크다. 1.2cm 챔퍼 하나가 면을 하나 더
만들고, 그 면은 인접 두 면과 **다른 밝기 단계**로 칠해진다. 결과적으로 모서리마다
가는 하이라이트 선이 생겨 상자가 '만들어진 물건'으로 읽힌다.

전부에 걸면 안 된다.
  · 바닥·천장 패널처럼 **면으로 읽히는 것**은 모따기해도 안 보이고 삼각형만 먹는다
  · 이미 둥근 것(기둥·유리)은 대상이 아니다
  · 아주 얇은 판(두께 < 챔퍼 × 2)은 모따기가 판을 먹어 버린다 — 폭을 두께에 맞춰 줄인다

그래서 **가까이서 보는 각진 물건**만 고른다: 상가 집기, 광고 프레임, 사인 케이스,
계산대, 냉장고.

    exec(open(r"C:\\Users\\User\\Documents\\HACKERTON\\tools\\bevel_pass.py").read())
"""

import bpy

WIDTH = 0.012          # 챔퍼 폭 (1.2 cm)
ANGLE = 0.61           # 35° 이상 꺾인 모서리만
MARK = "_bev"          # 이미 처리한 메시 표시

# 대상 — 이름 접두사. 여기 없는 것은 건드리지 않는다.
TARGETS = (
    "Z2_SHOP_",        # 상가 집기·파사드 프레임
    "Z2_DET_",         # 대합실 광고 프레임·바닥 데칼 테두리
    "Z3_DET_",         # 개찰구 나가는곳 사인
    "Z4_DET_",         # 통로 광고·방면 사인·난간동자
    "Z5_DET_",         # 승강장 매달림 광고·끝단
)
# 제외 — 면으로 읽히거나 이미 얇아서 얻는 게 없는 것
SKIP = ("_ST_GLASS", "_VM_GLASS", "_TXT_WHITE", "_PSD_GREEN", "_ST_CEIL")


def main():
    done, tri0, tri1 = 0, 0, 0
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            continue
        if not o.name.startswith(TARGETS):
            continue
        if any(s in o.name for s in SKIP):
            continue
        if o.data.get(MARK):
            continue

        n0 = sum(len(p.vertices) - 2 for p in o.data.polygons)
        # 얇은 판에 폭을 그대로 주면 모따기가 판을 갉아먹어 형상이 무너진다.
        # 최소 변 길이의 1/3 을 넘지 않게 잡는다.
        dims = [d for d in o.dimensions if d > 1e-4]
        w = min(WIDTH, (min(dims) / 3.0) if dims else WIDTH)
        if w < 0.002:
            continue
        m = o.modifiers.new("bev", "BEVEL")
        m.width = w
        m.segments = 1
        m.limit_method = "ANGLE"
        m.angle_limit = ANGLE
        m.harden_normals = False
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.ops.object.modifier_apply(modifier="bev")
        o.data[MARK] = True
        n1 = sum(len(p.vertices) - 2 for p in o.data.polygons)
        tri0 += n0
        tri1 += n1
        done += 1

    print(f"챔퍼 패스 — 오브젝트 {done}개 · 삼각형 {tri0:,} → {tri1:,} (+{tri1 - tri0:,})")


main()
