"""캐릭터 파이프라인 공통 로직.

zp/cp/ss 세 벌을 실측했더니 export 92% · render 94% · reimport 88% 가 같은
줄이었고, 유효 5,991 줄 중 2,160 줄이 순수 3중 복제였다. 더 큰 문제는 중복
자체가 아니라 **교훈이 전파되지 않는 것**이다 — ACT-08 에서 찾은 검사들이
zp/cp 에는 없어서, 다음 캐릭터를 복붙하면 같은 함정을 다시 밟는다.

캐릭터 고유값은 `tools/spec/<code>.py` 에 선언으로 두고, 여기 있는 코드는
그 선언만 읽는다.
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_TOOLS = os.path.dirname(_HERE)
for _p in (_TOOLS, _HERE):
    if _p not in sys.path:
        sys.path.insert(0, _p)

ROOT = os.path.dirname(_TOOLS)


def repo(*parts):
    """저장소 루트 기준 절대 경로."""
    return os.path.join(ROOT, *parts)
