"""캐릭터 선언. 파이프라인 드라이버가 이걸 읽어 동작한다.

    from spec import load
    S = load("ss")

스크립트를 캐릭터마다 복제하지 않는 이유 —
zp/cp/ss 세 벌을 실측했더니 export 92% · render 94% · reimport 88% 가
같은 줄이었다. 다른 건 이름·프롭 매핑·기대값뿐이라 선언으로 뺐다.
"""
import importlib
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

CODES = ("zp", "cp", "ss")

# index.html 의 정규 배치 순서. 페이지 드라이버가 이걸 보고 자리를 정한다 —
# 매번 목록 끝에 끼워 넣으면 재생성할 때마다 순서가 뒤집힌다(실측).
# mc·gp·aj 는 이 파이프라인 이전에 만들어진 항목이라 선언이 없지만 자리는 지킨다.
PAGE_ORDER = ("mc", "gp", "aj", "zp", "cp", "ss")


def load(code):
    if code not in CODES:
        raise RuntimeError("unknown character code %r (have %s)" % (code, list(CODES)))
    mod = importlib.import_module(code)
    S = mod.SPEC
    for k in ("code", "rig", "mesh", "blend", "glb", "fbx", "props",
              "bones", "materials", "clips"):
        if k not in S:
            raise RuntimeError("spec %s missing key %r" % (code, k))
    if S["code"] != code:
        raise RuntimeError("spec %s declares code %r" % (code, S["code"]))
    return S
