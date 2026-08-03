"""불필요한 반투명을 걷어낸다. 익스포트 직전에 매번 돌린다.

알파가 1.0 인데 `blend_method` 가 `HASHED`/`BLEND` 인 머티리얼이 씬에 잔뜩 있었다.
두 가지가 깨진다.

**1. 렌더에서 비친다.** `ST_CEIL`(대합실 천장)이 그 상태였다 —
계단 중간에서 앞을 보면 천장 너머로 대합실 바닥과 사람이 그대로 보였다.
알파 해시는 확률적 투과라 알파가 1.0 이어도 깊이 기록이 어긋난다.

**2. glTF `alphaMode` 가 오염된다.** `HASHED` → `MASK`, `BLEND` → `BLEND` 로 나가서
three 가 멀쩡한 재질을 전부 알파 경로로 그린다. 정렬 비용도 들고 순서도 뒤집힌다.

한 번 손으로 고쳤다가 **다시 그 상태로 돌아왔다.** 대화형으로 한 번 고친 것은
어떤 경로로든 유실된다 — 그래서 빌드 순서(`hq_all.py`)에 넣어 매번 강제한다.

진짜 유리(알파 < 1)는 건드리지 않는다. 지금 일곱 종뿐이다.
"""

from __future__ import annotations

import bpy

CUTOFF = 0.999


def build():
    fixed, kept = [], []
    for m in bpy.data.materials:
        if not m.use_nodes:
            if m.blend_method != "OPAQUE":
                m.blend_method = "OPAQUE"
                fixed.append(m.name)
            continue
        bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        alpha = bsdf.inputs["Alpha"].default_value if bsdf else 1.0
        if m.blend_method == "OPAQUE":
            continue
        if alpha >= CUTOFF:
            m.blend_method = "OPAQUE"
            fixed.append(m.name)
        else:
            kept.append(f"{m.name}({alpha:.2f})")
    print(f"[fix_transparency] 불투명으로 되돌림 {len(fixed)}종 · 진짜 유리 {len(kept)}종")
    if fixed:
        head = ", ".join(sorted(fixed)[:8])
        print(f"  되돌림 예: {head}{' …' if len(fixed) > 8 else ''}")
    print(f"  유지: {', '.join(sorted(kept))}")


build()
