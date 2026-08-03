"""패스 J — 마감 머티리얼을 **기존 팔레트로 되돌린다.** 빌더 전부를 돌린 뒤 마지막.

마감 패스를 짜면서 `HQ_*` 머티리얼을 124종 새로 만들었다. 그게 두 가지를 깼다.

**1. 드로우 콜.** 게임 로더(`game/src/render/station.ts`)는 정적 메시를
머티리얼별로 병합한다 — 존의 드로우 콜은 사실상 **그 존이 쓰는 머티리얼 종류 수**다.

    Z2  200 → 269 콜 (예산 210)   ·   Z2 삼각형 268,580 → 466,328 (예산 300,000)

그리고 `feel.spec` 이 무너졌다. W 를 3초 눌러 15 m 를 가야 하는데 7.94 m.
프레임 시간이 두 배 넘게 늘어 고정 60 Hz 시뮬이 실시간을 못 따라간 것이다.
구버전 glb 로 되돌리면 세 케이스 다 통과했으니 원인은 이 작업이 맞다.

**2. 로더의 특별 처리를 통째로 놓쳤다.** `SELF_LIT_MATERIALS`·`DECAL_MATERIALS`·
`GLASS_MATERIALS` 는 **이름 목록**이다. 새 이름을 쓰면 그 목록에 없으므로

  · 광고판이 발광 경로를 안 타서 툰 음영에 눌려 어둡게 나오고
  · 바닥 선이 폴리곤 오프셋을 못 받아 원거리에서 점멸하고
  · 유리가 불투명으로 그려진다

즉 새 머티리얼은 **콜을 늘리면서 품질도 떨어뜨리고 있었다.** 그래서 색을 새로 만들지 않고
**이미 있는 팔레트에 얹는다.** 색은 거의 그대로면서 콜이 돌아오고 특별 처리도 따라온다.

살아남는 새 머티리얼은 잎 색 하나뿐이다 — 팔레트에 초록 식물색이 없었다.
"""

from __future__ import annotations

import bpy

# HQ_* → 기존 팔레트. 오른쪽 이름이 로더 목록에 걸리면 그 처리도 같이 따라온다.
MERGE: dict[str, str] = {
    # ── 조명 · 발광 (SELF_LIT) ────────────────────────────────
    "HQ_TROF_LIGHT": "FIXTURE",
    "HQ_DESC_LIGHT": "FIXTURE",
    "HQ_GATELINE_LIGHT": "FIXTURE",
    "HQ_SHOP_LIGHT": "FIXTURE",
    "HQ_COVE_GLOW": "FIXTURE",
    "HQ_ENTST_LIGHT": "FIXTURE",
    "HQ_SHOP_CHILL": "VM_LIGHT",

    # ── 기구 하우징 · 덕트 ────────────────────────────────────
    "HQ_DUCT": "DUCT",
    "HQ_TROF_HOUSING": "DUCT",
    "HQ_DESC_HOUSING": "DUCT",
    "HQ_GATELINE_HOUSING": "DUCT",
    "HQ_ENTST_HOUSING": "DUCT",

    # ── 천장 트림 ─────────────────────────────────────────────
    "HQ_CEIL_TEE": "CEIL_RIB",
    "HQ_W_CORNICE": "CEIL_RIB",
    "HQ_COVE_LIP": "CEIL_RIB",
    "HQ_CEIL_DEVICE": "CEIL_RIB",
    "HQ_ENTST_BAND": "CEIL_RIB",

    # ── 벽 패널 ───────────────────────────────────────────────
    "HQ_W_PANEL": "ST_WALL",
    "HQ_DESC_PANEL": "ST_WALL",
    "HQ_SHOP_PILASTER": "ST_WALL",
    "HQ_SHOP_INTWALL": "ST_WALL",
    "HQ_ENTST_PANEL": "ST_WALL",
    "HQ_MAP_FACE": "MAP_FACE",

    # ── 사인 글자 (SELF_LIT — 발광 띠 위 흰 글자가 회색이 되면 안 읽힌다) ──
    "HQ_SIGN_WHITE": "TXT_WHITE",
    "HQ_SIGNBANK_TXT": "TXT_WHITE",
    "HQ_SHOP_TXT": "TXT_WHITE",
    "HQ_SIGNBANK_wht": "TXT_WHITE",

    # ── 홈 · 그릴 · 이음새 ────────────────────────────────────
    "HQ_W_REVEAL": "COL_SKIRT",
    "HQ_DESC_REVEAL": "COL_SKIRT",
    "HQ_GRILLE": "COL_SKIRT",
    "HQ_FLOOR_GRATE": "COL_SKIRT",
    "HQ_COL_SEAM": "COL_SKIRT",
    "HQ_ENTST_RIB": "COL_SKIRT",
    "HQ_PLANT_POT": "COL_SKIRT",

    # ── 스테인리스 ────────────────────────────────────────────
    "HQ_STEEL": "ENTR_STEEL",
    "HQ_GATE_STEEL": "ENTR_STEEL",
    "HQ_PSD_MULL": "ENTR_STEEL",
    "HQ_W_SKIRT": "ENTR_STEEL",
    "HQ_FLOOR_HATCH": "ENTR_STEEL",
    "HQ_SIGNBANK_ROD": "ENTR_STEEL",
    "HQ_SPRINKLER": "ENTR_STEEL",
    "HQ_SHOP_SHELF": "SH_SHELF",
    "HQ_SHOP_FRAME": "SH_SHELF",

    # ── 어두운 것 — 사인 본체 · 광고 프레임 · 스피커 ──────────
    "HQ_CEIL_DARK": "SIGN_DARK",
    "HQ_PSD_DARK": "SIGN_DARK",
    "HQ_GATE_DARK": "SIGN_DARK",
    "HQ_SIGN_BODY": "SIGN_DARK",
    "HQ_SIGNBANK_BODY": "SIGN_DARK",
    "HQ_SPEAKER": "SIGN_DARK",
    "HQ_AD_FRAME": "SIGN_DARK",
    "HQ_DESC_ADFRAME": "SIGN_DARK",
    "HQ_SHOP_COUNTER": "ST_COUNTER",

    # ── 바닥 (DECAL — 폴리곤 오프셋이 붙는다) ─────────────────
    "HQ_FLOOR_SUBJOINT": "FLOOR_JOINT",
    "HQ_FLOOR_BORDER": "FLOOR_JOINT",
    "HQ_FLOOR_NUM": "FLOOR_JOINT",
    "HQ_FLOOR_MARK": "LINE2_GRN",
    "HQ_FLOOR_MARK_R": "SIGN_PLATE",
    "HQ_SHOP_INTFLOOR": "ST_FLOOR",

    # ── 안내 색 ───────────────────────────────────────────────
    # ⚠ `SIGN_GREEN`·`SIGN_RED`·`LED_*` 는 `DYNAMIC_MATERIAL` 이라
    #    쓰는 오브젝트마다 **병합에서 빠져 콜 1개**가 된다. 정적인 것에 쓰면 안 된다.
    "HQ_SIGN_GRN": "PSD_GREEN",
    "HQ_SIGNBANK_grn": "PSD_GREEN",
    "HQ_HEADSIGN_GO": "PSD_GREEN",
    "HQ_GATELED_GO": "PSD_GREEN",
    "HQ_GATEFLOOR_GO": "PSD_GREEN",
    "HQ_GATE_GO": "PSD_GREEN",
    "HQ_SIGN_YEL": "PF_YELLOW",
    "HQ_SIGNBANK_yel": "PF_YELLOW",
    "HQ_PSD_WARN": "PF_YELLOW",
    "HQ_HEADSIGN_NO": "WC_RED",
    "HQ_GATE_NO": "WC_RED",
    "HQ_GATE_PAD": "READER_BLUE",
    "HQ_GATE_LCD": "READER_BLUE",
    "HQ_GATE_SHELL": "GATE_BODY",
    "HQ_GATE_FLAP": "GATE_BODY",

    # ── 유리 (GLASS) ──────────────────────────────────────────
    "HQ_PSD_GLASS": "ST_GLASS",
    "HQ_SHOP_GLASS": "ST_GLASS",
}

# 광고 — 색조 6종 × 3요소 + 하강부 4×2 + 스크린도어 4×2 = 34종이었다.
# 기존 `AD_PANEL{,2,3}` 세 장으로 돌린다. 셋 다 SELF_LIT·DECAL 목록에 있어
# 게임에서 백라이트로 그려진다 — 새 이름을 쓰는 동안 이 처리를 못 받고 있었다.
_AD_BG = ("AD_PANEL", "AD_PANEL2", "AD_PANEL3")
for i in range(6):
    MERGE[f"HQ_AD{i}_bg"] = _AD_BG[i % 3]
    MERGE[f"HQ_AD{i}_ink"] = "SIGN_PLATE"
    MERGE[f"HQ_AD{i}_deep"] = "SIGN_DARK"
for i in range(4):
    MERGE[f"HQ_DESCAD{i}_bg"] = _AD_BG[i % 3]
    MERGE[f"HQ_DESCAD{i}_ink"] = "SIGN_PLATE"
    MERGE[f"HQ_PSDAD{i}_bg"] = _AD_BG[i % 3]
    MERGE[f"HQ_PSDAD{i}_ink"] = "SIGN_PLATE"

# 상가 — 상품과 간판은 기존 점포 색으로
for i, dst in enumerate(("SH_GOODS", "SH_RED", "SH_GREEN", "VM_CAN_B",
                         "SH_GOODS", "SH_RED", "SH_GREEN", "VM_CAN_B")):
    MERGE[f"HQ_SHOP_GOODS{i}"] = dst
for i, dst in enumerate(("SH_RED", "SH_GREEN", "VM_BODY2", "AD_PANEL2",
                         "SH_RED", "SH_GREEN")):
    MERGE[f"HQ_SHOP_BAND{i}"] = dst

# 팔레트에 초록 식물색이 없다 — 이 하나만 남긴다.
KEEP = {"HQ_FOLIAGE"}


def build():
    missing = sorted({d for d in MERGE.values() if bpy.data.materials.get(d) is None})
    if missing:
        print(f"  ⚠ 팔레트에 없는 대상: {missing}")

    swapped = 0
    for o in bpy.data.objects:
        slots = getattr(getattr(o, "data", None), "materials", None)
        if slots is None:
            continue
        for i, m in enumerate(slots):
            if m is None:
                continue
            target = bpy.data.materials.get(MERGE.get(m.name, ""))
            if target is None or target is m:
                continue
            slots[i] = target
            swapped += 1

    dead = [m for m in bpy.data.materials
            if m.name.startswith("HQ_") and m.name not in KEEP and m.users == 0]
    for m in dead:
        bpy.data.materials.remove(m)

    left = sorted(m.name for m in bpy.data.materials if m.name.startswith("HQ_"))
    print(f"[hq_merge_materials] 슬롯 {swapped}개 교체 · {len(dead)}종 제거 "
          f"· 남은 HQ_: {left}")


build()
