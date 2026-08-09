"""AD_PANEL2 원색 보정 — 자체발광 판이 주변에서 튀지 않게.

    "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe" -b ^
        assets\\station_map.blend -P tools\\hq_ad_placeholder.py

★ 처음엔 텍스처(사진 자리 + 캡션)를 물리려 했다 — **이 프로젝트 익스포트
파이프라인이 구조적으로 막는다.** `export_station.py`가 라이트맵 없는
빌드에서는 UV 좌표 자체를 안 내보낸다("로더가 병합 직전에 버리므로" —
export_station.py 주석). UV가 없으면 이미지가 어디에도 매핑이 안 되니
텍스처가 있어도 GLB에 실리지 않는다. 실측(GLB 직접 파싱)으로 확인했다:
Blender 안에서는 Base Color가 정확히 이미지에 링크돼 있는데 익스포트된
`AD_PANEL2.map`은 그대로 null이었다. 텍스처 접근 자체가 이 재질군에는 안
맞는다 — 되돌렸다.

진짜 원인
  `AD_PANEL·AD_PANEL2·AD_PANEL3`는 `render/station.ts`의
  `SELF_LIT_MATERIALS`다 — 조명 영향을 안 받는 `MeshBasicMaterial`로 그려지고
  `toneMapped: false`라 씬의 ACES 톤매핑도 건너뛴다. 나머지 역사 전체가
  톤매핑을 거쳐 차분해진 채로 렌더링되는데, 이 판만 원색을 가공 없이 그대로
  내보내니 유독 튄다 — "벽에 구멍 났다"는 지적은 정확히 이 대비였다.
  세 색 중 `AD_PANEL2`(주황, R=0.72)가 셋 중 가장 채도 높은 채널값이라
  가장 크게 튀었다(파랑 R=0.16·초록 R=0.20과 비교).

수정
  `AD_PANEL2`의 주 채널을 0.72 → 0.55로 낮춰 톤을 다른 둘과 비슷한 강도로
  맞춘다. 형태(사진 자리)는 포기했지만 "튀는 원색"은 없앤다 — 백라이트
  광고판다운 채도는 남기고 신호등처럼 쏘는 느낌만 뺀다.

멱등성
  `hq_lib.mat()`을 그대로 쓴다 — 몇 번을 다시 돌려도 같은 값으로 수렴한다.
"""
from __future__ import annotations

import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))
                if "__file__" in dir() else r"C:\Users\User\Documents\HACKERTON\tools")

from hq_lib import mat  # noqa: E402

# 텍스처를 시도했던 잔재 — 있으면 지운다(멱등: 없으면 그냥 지나간다)
_STALE_NODES = ("AD_PLACEHOLDER_TEX", "AD_PLACEHOLDER_MIX")
_STALE_IMAGES = ("AD_PANEL_placeholder", "AD_PANEL2_placeholder", "AD_PANEL3_placeholder",
                 "ad_panel_placeholder.png")
for _mat_name in ("AD_PANEL", "AD_PANEL2", "AD_PANEL3"):
    _m = bpy.data.materials.get(_mat_name)
    if _m is None or not _m.use_nodes:
        continue
    _nt = _m.node_tree
    _bsdf = next((n for n in _nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if _bsdf is not None and _bsdf.inputs["Base Color"].is_linked:
        _nt.links.remove(_bsdf.inputs["Base Color"].links[0])
    for _name in _STALE_NODES:
        _n = _nt.nodes.get(_name)
        if _n is not None:
            _nt.nodes.remove(_n)
for _img_name in _STALE_IMAGES:
    _img = bpy.data.images.get(_img_name)
    if _img is not None:
        bpy.data.images.remove(_img)

# metallic·roughness 는 원래 값(0.0 · 0.5)을 그대로 넘긴다 — `mat()`은 호출될
# 때마다 이 둘을 무조건 다시 쓰므로, 안 넘기면 함수 기본값(0.6)으로 조용히
# 밀린다. 색만 바꾸는 패스이지 재질 성질을 새로 정하는 자리가 아니다.
mat("AD_PANEL2", (0.55, 0.30, 0.18), metallic=0.0, roughness=0.5)

print("[hq_ad_placeholder] 텍스처 잔재 정리 · AD_PANEL2 원색 보정")
