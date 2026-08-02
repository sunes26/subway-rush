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
    "props": [("PR_Phone", "Prop.R", False)],
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
}
