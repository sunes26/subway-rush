"""ACT-05 좀비폰족."""

SPEC = {
    "code": "zp",
    "id": "ACT-05",
    "name": "좀비폰족",
    "tail": "동적 액터 · 30 fps",
    "entry_meta": "양손·한손 · 애니메이션 {nclips}종",
    "rig": "ZP_Rig",
    "mesh": "ZP_Character",
    "blend": "assets/zp_character.blend",
    "glb": "assets/zp_character_rigged.glb",
    "fbx": "assets/zp_character_rigged.fbx",
    "render_dir": "render/_zp",
    # (오브젝트, 부모 본, 씬 기본 hide_render, 쥔 손 | None)
    "props": [("PR_Phone", "Prop.R", False, "LowerArm.R")],
    "bones": 18,
    # 본체는 MC_White · ZP_Hoodie 뿐이고 AJ_Dark · ZP_Screen 은 폰 프롭에 있다.
    # 검사는 파일 전체 머티리얼을 보므로 넷을 다 적는다.
    "materials": {"MC_White", "ZP_Hoodie", "AJ_Dark", "ZP_Screen"},
    # 4면도를 뽑는 대표 정지 클립. 정하지 않으면 알파벳 첫 클립이 뽑혀
    # ZP_Bump · CP_AsideIdle 같은 엉뚱한 자세가 4면도가 된다(실측).
    "rest_clip": "ZP_Idle",
    "clips": {"ZP_Idle": (61, True), "ZP_Walk": (31, True),
              "ZP_Idle1H": (61, True), "ZP_Walk1H": (31, True),
              "ZP_Bump": (19, False), "ZP_MoveAside": (41, False)},
    # 익스포트(NLA 스택) 순서와 시트(페이지 카드) 순서가 예전부터 달랐다.
    # NLA 순서는 임포트 직후 평가 포즈를 바꾸므로 clips 선언 순서를 쓰고,
    # 카드 순서는 아래를 쓴다 — 걷기를 먼저 보여 주던 기존 배치를 유지한다.
    "sheet_order": ["ZP_Walk", "ZP_Idle", "ZP_Walk1H", "ZP_Idle1H",
                    "ZP_Bump", "ZP_MoveAside"],
    "prop_visibility": None,

    # ---- 검증 설정 ----
    "hand_bone": "LowerArm.R",          # 쥔 프롭을 재는 기준 손
    # 의상 셸은 본체를 오프셋한 복제라 설계상 겹친다. 정지 포즈 대비
    # 증가분만 관통으로 보고, 그 여유가 garment_slack 이다.
    "garment_materials": {"ZP_Hoodie"},
    "garment_slack": 0.008,
    # 각 클립이 어느 MC 하체를 리샘플했는가 → 그 기준선으로 발 미끄러짐을 본다.
    # MoveAside 는 UpperLeg 에 오프셋을 더하므로 제외한다.
    "slide_base": {"ZP_Idle": "Idle", "ZP_Walk": "Walk",
                   "ZP_Idle1H": "Idle", "ZP_Walk1H": "Walk"},
    # 아래는 '측정해서 정상이라고 판단한 값'이다. 느슨하게 푼 게 아니라
    # 이유와 함께 기록해 두고, 이보다 나빠지면 실패한다.
    "allow": {
        # 폰 화면은 평면 데칼 한 장이다. 평면은 경계 에지가 4개인 게 정상 —
        # 잘라 만든 셸의 '막지 않은 단면'과는 다르다.
        "open_edges": {"PR_Phone": 4},
    },
}
