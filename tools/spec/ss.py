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
    # (오브젝트, 부모 본, 씬 기본 hide_render)
    "props": [("PR_Taser", "Prop.R", False),
              ("PR_Baton", "Prop.L", True),
              ("PR_TaserStowed", "Hips", True),
              ("PR_BatonStowed", "Hips", True)],
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
}
