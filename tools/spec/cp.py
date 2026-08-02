"""ACT-06 캐리어 승객."""

SPEC = {
    "code": "cp",
    "id": "ACT-06",
    "name": "캐리어 승객",
    "tail": "고정 액터 · 30 fps",
    "entry_meta": "애니메이션 {nclips}종",
    "rig": "CP_Rig",
    "mesh": "CP_Character",
    "blend": "assets/cp_character.blend",
    "glb": "assets/cp_character_rigged.glb",
    "fbx": "assets/cp_character_rigged.fbx",
    "render_dir": "render/_cp",
    "props": [("PR_Carrier", "Prop.Case", False)],
    "bones": 18,
    # 본체는 MC_White · CP_Pillow 뿐. CP_Case · AJ_Dark 는 캐리어 프롭에 있다.
    "materials": {"MC_White", "CP_Pillow", "CP_Case", "AJ_Dark"},
    # 4면도를 뽑는 대표 정지 클립. 정하지 않으면 알파벳 첫 클립이 뽑혀
    # ZP_Bump · CP_AsideIdle 같은 엉뚱한 자세가 4면도가 된다(실측).
    "rest_clip": "CP_Idle",
    "clips": {"CP_Idle": (61, True), "CP_MoveAside": (46, False),
              "CP_AsideIdle": (61, True), "CP_CarrierTornado": (76, False),
              "CP_CarrierTornado_Loop": (14, True)},
    "prop_visibility": None,
}
