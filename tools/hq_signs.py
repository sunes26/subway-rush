"""패스 G — 매달림 방향 사인.

레퍼런스 스크린샷 1·3·6·7 을 보면 어느 시점에서든 화면 안에 **검은 사인판이 최소 한 장**
들어온다. 실사도 같다. 그게 "지하철역 안"이라는 신호를 만드는 가장 값싼 요소인데
우리 맵에는 승강장에만 네 개 있었다.

여기서 대합실 · 통로 · 승강장 진입부에 사인 뱅크를 단다. 한 뱅크는

    검은 판 + 매다는 봉 두 개 + (양면) 픽토그램 · 문안 두 줄 · 화살표

로 이루어진다. 문안은 FONT 로 실제 한글을 넣는다 — 막대만 두면 가까이서 가짜가 된다.

방향 규약 두 가지를 반드시 지킨다.

  * **판은 통로 축에 직각이다.** 통로가 x 축이면 판은 y 로 넓고 x 로 얇다.
    반대로 만들면 걸어오는 방향에서 두께 2 cm 옆면만 보인다.
  * **화살표는 면마다 뒤집는다.** 이건 기하가 아니라 의미다 — 보는 사람의 왼쪽이
    한쪽 면에서는 +y, 반대 면에서는 −y 다. 문안은 뒤집지 않는다.
"""

from __future__ import annotations

import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))
                if "__file__" in dir() else r"C:\Users\User\Documents\HACKERTON\tools")
import hq_lib                                    # noqa: E402
import importlib                                 # noqa: E402
importlib.reload(hq_lib)
from hq_lib import Batch, mat, zone_collection   # noqa: E402

FONT = "Malgun Gothic Bold"

# (컬렉션, 태그, x, y, 판 폭, 천장 z, 좌면 문안, 우면 문안, 좌면 색, 우면 색,
#  좌면 화살표, 우면 화살표)
#   판은 x 로 얇다(통로 축 = x). 양면에 서로 다른 안내를 건다.
#
# 화살표 값은 **월드 y 부호**다. 0 이면 "직진"으로 보고 판 바깥쪽 끝을 가리킨다.
#   ⚠ 예전에는 방향 개념 자체가 없었다 — 화살표가 늘 `sgn` (면의 방향) 쪽을 가리켜서,
#     화장실이 북쪽(y 25~30)에 있는데 사인은 남쪽을 가리키고 있었다.
#     목적지가 통로 옆에 있는 안내는 **좌표에서 부호를 받아야** 한다.
BANKS = [
    ("Z2_CONCOURSE", "z2a", 17.0, 15.0, 3.6, -2.80, "승강장", "출구", "grn", "yel", 0, 0),
    # 화장실 실체는 x 36~51 · y 25~30 → 사인(y 15)에서 **북쪽(+y)**
    ("Z2_CONCOURSE", "z2b", 39.0, 15.0, 3.6, -2.80, "화장실", "출구", "wht", "yel", +1, 0),
    ("Z4_DESCENT", "z4a", 76.5, 6.0, 3.4, -2.80, "승강장", "대합실", "grn", "yel", 0, 0),
    ("Z4_DESCENT", "z4b", 85.0, 6.0, 3.4, -2.80, "신도림 방면", "출구", "grn", "yel", 0, 0),
    ("Z4_DESCENT", "z4c", 93.0, 6.0, 3.4, -2.80, "승강장", "환승", "grn", "wht", 0, 0),
]

TINTS = {
    "grn": ((0.10, 0.72, 0.36), (0.12, 0.85, 0.42)),
    "yel": ((0.96, 0.80, 0.12), (1.00, 0.84, 0.14)),
    "wht": ((0.95, 0.95, 0.93), (0.90, 0.90, 0.88)),
}


def build():
    m_body = mat("HQ_SIGNBANK_BODY", (0.050, 0.055, 0.065), roughness=0.55)
    m_rod = mat("HQ_SIGNBANK_ROD", (0.55, 0.57, 0.59), metallic=0.5, roughness=0.35)
    m_txt = mat("HQ_SIGNBANK_TXT", (0.97, 0.97, 0.95),
                emit=(0.92, 0.92, 0.90), strength=1.0)
    tint_mats = {k: mat(f"HQ_SIGNBANK_{k}", c, emit=e, strength=1.0)
                 for k, (c, e) in TINTS.items()}

    made = 0
    for coll_name, tag, x, y, wid, cz, left, right, lc, rc, la, ra in BANKS:
        coll = zone_collection(coll_name)
        body = Batch(f"{tag}_hq_signbody", m_body)
        rod = Batch(f"{tag}_hq_signrod", m_rod)
        marks = {k: Batch(f"{tag}_hq_sign_{k}", m) for k, m in tint_mats.items()}

        # 하단이 **바닥 위 2.6 m** 여야 한다. 예전 값(z1 = cz−0.26, z0 = z1−0.66)은
        # 하단 2.28 m 라, 사인 바로 밑을 지날 때 판이 눈높이 위를 덮고 매다는 봉은
        # 화면 밖으로 나가 **판만 공중에 뜬 것**으로 읽혔다.
        # `hq_gates._hanging` 과 같은 규약을 쓴다 — 얇게, 천장에 바짝.
        z1 = cz - 0.08
        z0 = z1 - 0.52
        # 판 두께 0.14. 예전 0.09 에서는 글자가 표면에서 1 cm 밖에 안 떠 있어
        # **폴리곤 오프셋이 판을 이겼다** — 반대편 문안이 앞면으로 비쳐
        # "화장실" 옆에 흐린 "출구" 획이 겹쳐 보였다. 실사 매달림 사인도 10~20 cm 다.
        body.box(x - 0.070, y - wid / 2, z0, x + 0.070, y + wid / 2, z1)
        for s in (-1, 1):
            rod.box(x - 0.020, y + s * wid * 0.34 - 0.020, z1,
                    x + 0.020, y + s * wid * 0.34 + 0.020, cz)

        # −x 를 향하는 면(서쪽에서 오는 사람)과 +x 를 향하는 면
        _face(marks[lc], x, -1, y, wid, z0, z1, la, lc)
        _face(marks[rc], x, +1, y, wid, z0, z1, ra, rc)
        _text(coll, f"{tag}_txtW", left, x - 0.082, y - wid * 0.06, (z0 + z1) / 2,
              3 * math.pi / 2, m_txt)
        _text(coll, f"{tag}_txtE", right, x + 0.082, y + wid * 0.06, (z0 + z1) / 2,
              math.pi / 2, m_txt)

        for b in (body, rod):
            b.build(coll)
        # 색이 안 쓰인 면의 Batch 는 비어 있고, `Batch.build()` 는 빈 경우
        # **오브젝트를 안 지운다** — 예전 색의 메시가 그대로 남는다.
        # z2b 우면을 grn → yel 로 바꿨더니 옛 초록 픽토그램이 판 위에 남아
        # "화장실" 옆에 흐린 획으로 비쳤다. 빈 것은 직접 지운다.
        for k, b in marks.items():
            if b.build(coll) is None:
                stale = bpy.data.objects.get(f"{tag}_hq_sign_{k}")
                if stale is not None:
                    bpy.data.objects.remove(stale, do_unlink=True)
        made += 1
    print(f"[hq_signs] 사인 뱅크 {made}개")


def _face(b, x, sgn, cy, wid, z0, z1, adir=0, kind=""):
    """픽토그램 사각과 화살표.

    `adir` 은 화살표가 가리킬 **월드 y 부호**다. 0 이면 "직진"으로 보고 예전처럼
    판 바깥쪽 끝을 가리킨다. 목적지가 통로 옆에 있으면 좌표에서 부호를 받아야 한다 —
    예전에는 늘 `sgn` 을 따라가서 북쪽 화장실을 남쪽으로 안내하고 있었다.
    """
    fx = x + sgn * 0.072
    d = 0.012
    # 흰 면(`wht`)에는 픽토그램을 안 그린다. 흰 바탕에 흰 사각형이라 아무 뜻도 없는
    # **흰 직사각형 한 장**으로만 보인다(디렉터 지적). 색이 있는 면에서만 그린다.
    if kind != "wht":
        px = cy - (adir or sgn) * wid * 0.33
        b.box(min(fx, fx + sgn * d), px - 0.15, z0 + 0.09,
              max(fx, fx + sgn * d), px + 0.15, z1 - 0.09)

    a = adir or sgn
    ax = cy + a * wid * 0.34
    h = (z0 + z1) / 2
    pts = [(ax - a * 0.15, h - 0.09), (ax + a * 0.04, h - 0.09),
           (ax + a * 0.04, h - 0.17), (ax + a * 0.19, h),
           (ax + a * 0.04, h + 0.17), (ax + a * 0.04, h + 0.09),
           (ax - a * 0.15, h + 0.09)]
    b.quad([(fx + sgn * d, u, v) for u, v in _wound(pts, sgn)])


def _wound(pts, sgn):
    """법선이 `sgn`·x 를 향하도록 감김을 맞춘다.

    x = 상수 평면에서 (y, z) 신발끈 부호가 **음수면 법선 −x**, 양수면 +x 다(실측).
    예전에는 "`pts` 가 `sgn` 을 곱해 만들어지니 감김이 저절로 반대가 된다"에 기대고
    있었는데, 화살표 방향을 `adir` 로 분리하는 순간 그 가정이 깨진다 —
    부호가 다른 두 값이 섞이면 어느 쪽으로 감기는지 눈으로는 못 센다. 직접 잰다.
    """
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1]
               - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    return pts if (area > 0) == (sgn > 0) else list(reversed(pts))


def _text(coll, name, body, x, y, z, rot_z, material):
    o = bpy.data.objects.get(name)
    if o is None or o.type != "FONT":
        cu = bpy.data.curves.new(name, type="FONT")
        o = bpy.data.objects.new(name, cu)
        coll.objects.link(o)
    cu = o.data
    cu.body = body
    cu.font = bpy.data.fonts.get(FONT) or cu.font
    cu.size = 0.20
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.extrude = 0.003
    cu.resolution_u = 1
    cu.materials.clear()
    cu.materials.append(material)
    o.location = (x, y, z)
    o.rotation_euler = (math.pi / 2, 0.0, rot_z)


build()
