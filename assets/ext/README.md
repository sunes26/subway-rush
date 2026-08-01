# 외부 에셋

직접 만들지 않고 받아 쓴 3D 에셋의 원본과 출처. 반입 스크립트가 이 파일들을 읽으므로
**지우면 재현이 안 된다**.

| 파일 | 출처 | 라이선스 | 반입 스크립트 |
|---|---|---|---|
| `korean_fire_extinguisher_01_1k.blend` | [Poly Haven — Korean Fire Extinguisher 01](https://polyhaven.com/a/korean_fire_extinguisher_01) (UM JOORIN) | **CC0** | `tools/import_extinguisher.py` |

## 반입 규칙

`tools/import_toilet.py` 에서 정하고 그 뒤로 지켜 온 것.

1. **스크립트로 못박는다.** 축·스케일·머티리얼·감축이 전부 판단이라, 다시 할 때 값이
   달라지면 배치가 어긋난다. 일회성 명령으로 처리했다가 Blender 가 파일을 다시 읽으며
   통째로 날아간 적이 있다.
2. **머티리얼은 씬에 이미 있는 것으로 갈아끼운다.** 로더가 머티리얼별로 병합하므로
   새 머티리얼은 곧 드로우 콜이다.
3. **감축한다.** 원본 해상도 그대로 여러 개 놓으면 삼각형 예산이 날아간다.
4. **여러 벌은 메시를 공유한다.** 따로 구우면 glTF 가 그 배수만큼 커진다.

> PBR 에셋의 머티리얼을 색으로 분류하려 하지 말 것. 색은 텍스처에 있고
> Base Color 는 흰색인 게 보통이다. **이름으로** 고른다 (Poly Haven 은
> `<asset>_body` / `_paper` / `_glass` 규칙).
