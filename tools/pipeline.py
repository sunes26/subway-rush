"""캐릭터 파이프라인 단일 진입점.

Blender 안에서:
    blender -b assets/ss_character.blend --python tools/pipeline.py -- export ss
    blender -b assets/ss_character.blend --python tools/pipeline.py -- render ss all
    blender -b --factory-startup --python tools/pipeline.py -- reimport ss

Blender 없이:
    python3 tools/pipeline.py page ss cp        # cp 항목 뒤에 넣는다

옵션은 환경변수로 준다 —
    SS_REPORT=...   리포트 JSON 경로
    FLAT=1          무채색 실루엣 렌더
    VARIANT=<key>   프롭 변형 (예: baton_hand)
    OUTDIR=...      렌더 출력 경로 (기본은 spec 의 render_dir)
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from lib import repo                      # noqa: E402
from spec import load                     # noqa: E402

_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
if len(_args) < 2:
    raise SystemExit(__doc__)
CMD, CODE = _args[0], _args[1]
REST = _args[2:]
S = load(CODE)
REPORT = os.environ.get("%s_REPORT" % CODE.upper()) or os.environ.get("REPORT")


def _p(rel):
    return rel if os.path.isabs(rel) else repo(rel)


if CMD == "export":
    from lib import exporting
    glb = _p(REST[0]) if len(REST) > 0 else _p(S["glb"])
    fbx = _p(REST[1]) if len(REST) > 1 else _p(S["fbx"])
    exporting.run(S, glb, fbx, REPORT or "/tmp/%s_export.json" % CODE)

elif CMD == "reimport":
    from lib import reimporting
    glb = _p(REST[0]) if len(REST) > 0 else _p(S["glb"])
    fbx = _p(REST[1]) if len(REST) > 1 else _p(S["fbx"])
    R = reimporting.run(S, glb, fbx, REPORT or "/tmp/%s_reimport.json" % CODE)
    if not R["ok"]:
        raise SystemExit(1)

elif CMD == "render":
    from lib import rendering
    mode = REST[0] if REST else "all"
    outdir = _p(os.environ.get("OUTDIR") or S["render_dir"])
    rendering.run(S, outdir, mode,
                  flat=os.environ.get("FLAT", "0") == "1",
                  variant=os.environ.get("VARIANT") or None)

elif CMD == "page":
    # 페이지 반영은 Blender 없이 돈다.
    from lib import page
    page.run(S, after=os.environ.get("AFTER") or REST[0] if REST else None)

else:
    raise SystemExit("unknown command %r (export | reimport | render | page)" % CMD)
