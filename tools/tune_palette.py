"""
색조 보정 — 바닥과 벽을 실사 홍대입구 쪽으로.

렌더를 실사와 나란히 놓으면 형태보다 **색온도**가 먼저 어긋난다.
서울 지하철 바닥은 따뜻한 베이지 화강석(테라조)인데 우리 값은 거의 중성 회색이라
같은 조명에서도 차갑고 창고 같은 인상이 났다.

두 곳을 같이 고쳐야 한다.
  · `diffuse_color`      — Blender 뷰포트(Workbench)가 읽는다
  · Principled Base Color — glTF `baseColorFactor` 로 나가고 **게임이 읽는 값**이다
한쪽만 고치면 Blender 와 웹의 색이 갈라진다. 실제로 그렇게 어긋난 적이 있다.

    exec(open(r"C:\\Users\\User\\Documents\\HACKERTON\\tools\\tune_palette.py").read())
"""

import bpy

# 이름 → (r, g, b). 알파는 건드리지 않는다(유리 투명도가 여기 걸려 있다).
TUNE = {
    # 바닥 — 중성 회색 → 베이지 화강석
    "ST_FLOOR":      (0.815, 0.775, 0.695),
    "ST_FLOOR_PAID": (0.780, 0.742, 0.668),
    "PF_FLOOR":      (0.800, 0.762, 0.684),
    "FLOOR_JOINT":   (0.632, 0.598, 0.532),
    # 벽 — 아주 살짝만 따뜻하게. 벽까지 노랗게 하면 조명이 고장난 것처럼 보인다
    "ST_WALL":       (0.872, 0.860, 0.822),
    "PF_WALL":       (0.936, 0.930, 0.902),
    # 천장 격자 바를 패널보다 조금 더 눌러 격자가 눈에 잡히게
    "CEIL_RIB":      (0.690, 0.688, 0.672),
}


def main():
    done = []
    for name, rgb in TUNE.items():
        m = bpy.data.materials.get(name)
        if m is None:
            continue
        a = m.diffuse_color[3]
        old = tuple(round(c, 3) for c in m.diffuse_color[:3])
        m.diffuse_color = (*rgb, a)
        if m.use_nodes:
            b = m.node_tree.nodes.get("Principled BSDF")
            if b:
                ba = b.inputs["Base Color"].default_value[3]
                b.inputs["Base Color"].default_value = (*rgb, ba)
        done.append(f"  {name:14s} {old} → {rgb}")
    print("색조 보정")
    print("\n".join(done))


main()
