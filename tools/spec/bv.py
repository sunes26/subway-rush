"""ACT-12 붕어빵 노점상.

정적 액터다 — Z1 노점(14,16)에 고정이고 이동·추격이 없다. 그래서 하체는
6개 클립 내내 MC 정지 자세 하나뿐이고, 동작이 전부 상체와 팔에 몰린다.
노점 카트(Z1_CART_*)는 이미 맵에 있고 이 캐릭터는 그 뒤에 서 있다.
"""

SPEC = {
    "code": "bv",
    "id": "ACT-12",
    "name": "붕어빵 노점상",
    "tail": "정적 액터 · 30 fps",
    "entry_meta": "고정 노점 · 애니메이션 {nclips}종",
    "rig": "BV_Rig",
    "mesh": "BV_Character",
    "blend": "assets/bv_character.blend",
    "glb": "assets/bv_character_rigged.glb",
    "fbx": "assets/bv_character_rigged.fbx",
    "render_dir": "render/_bv",
    # (오브젝트, 부모 본, 씬 기본 hide_render, 쥔 손 | None)
    "props": [("PR_Turner", "Prop.R", False, "LowerArm.R"),
              ("PR_Bag", "Prop.L", True, "LowerArm.L")],
    # MC 리그 17본 + 프롭 본 둘. MC 에는 프롭 본이 없어 빌드에서 만든다.
    "bones": 19,
    "materials": {"MC_White", "BV_Padded", "BV_Apron", "BV_Sleeve", "AJ_Dark"},
    "rest_clip": "BV_Idle",
    "clips": {"BV_Idle": (61, True), "BV_Bake": (41, True),
              "BV_Serve": (45, False), "BV_Call": (37, False),
              "BV_Take": (33, False), "BV_SoldOut": (41, False)},
    # 뒤집개는 **여기에 적지 않는다.** 가시성 목록(hand/stowed)에 없는 프롭은
    # 렌더러가 손대지 않으므로 빌드 때 정한 대로 늘 보인다. 늘 손에 있는
    # 물건을 굳이 그룹으로 나누면 클립 하나가 두 그룹에 걸려 어느 쪽이
    # 뽑힐지 집합 순서에 좌우된다 — ACT-08 에서 겪은 그 문제다.
    "prop_visibility": {
        "default": "serve",
        "serve": {"BV_Serve"},
        "hand": {"PR_Bag": "serve"},      # 봉지는 건네는 클립에서만
        "stowed": {},
    },

    # ---- 검증 설정 ----
    "hand_bone": "LowerArm.R",
    "garment_materials": {"BV_Padded", "BV_Apron", "BV_Sleeve"},
    "garment_slack": 0.010,
    # 정적 액터라 하체가 전부 같은 MC 정지 자세다.
    "slide_base": {k: "Idle" for k in
                   ("BV_Idle", "BV_Bake", "BV_Serve", "BV_Call",
                    "BV_Take", "BV_SoldOut")},
}
