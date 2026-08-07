"""ACT-12 편의점 점원."""

SPEC = {
    "code": "cl",
    "id": "ACT-12",
    "name": "편의점 점원",
    "tail": "Z2 편의점 카운터 · 판매 · 대화 · 걷기 · 30 fps",
    "entry_meta": "애니메이션 {nclips}종",
    "rig": "CL_Rig",
    "mesh": "CL_Character",
    "blend": "assets/cl_character.blend",
    "glb": "assets/cl_character_rigged.glb",
    "fbx": "assets/cl_character_rigged.fbx",
    "render_dir": "render/_cl",
    "props": [],
    "bones": 17,
    "materials": {"MC_White", "CL_VestMain", "CL_VestDark", "CL_Zip", "CL_Tag"},
    "rest_clip": "CL_Idle",
    # 점원이 하는 일은 셋뿐이다(디렉터 지정) — 판매 · 대화 · 걷기.
    "clips": {"CL_Idle": (61, True), "CL_Walk": (31, True),
              "CL_Talk": (76, True), "CL_Sell": (56, False)},
    "prop_visibility": None,

    # ---- 검증 설정 ----
    "hand_bone": "LowerArm.R",          # 프롭이 없어도 검사기가 참조하는 기본값
    # 의상 셸은 본체를 오프셋한 복제라 설계상 겹친다. 정지 포즈 대비
    # 증가분만 관통으로 보고, 그 여유가 garment_slack 이다.
    "garment_materials": {"CL_VestMain", "CL_VestDark", "CL_Zip"},
    "garment_slack": 0.015,
    "slide_base": {"CL_Idle": "Idle", "CL_Walk": "Walk",
                   "CL_Talk": "Idle", "CL_Sell": "Idle"},
    "allow": {
        # 조끼 오프셋이 옆구리를 부풀려 MC 기준선(3.4mm)보다 1mm 정도 좁아진다.
        # 실측 2.4mm — 화면 스케일에서 안 보이고, 관통 아티팩트는 없다.
        # 제스처 클립은 팔을 앞으로 돌리면서 몸통 쪽으로 더 붙는다. 벌림을 25°로
        # 묶어 둔 결과인데, 그 이상 벌리면 팔이 옆으로 뻗은 '날개'가 되어
        # 자세가 망가진다 — 2.5mm 여유가 그 거래의 대가다. 관통은 없다.
        "arm_torso": {"CL_Idle": 0.0022, "CL_Talk": 0.0025, "CL_Sell": 0.0025},
    },
}
