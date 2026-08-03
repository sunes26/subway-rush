"""패스 A — 천장 시스템.

레퍼런스를 나란히 놓으면 천장에서 가장 크게 갈렸다. 이유는 단순하다.
**천장이 실내에서 가장 넓은 면**이고, 지금은 그 2,670 m²(Z5)가 24면짜리 상자 하나다.

TurboSquid 1402902의 와이어프레임(스크린샷 10/11)을 보면 폴리곤 절반 가까이가
천장에 들어가 있다 — 슬랫 하나하나가 따로 있고, 조명 코브가 연속으로 흐르고,
덕트와 소핏이 층을 이룬다. 홍대입구역 실사도 결이 같다. 600 격자 천장에
매입 트로퍼 두 줄, 그 사이를 가로지르는 케이블 트레이, 벽에서 꺾여 내려오는 원형 덕트.

그래서 여기서 만드는 것은 여섯 층이다.

    600 서브 티바 → 매입 트로퍼(하우징 + 발광면) → 원형 덕트 + 분기
    → 환기 그릴 → 스피커 · CCTV

스프링클러는 뺐다. 3.2 m 격자로 깔면 존마다 3,000 면이 드는데 천장에 붙은 지름 6 cm 라
눈높이에서 실루엣도 안 남는다 — 프레임 시간이 무너진 뒤 값을 세어 보고 지웠다.

전부 `Batch`에 누적해 존당 메시 예닐곱 개로 끝낸다. 조각 하나를 오브젝트 하나로
만들면 씬이 못 버틴다 — 1,675개에서 이미 Blender가 두 번 죽었다.
"""

from __future__ import annotations

import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))
                if "__file__" in dir() else r"C:\Users\User\Documents\HACKERTON\tools")
import hq_lib                                    # noqa: E402
import importlib                                 # noqa: E402
importlib.reload(hq_lib)
from hq_lib import Batch, frange, mat, zone_collection   # noqa: E402

# ── 구역 정의 ────────────────────────────────────────────────────
# (컬렉션, x0, y0, x1, y1, 천장 밑면 z, 조명 진행축, 조명 열 좌표)
ZONES = [
    ("Z5_PLATFORM", "Z5A", 78.4, 0.30, 205.6, 11.70, -15.50, "x", (2.0, 6.0, 10.0)),
    ("Z5_PLATFORM", "Z5B", 78.4, 20.50, 205.6, 29.70, -15.50, "x", (22.6, 25.7, 28.8)),
    ("Z2_CONCOURSE", "Z2", 0.20, 0.20, 55.80, 29.80, -2.80, "x",
     (3.0, 7.0, 11.0, 15.0, 19.0, 23.0, 27.0)),
    ("Z3_GATES", "Z3", 56.20, 0.20, 71.80, 31.80, -2.80, "y", (58.0, 62.0, 66.0, 70.0)),
    ("Z4_DESCENT", "Z4", 72.20, 2.20, 95.80, 11.80, -2.80, "x", (4.0, 7.0, 10.0)),
]

TEE_PITCH = 0.60          # 600 격자 — 실사 계측
TEE_W, TEE_D = 0.024, 0.022
# 실사 대조(서울 지하철 승강장·통로 사진 다수): 천장 조명은 **폭이 좁고 거의 이어진**
# 매입 라인이다. 우리는 0.62 폭 판을 0.60 씩 띄워 놓아, 눈에 들어오는 것이
# "큰 흰 사각형이 듬성듬성"이었다 — 디렉터가 말한 "너무 사각형 베이스"의 큰 몫이
# 여기였다. 사각형이 문제가 아니라 **사각형이 실물의 두 배 크기이고 개수가 적은 것**이
# 문제다. 폭을 절반 이하로, 틈을 5분의 1로 줄여 라인으로 읽히게 한다.
TROF_W, TROF_H = 0.28, 0.11
TROF_LEN, TROF_GAP = 2.40, 0.12
DUCT_R = 0.22
SPEAKER_PITCH = 8.00
CCTV_PITCH = 16.00
GRILLE_PITCH = 7.20


def build():
    m_tee = mat("HQ_CEIL_TEE", (0.78, 0.78, 0.76), roughness=0.5)
    m_hous = mat("HQ_TROF_HOUSING", (0.66, 0.67, 0.68), metallic=0.25, roughness=0.4)
    m_lamp = mat("HQ_TROF_LIGHT", (1.0, 0.985, 0.945),
                 emit=(1.0, 0.975, 0.925), strength=6.0, roughness=0.9)
    m_duct = mat("HQ_DUCT", (0.70, 0.72, 0.74), metallic=0.30, roughness=0.45)
    m_grill = mat("HQ_GRILLE", (0.42, 0.44, 0.46), metallic=0.35, roughness=0.55)
    m_dev = mat("HQ_CEIL_DEVICE", (0.90, 0.90, 0.88), roughness=0.5)
    m_dark = mat("HQ_CEIL_DARK", (0.13, 0.14, 0.15), roughness=0.7)

    total = 0
    for coll_name, tag, x0, y0, x1, y1, cz, axis, rows in ZONES:
        coll = zone_collection(coll_name)
        tee = Batch(f"{tag}_hq_tee", m_tee)
        hous = Batch(f"{tag}_hq_trof", m_hous)
        lamp = Batch(f"{tag}_hq_troflight", m_lamp)
        duct = Batch(f"{tag}_hq_duct", m_duct)
        grill = Batch(f"{tag}_hq_grille", m_grill)
        dev = Batch(f"{tag}_hq_device", m_dev)
        dark = Batch(f"{tag}_hq_ceilrecess", m_dark)

        _tee_grid(tee, x0, y0, x1, y1, cz)
        _troffers(hous, lamp, dark, x0, y0, x1, y1, cz, axis, rows)
        _ducts(duct, grill, x0, y0, x1, y1, cz, axis)
        _grilles(grill, x0, y0, x1, y1, cz, axis)
        _devices(dev, dark, x0, y0, x1, y1, cz, axis)

        for b in (tee, hous, lamp, duct, grill, dev, dark):
            ob = b.build(coll)
            if ob:
                total += len(ob.data.polygons)
        print(f"  {tag}: 천장 마감 완료")
    print(f"[hq_ceiling] 면 {total:,}개 추가")


# ── 층별 ─────────────────────────────────────────────────────────
def _tee_grid(b: Batch, x0, y0, x1, y1, cz):
    """600 서브 티바. 천장 타일 경계가 읽히게 하는 얕은 리브."""
    for x in frange(x0, x1, TEE_PITCH):
        if x + TEE_W / 2 > x1:
            continue
        b.box(x - TEE_W / 2, y0, cz - TEE_D, x + TEE_W / 2, y1, cz)
    for y in frange(y0, y1, TEE_PITCH):
        if y + TEE_W / 2 > y1:
            continue
        b.box(x0, y - TEE_W / 2, cz - TEE_D, x1, y + TEE_W / 2, cz)


def _troffers(hous: Batch, lamp: Batch, dark: Batch, x0, y0, x1, y1, cz, axis, rows):
    """매입 트로퍼. 하우징 · 발광면 · 반사판 세 겹.

    연속 한 줄로 뽑으면 형광등이 아니라 띠로 보인다. 2.4 m 모듈에 0.6 m 간격을
    두어야 실사처럼 **개별 기구가 줄지어 있는** 리듬이 생긴다.
    """
    span0, span1 = (x0, x1) if axis == "x" else (y0, y1)
    step = TROF_LEN + TROF_GAP
    n = int((span1 - span0) / step)
    start = span0 + ((span1 - span0) - (n * step - TROF_GAP)) / 2
    for r in rows:
        for i in range(n):
            a0 = start + i * step
            a1 = a0 + TROF_LEN
            if axis == "x":
                bx = (a0, r - TROF_W / 2, a1, r + TROF_W / 2)
            else:
                bx = (r - TROF_W / 2, a0, r + TROF_W / 2, a1)
            ax0, ay0, ax1, ay1 = bx
            # 함몰부는 만들지 않는다. 천장 슬래브 **안쪽**이라 어느 시점에서도 안 보이는데
            # 존마다 800면 넘게 먹고 있었다 — 프레임 시간이 무너진 뒤 세어 보고 알았다.
            hous.box(ax0, ay0, cz - TROF_H, ax1, ay1, cz)
            # 확산판은 하우징 **아래로** 튀어나와야 한다. 안쪽에 두면 하우징 바닥면이
            # 앞에 와서 조명이 통째로 잠긴다 — 첫 시도에서 천장이 그대로 어두웠다.
            lamp.box(ax0 + 0.045, ay0 + 0.045, cz - TROF_H - 0.010,
                     ax1 - 0.045, ay1 - 0.045, cz - TROF_H + 0.022)


def _ducts(b: Batch, g: Batch, x0, y0, x1, y1, cz, axis):
    """원형 주덕트 두 줄과 8 m 간격 분기. 실사에서 벽 가까이 붙어 흐른다."""
    if axis == "x":
        lanes = (y0 + 0.75, y1 - 0.75)
        for lane in lanes:
            b.tube("x", x0 + 0.4, x1 - 0.4, lane, cz - 0.34, DUCT_R, seg=14)
            for x in frange(x0 + 4.0, x1 - 4.0, 8.0):
                b.tube("z", cz - 0.34, cz - 0.06, x, lane, 0.085, seg=10)
                g.box(x - 0.13, lane - 0.13, cz - 0.075, x + 0.13, lane + 0.13, cz - 0.045)
            # 행거 스트랩
            for x in frange(x0 + 2.0, x1 - 2.0, 4.0):
                b.box(x - 0.02, lane - DUCT_R - 0.02, cz - 0.34,
                      x + 0.02, lane + DUCT_R + 0.02, cz)
    else:
        lanes = (x0 + 0.75, x1 - 0.75)
        for lane in lanes:
            b.tube("y", y0 + 0.4, y1 - 0.4, lane, cz - 0.34, DUCT_R, seg=14)
            for y in frange(y0 + 4.0, y1 - 4.0, 8.0):
                b.tube("z", cz - 0.34, cz - 0.06, lane, y, 0.085, seg=10)
                g.box(lane - 0.13, y - 0.13, cz - 0.075, lane + 0.13, y + 0.13, cz - 0.045)
            for y in frange(y0 + 2.0, y1 - 2.0, 4.0):
                b.box(lane - DUCT_R - 0.02, y - 0.02, cz - 0.34,
                      lane + DUCT_R + 0.02, y + 0.02, cz)


def _grilles(b: Batch, x0, y0, x1, y1, cz, axis):
    """600 각 환기 그릴. 날개 9장이 있어야 구멍으로 읽힌다."""
    cross = (y0 + (y1 - y0) * 0.5,) if axis == "x" else (x0 + (x1 - x0) * 0.5,)
    span0, span1 = (x0, x1) if axis == "x" else (y0, y1)
    for a in frange(span0 + 5.0, span1 - 5.0, GRILLE_PITCH):
        for c in cross:
            cx, cy = (a, c) if axis == "x" else (c, a)
            b.box(cx - 0.32, cy - 0.32, cz - 0.035, cx + 0.32, cy + 0.32, cz - 0.015)
            for k in range(5):
                v = cy - 0.24 + k * 0.12
                b.box(cx - 0.28, v - 0.012, cz - 0.075, cx + 0.28, v + 0.012, cz - 0.035)



def _devices(b: Batch, dark: Batch, x0, y0, x1, y1, cz, axis):
    """스피커와 CCTV 돔. 작지만 없으면 천장이 '지어지다 만' 것처럼 보인다."""
    span0, span1 = (x0, x1) if axis == "x" else (y0, y1)
    near = (y0 + 0.9, y1 - 0.9) if axis == "x" else (x0 + 0.9, x1 - 0.9)
    for a in frange(span0 + 3.0, span1 - 3.0, SPEAKER_PITCH):
        for c in near:
            cx, cy = (a, c) if axis == "x" else (c, a)
            b.tube("z", cz - 0.14, cz - 0.02, cx, cy, 0.105, seg=12)
            dark.disc(cx, cy, cz - 0.145, 0.088, seg=12, up=False)
    for a in frange(span0 + 8.0, span1 - 8.0, CCTV_PITCH):
        c = (y0 + y1) / 2 if axis == "x" else (x0 + x1) / 2
        cx, cy = (a, c) if axis == "x" else (c, a)
        b.tube("z", cz - 0.055, cz, cx, cy, 0.135, seg=14)
        dark.tube("z", cz - 0.145, cz - 0.055, cx, cy, 0.115, seg=14)


build()
