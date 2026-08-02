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
    # (오브젝트, 부모 본, 씬 기본 hide_render, 쥔 손 | None)
    "props": [("PR_Carrier", "Prop.Case", False, "LowerArm.R")],
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

    # ---- 검증 설정 ----
    "hand_bone": "LowerArm.R",          # 쥔 프롭을 재는 기준 손
    # 의상 셸은 본체를 오프셋한 복제라 설계상 겹친다. 정지 포즈 대비
    # 증가분만 관통으로 보고, 그 여유가 garment_slack 이다.
    "garment_materials": {"CP_Pillow"},
    "garment_slack": 0.008,
    # 각 클립이 어느 MC 하체를 리샘플했는가 → 그 기준선으로 발 미끄러짐을 본다.
    # MoveAside · AsideIdle 은 ASIDE_LEG 로 다리에 오프셋을 더하므로 MC 기준선이
    # 성립하지 않는다. 순수 리샘플인 Idle 만 본다.
    "slide_base": {"CP_Idle": "Idle"},
    "allow": {
        # 넥필로우는 토러스 아랫면이 어깨에 묻히는 설계다. 고개를 돌리면
        # 25.6mm 까지 들어가지만 확대해도 구멍이 없다(정지 6.2mm).
        # 마이너 반지름 26mm 를 넘으면 완전히 삼켜진 것이므로 그때 실패한다.
        "garment_depth": {"CP_Idle": 0.026},
        # 토네이도는 원심으로 몸을 젖히는 동작이라 자유로운 왼팔이 몸통에
        # 닿는다. 관통 아티팩트는 없다 — MC 정지 기준선 3.4mm 는 이 자세에
        # 적용되지 않는다.
        "arm_torso": {"CP_CarrierTornado": 0.0007},
    },
}
