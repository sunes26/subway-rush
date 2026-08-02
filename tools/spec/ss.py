"""ACT-08 역무원."""

SPEC = {
    "code": "ss",
    "id": "ACT-08",
    "name": "역무원",
    "tail": "순찰 액터 · Z3 개찰구 · 30 fps",
    "entry_meta": "테이저 · 삼단봉 · 애니메이션 {nclips}종",
    "rig": "SS_Rig",
    "mesh": "SS_Character",
    "blend": "assets/ss_character.blend",
    "glb": "assets/ss_character_rigged.glb",
    "fbx": "assets/ss_character_rigged.fbx",
    "render_dir": "render/_ss",
    # (오브젝트, 부모 본, 씬 기본 hide_render, 쥔 손 | None)
    # 손은 본 이름에서 유추하면 안 된다 — CP 캐리어는 Prop.Case(Root 자식)에
    # 매달려 있지만 오른손이 쥔다. 명시한다.
    "props": [("PR_Taser", "Prop.R", False, "LowerArm.R"),
              ("PR_Baton", "Prop.L", True, "LowerArm.L"),
              ("PR_TaserStowed", "Hips", True, None),
              ("PR_BatonStowed", "Hips", True, None)],
    "bones": 19,
    "materials": {"MC_White", "SS_Uniform", "SS_Trim", "AJ_Dark",
                  "SS_Arc", "SS_Cartridge"},
    # 이름: (프레임 수, 루프 여부)
    # 4면도를 뽑는 대표 정지 클립. 정하지 않으면 알파벳 첫 클립이 뽑혀
    # ZP_Bump · CP_AsideIdle 같은 엉뚱한 자세가 4면도가 된다(실측).
    "rest_clip": "SS_Idle",
    "clips": {
        "SS_Idle": (61, True), "SS_Walk": (31, True), "SS_Radio": (61, False),
        "SS_Guide": (40, False), "SS_TaserDraw": (23, False),
        "SS_TaserAim": (46, True), "SS_TaserWarn": (31, False),
        "SS_RadioAlert": (46, False), "SS_TaserHolster": (23, False),
        "SS_Chase": (19, True), "SS_TaserFire": (25, False),
        "SS_BatonDraw": (23, False), "SS_BatonReady": (46, True),
        "SS_BatonSwing": (25, False), "SS_BatonHolster": (23, False),
        "SS_BatonChase": (19, True)},
    # 클립별로 어느 프롭이 보이는가. 엔진도 같은 규칙을 쓴다.
    "prop_visibility": {
        # 기본 변형. 집합 반복 순서로 정하면 안 된다 — 실제로 baton_hand 가
        # 뽑혀 공유 클립 4종과 4면도에서 파우치의 총 대신 봉이 보였다.
        "default": "taser_hand",
        "taser_hand": {"SS_TaserDraw", "SS_TaserAim", "SS_TaserWarn",
                       "SS_TaserFire", "SS_TaserHolster", "SS_Chase",
                       "SS_RadioAlert"},
        "baton_hand": {"SS_BatonDraw", "SS_BatonReady", "SS_BatonSwing",
                       "SS_BatonHolster", "SS_BatonChase"},
        "hand": {"PR_Taser": "taser_hand", "PR_Baton": "baton_hand"},
        "stowed": {"PR_TaserStowed": "taser_hand", "PR_BatonStowed": "baton_hand"},
    },

    # ---- 검증 설정 ----
    "hand_bone": "LowerArm.R",          # 쥔 프롭을 재는 기준 손
    # 의상 셸은 본체를 오프셋한 복제라 설계상 겹친다. 정지 포즈 대비
    # 증가분만 관통으로 보고, 그 여유가 garment_slack 이다.
    "garment_materials": {"SS_Uniform", "SS_Trim"},
    "garment_slack": 0.015,
    # 각 클립이 어느 MC 하체를 리샘플했는가 → 그 기준선으로 발 미끄러짐을 본다.
    "slide_base": {"SS_Idle": "Idle", "SS_Walk": "Walk", "SS_Radio": "Idle",
              "SS_Guide": "Idle", "SS_TaserDraw": "Idle", "SS_TaserAim": "Idle",
              "SS_TaserWarn": "Idle", "SS_RadioAlert": "Idle",
              "SS_TaserHolster": "Idle", "SS_Chase": "Run", "SS_TaserFire": "Idle",
              "SS_BatonDraw": "Idle", "SS_BatonReady": "Idle",
              "SS_BatonSwing": "Idle", "SS_BatonHolster": "Idle",
              "SS_BatonChase": "Run"},
    "allow": {
        # 봉을 뽑고 넣는 중간에 봉 끝(96정점 중 2개)이 허벅지를 스친다.
        # 화면에서는 보이지 않는다. 3개 이상이면 실패한다.
        "prop_inside": {"SS_BatonDraw": 2, "SS_BatonHolster": 2},
    },
}
