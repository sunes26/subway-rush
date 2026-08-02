# tools — 캐릭터 에셋 파이프라인

ACT-05(좀비폰족)에서 시작해 ACT-06·ACT-08 을 거치며 정리한 파이프라인이다.
**기존 캐릭터에서 파생하는 신규 캐릭터**는 이 순서를 그대로 돌리면 된다.

전부 `blender -b ... --python` 으로 도는 배치 스크립트다. GUI 세션을 건드리지
않으므로 원본 `.blend` 가 훼손될 일이 없다.

## 구조

```
spec/<code>.py    캐릭터 선언 — 이름·프롭·본 수·머티리얼·클립·검사 허용치
lib/              공통 로직 (blend · meshops · checks · exporting · reimporting
                  · rendering · page)
pipeline.py       단일 진입점
<code>_build.py    캐릭터 고유 빌드 (여기만 캐릭터마다 다르다)
```

세 벌(zp/cp/ss)을 실측했더니 export 92% · render 94% · reimport 88% 가 같은
줄이었다. 하지만 **더 큰 문제는 중복이 아니라 교훈이 전파되지 않는 것**이었다 —
ACT-08 에서 찾은 검사들이 ZP·CP 에는 없어서, 복붙할 때마다 같은 함정을 다시
밟았다. 그래서 검사를 한곳에 모으고 캐릭터 차이는 선언으로 뺐다.

## 순서

```bash
B=/Applications/Blender.app/Contents/MacOS/Blender

# 1. 소스 빌드 — mc_character.blend 를 열어 파생시키고 '다른 이름 저장'한다.
#    원본은 절대 저장하지 않는다.
SS_REPORT=/tmp/build.json \
  $B -b assets/mc_character.blend --python tools/ss_build.py -- assets/ss_character.blend

# 2. 검증 — 정적 + 애니메이션 전 프레임. 실패가 하나라도 있으면 exit 1.
$B -b assets/ss_character.blend --python tools/pipeline.py -- verify ss

# 3. 익스포트 — NLA 트랙 · 정점당 영향 4 · 카메라/라이트 제외
$B -b assets/ss_character.blend --python tools/pipeline.py -- export ss

# 4. 출고본 재검증 — 빈 씬에 GLB/FBX 를 다시 임포트해서 본다.
#    익스포트 성공 메시지는 검증이 아니다.
$B -b --factory-startup --python tools/pipeline.py -- reimport ss

# 5. 프리뷰 렌더 — 4면도(340x460 x5) + 액션별 스프라이트(170x220 x15)
$B -b assets/ss_character.blend --python tools/pipeline.py -- render ss all

# 6. 페이지 반영 — index.html 에 base64 로 심는다 (Blender 불필요)
python3 tools/pipeline.py page ss
```

환경변수 — `FLAT=1` 무채색 실루엣 렌더 · `VARIANT=<key>` 프롭 변형 ·
`OUTDIR=` 렌더 경로 · `<CODE>_REPORT=` 리포트 JSON.

`FLAT=1` 은 **색 없이 실루엣만으로 구별되는가**를 보는 용도다.

## 검사 항목

정적 — 원점/스케일, 프롭의 본 부모, 모디파이어, 본 수, 정점당 영향과 정규화,
**다리 정점에 실린 팔 웨이트**, 고립 정점·비매니폴드, **프롭의 열린 경계 에지**.

애니메이션(전 프레임) — 루트 모션(수평), 힙 수평 이동과 양끝 닫힘, 지면 접촉,
발 미끄러짐, 루프 이음매, 프롭↔손 표면거리, 프롭↔얼굴, **팔↔몸통**,
**레이캐스트 내외판정 기반 관통**, 의상 셸 침투 깊이, 매단 프롭의 본 로컬 드리프트.

### 지표를 고를 때

**잘못된 결과로도 만족될 수 있는 지표는 쓰지 않는다.** ACT-05 는 '본 꼬리 ↔
프롭 원점' 거리로 모든 검사를 통과한 채 폰이 38mm 떠 있었다.

실제로 겪은 지표 결함들 —

- **팔↔몸통은 맨몸 정점끼리만 잰다.** MC 기준선 3.4mm 자체가 맨몸 수치이고,
  의상 셸은 소매와 몸판이 이어진 하나의 지오메트리라 겨드랑이 이음매의 인접
  정점끼리 2mm 로 잡혀 가짜 실패가 난다.
- **그립 접촉을 BVH 최근접 면으로 판정하면 안 된다.** BVH 는 의상 셸을 빼고
  만들어서, 소매가 덮은 구간에는 맨살 면이 없어 팔 속의 점이 엉덩이 면으로
  잡힌다. 팔/몸통 정점 구름 거리 비교로 가른다.
- **쥔 프롭은 '그 프롭을 든 손' 으로 잰다.** ACT-08 은 총이 오른손, 봉이
  왼손이다. 한 손으로 다 재면 봉이 30cm 떨어져 있다고 나온다. 손은 본 이름에서
  유추하면 안 된다 — CP 캐리어는 `Prop.Case` 지만 오른손이 쥔다. 선언에 적는다.
- **의상 셸 기준 깊이는 정지 포즈에서 잰다.** 첫 클립에서 잡으면 그 클립이
  자기 자신과 비교된다(cp_verify 가 그랬다).
- **본 부모 프롭의 위치는 그 본의 로컬 좌표로 비교한다.** 월드 오프셋은 본이
  회전하면 같이 돈다.
- **`hide_viewport` 는 오브젝트를 뎁스그래프에서 뺀다.** 숨긴 프롭의 변환이
  갱신되지 않아 가짜 드리프트가 나온다. 숨길 때는 `hide_render` 만 쓴다.
- **발 미끄러짐 기준선은 하체가 MC 순수 리샘플인 클립에만 적용한다.** 다리에
  오프셋을 더한 클립(CP_MoveAside 등)에는 성립하지 않는다.

### 허용치는 풀지 말고 기록한다

문턱을 그냥 느슨하게 하면 검사가 의미를 잃는다. `spec` 의 `allow` 에
**측정값과 이유**를 남기고, 그보다 나빠지면 실패시킨다. 허용치보다 좋아지면
경고를 내서 낡은 허용치가 방치되지 않게 한다.

## 새 캐릭터를 추가할 때

1. `spec/<code>.py` 를 쓴다 (기존 것을 복사해 값만 바꾼다)
2. `<code>_build.py` 를 쓴다 — 여기만 캐릭터 고유 작업이다
3. `spec.PAGE_ORDER` 에 코드를 넣는다
4. 위 2~6 을 돌린다

## bl.py — 실행 중인 Blender 직결

`mcp__Blender__*` MCP 도구가 타임아웃할 때 애드온 소켓(`127.0.0.1:9876`)에
직접 붙는다. GUI 에서 결과를 눈으로 보며 작업할 때 쓴다.

```bash
python3 tools/bl.py scene              # 현재 씬 조회
python3 tools/bl.py code some.py       # Blender 안에서 실행 (stdout 회수)
python3 tools/bl.py shot out.png 1200  # 뷰포트 스크린샷
```

## 주의

- **Blender 5.x 는 `Action.fcurves` 가 없다**(슬롯 액션). `lib.blend.action_fcurves()`
  호환 헬퍼를 쓴다. 4.2 기준 코드를 그대로 옮겨 오지 말 것.
- **`sensor_fit='VERTICAL'` 이면 `sensor_width` 가 아니라 `sensor_height`(24mm)를 쓴다.**
  프레이밍 계산이 24/36 배만큼 어긋난다.
- **NLA 트랙 순서가 임포트 직후 평가 포즈를 바꾼다.** `spec` 의 `clips` 선언
  순서를 그대로 쓴다 — 정렬하면 안 된다.
- **렌더 완료를 '파일 개수' 로 기다리지 마라.** 직전 실행이 남긴 파일 때문에
  조건이 즉시 참이 된다. 출력 폴더를 먼저 비우고, `page` 는 렌더가 `.blend`
  보다 오래되면 스스로 거부한다.
- 오브젝트·머티리얼을 못 찾으면 `None` 으로 진행하지 않고 즉시 `RuntimeError`
  를 던진다. 이름을 바꿀 때 조용히 빈 결과가 나오는 걸 막는다.
