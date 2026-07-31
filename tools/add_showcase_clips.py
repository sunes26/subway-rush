"""
쇼케이스(index.html) 플레이어 카드에 애니메이션 클립을 추가한다.

리그에는 JumpAir·JumpLand가 있는데 페이지는 9종에서 멈춰 있었다.
스프라이트 시트는 `mc_character.blend`에서 뽑는다 — 프레임 170×220, 측면,
배경은 기존 시트에서 계측한 색으로 합성한다(§ P0-TECH-PLAN 18).

    python tools/add_showcase_clips.py <시트폴더>
"""

import base64
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "index.html"

FRAME_W = 170

# (액션명, 스프라이트 수, 실제 프레임 수, 재생 시간(s))
# 실제 프레임 수는 마지막 중복 프레임을 뺀 값이다 — 기존 카드들과 같은 규칙.
CLIPS = [
    ("JumpAir", 17, 16, 0.53),
    ("JumpLand", 9, 8, 0.27),
]

# 이 클립 뒤에 끼워 넣는다 (점프 계열이 붙어 있어야 읽힌다)
AFTER = "Jump"


def article(name: str, n: int, frames: int, dur: float, b64: str) -> str:
    return (
        f'<article class="card" data-n="{n}" data-dur="{dur:.2f}" data-loop="0">'
        f'<div class="view"><div class="sprite" style="background-image:url(&quot;'
        f'data:image/jpeg;base64,{b64}&quot;);background-size:{n * 100}% 100%"></div>'
        f'<span class="fno">01 / {n}</span><span class="paused">정지</span></div>'
        f'<div class="cmeta"><div class="crow"><span class="cname">{html.escape(name)}</span>'
        f'<span class="tag">ONCE</span></div>'
        f'<div class="cstat"><span><b>{frames}</b>f</span><span><b>{dur:.2f}</b>s</span></div>'
        f'<input type="range" min="0" max="{n - 1}" value="0" step="1" '
        f'aria-label="{html.escape(name)} 프레임"></div></article>'
    )


def main(sheets: Path) -> None:
    doc = HTML.read_text(encoding="utf-8")
    start = doc.find('<div class="detail" data-char="mc"')
    end = doc.find('<div class="detail" data-char=', start + 40)
    card = doc[start:end]

    if any(f'<span class="cname">{n}</span>' in card for n, *_ in CLIPS):
        raise SystemExit("이미 추가돼 있다 — 두 번 넣지 않는다")

    anchor = re.search(
        rf'<article class="card"(?:(?!</article>).)*?<span class="cname">{AFTER}</span>.*?</article>',
        card, re.S,
    )
    if not anchor:
        raise SystemExit(f"{AFTER} 카드를 찾지 못했다")

    added = []
    for name, n, frames, dur in CLIPS:
        raw = (sheets / f"{name}.jpg").read_bytes()
        added.append(article(name, n, frames, dur, base64.b64encode(raw).decode("ascii")))
        print(f"  {name}: {n}프레임 · {len(raw) // 1024}KB")

    card = card[:anchor.end()] + "".join(added) + card[anchor.end():]

    # 헤더의 종수 갱신 — 실제 article 수에서 센다. 손으로 적으면 또 어긋난다.
    total = len(re.findall(r'<article class="card"', card))
    card, k = re.subn(r"(<h3>애니메이션\s*)\d+(\s*종</h3>)", rf"\g<1>{total}\g<2>", card)
    if k != 1:
        raise SystemExit("애니메이션 종수 문구를 갱신하지 못했다")

    HTML.write_text(doc[:start] + card + doc[end:], encoding="utf-8")
    print(f"애니메이션 {total}종 · index.html {HTML.stat().st_size // 1024}KB")


main(Path(sys.argv[1]))
