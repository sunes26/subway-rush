"""ACT-13 붕어빵 아저씨."""

SPEC = {
    "code": "fm",
    "id": "ACT-13",
    "name": "붕어빵 아저씨",
    "tail": "Z1 노점(카트 뒤) 고정 · 대화 · 무선이어폰 유일 획득처 · 30 fps",
    "entry_meta": "갈색 앞치마 · 분홍 팔토시 · 애니메이션 {nclips}종",
    "rig": "FM_Rig",
    "mesh": "FM_Character",
    "blend": "assets/fm_character.blend",
    "glb": "assets/fm_character_rigged.glb",
    "fbx": "assets/fm_character_rigged.fbx",
    "render_dir": "render/_fm",
    "props": [],
    "bones": 17,
    "materials": {"MC_White", "FM_ApronMain", "FM_ApronDark",
                  "FM_ApronBuckle", "FM_ApronPocket", "FM_Sleeve"},
    # CL 과 마찬가지로 카운터(노점) 뒤 고정 액터라 걷기가 없다 — Idle 이 4면도 기준.
    "rest_clip": "FM_Idle",
    "clips": {"FM_Idle": (61, True), "FM_Talk": (76, True), "FM_Sell": (56, False)},
    "prop_visibility": None,

    # ---- 검증 설정 ----
    "hand_bone": "LowerArm.R",          # 프롭이 없어도 검사기가 참조하는 기본값
    # 앞치마는 조끼 밑단을 허벅지까지 로프트 확장한 것, 팔토시는 아래팔 원통 셸이다 —
    # 둘 다 본체를 감싸는 오프셋 셸이라 설계상 겹친다(CL 조끼와 같은 구조).
    "garment_materials": {"FM_ApronMain", "FM_ApronDark", "FM_ApronBuckle",
                          "FM_ApronPocket", "FM_Sleeve"},
    "garment_slack": 0.02,
    # FM 클립은 CL 클립을 리네임한 것뿐이다(같은 소스) — CL 이 잡아 둔 기준선을 그대로 쓴다.
    "slide_base": {"FM_Idle": "Idle", "FM_Talk": "Idle", "FM_Sell": "Idle"},
    "allow": {},
}
