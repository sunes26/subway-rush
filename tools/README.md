# tools — 캐릭터 에셋 파이프라인

ACT-05(좀비폰족)를 만들면서 정리한 스크립트다. **기존 캐릭터에서 파생하는 신규 캐릭터**는
이 순서를 그대로 돌리면 된다. 파일명의 `zp_` 접두사만 새 캐릭터 코드로 바꿔 복제해 쓴다.
현재 파생본은 `zp_`(ACT-05) · `cp_`(ACT-06) · `ss_`(ACT-08) 세 벌이다.

전부 `blender -b ... --python` 으로 도는 배치 스크립트다. GUI 세션을 건드리지 않으므로
원본 `.blend` 가 훼손될 일이 없다.

## 순서

```bash
B=/Applications/Blender.app/Contents/MacOS/Blender

# 1. 소스 빌드 — mc_character.blend 를 열어 파생시키고 '다른 이름 저장'한다.
#    원본은 절대 저장하지 않는다.
ZP_REPORT=/tmp/build.json \
  $B -b assets/mc_character.blend --python tools/zp_build.py -- assets/zp_character.blend

# 2. 소스 검증 — 실패가 하나라도 있으면 exit 전에 FAIL 을 찍는다.
$B -b assets/zp_character.blend --python tools/zp_verify.py -- /tmp/verify.json

# 3. 익스포트 — NLA 트랙 구성 · 정점당 영향 4 제한 · 카메라/라이트 제외
ZP_REPORT=/tmp/export.json $B -b assets/zp_character.blend --python tools/zp_export.py -- \
  assets/zp_character_rigged.glb assets/zp_character_rigged.fbx

# 4. 출고본 재검증 — 빈 씬에 GLB/FBX 를 다시 임포트해서 본다.
#    익스포트 성공 메시지는 검증이 아니다.
$B -b --factory-startup --python tools/zp_reimport.py -- \
  assets/zp_character_rigged.glb assets/zp_character_rigged.fbx /tmp/reimport.json

# 5. 프리뷰 렌더 — 4면도(340x460 x4) + 액션별 스프라이트(170x220 x15)
$B -b assets/zp_character.blend --python tools/zp_render.py -- render/_zp all
```

```bash
# 6. 페이지 반영 — 4면도 + 스프라이트 시트를 base64 로 index.html 에 심는다.
#    카드 수·프레임 수·길이는 render/_ss/sheets.json 에서 읽는다. 손으로 적지 않는다.
python3 tools/ss_page.py
```

`ZP_FLAT=1` 을 붙여 5번을 한 번 더 돌리면 머티리얼을 무채색으로 치환해 렌더한다.
**색 없이 실루엣만으로 구별되는가**를 보는 용도다.

## 검사 항목

`zp_verify.py` 가 보는 것 — 원점/스케일, 프롭의 본 부모, 모디파이어 구성, 정점당 영향과
정규화, **다리 정점에 실린 팔 웨이트**, 고립 정점·비매니폴드, 그리고 액션별 전 프레임에 대해
루트 모션(수평)·지면 접촉·발 미끄러짐·루프 이음매·폰과 손의 이탈·폰과 얼굴 거리·
**레이캐스트 내외판정 기반 관통**.

발 미끄러짐은 절대값이 아니라 **MC 원본 대비**로 판정한다(`MC_FOOT_SLIDE`). 하체를 MC에서
리샘플해 가져오므로 수치가 같아야 정상이고, 커지면 회귀다.

후드처럼 목을 감싸는 셸은 설계상 본체와 상시 겹치므로, 정지 포즈 대비 **증가분**만 관통으로
본다.

**팔↔몸통 간격은 맨몸 정점끼리만 잰다.** MC 기준선 3.4mm 가 맨몸 수치이고, 의상 셸은 소매와
몸판이 이어진 하나의 지오메트리라 겨드랑이 이음매의 인접 정점끼리 2mm 로 잡혀 가짜 실패가
난다. `ss_verify.py` 는 `MC_White` 슬롯으로 맨몸을 걸러 낸다.

**MC 기준선은 손으로 적지 말고 재라.** `Idle` 0 / `Walk` L 0.0312 R 0.0294 / `Run` 0 은
`mc_character.blend` 에서 검사기와 동일한 방식으로 측정한 값이다. 클립이 어느 MC 하체를
리샘플했는지에 따라 다른 기준선을 써야 한다.

## bl.py — 실행 중인 Blender 직결

`mcp__Blender__*` MCP 도구가 타임아웃할 때 애드온 소켓(`127.0.0.1:9876`)에 직접 붙는다.
GUI에서 결과를 눈으로 보며 작업할 때 쓴다.

```bash
python3 tools/bl.py scene              # 현재 씬 조회
python3 tools/bl.py code some.py       # Blender 안에서 실행 (stdout 회수)
python3 tools/bl.py shot out.png 1200  # 뷰포트 스크린샷
```

## 주의

- **Blender 5.x 는 `Action.fcurves` 가 없다**(슬롯 액션). 스크립트에 `action_fcurves()`
  호환 헬퍼가 들어 있으니 4.2 기준 코드를 그대로 옮겨 오지 말 것.
- **`sensor_fit='VERTICAL'` 이면 `sensor_width` 가 아니라 `sensor_height`(24mm)를 쓴다.**
  프레이밍 계산이 24/36 배만큼 어긋난다.
- 오브젝트·머티리얼을 못 찾으면 `None` 으로 진행하지 않고 즉시 `RuntimeError` 를 던지도록
  돼 있다. 이름을 바꿀 때 조용히 빈 결과가 나오는 걸 막는다.
