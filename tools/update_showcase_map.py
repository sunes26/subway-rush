"""
쇼케이스(index.html)의 MAP-01 카드 이미지를 새 렌더로 교체한다.

index.html은 이미지를 base64로 품고 있어 1.9MB짜리 한 파일이다. 손으로 못 고친다.
교체 순서는 카드 안의 `<img>` 등장 순서와 같다 — alt로 대조해 어긋나면 멈춘다.

렌더는 Blender Workbench(플랫 + 캐비티)로 천장을 걷어내고 뽑는다.
게임의 툰 플랫 룩과 결이 맞고, 위에서 보는 도해에 천장을 남기면 지붕만 찍힌다.
"""

import base64
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "index.html"

# (파일명, 이 자리에 있어야 하는 alt) — 순서가 곧 카드 안 등장 순서다
SHOTS = [
    ("00-overview.jpg", "전체 개관"),
    ("01-z3.jpg", "Z3 개찰구"),
    ("02-z2.jpg", "Z2 대합실"),
    ("03-z4.jpg", "Z4 하강"),
    ("04-z5.jpg", "Z5 승강장"),
    ("05-z1.jpg", "Z1 지상"),
    ("06-exit.jpg", "Z1 4번 출구"),
    ("07-psd.jpg", "Z5 안전문"),
    ("08-flow.jpg", "Z2 동선"),
]

IMG = re.compile(r'<img alt="([^"]*)" src="data:image/jpeg;base64,([A-Za-z0-9+/=]+)"')


def main(shots_dir: Path) -> None:
    html = HTML.read_text(encoding="utf-8")

    start = html.find('<div class="detail" data-char="map"')
    if start < 0:
        raise SystemExit("MAP-01 카드를 찾지 못했다")
    end = html.find('<div class="detail"', start + 40)
    if end < 0:
        end = len(html)
    card = html[start:end]

    found = IMG.findall(card)
    if len(found) != len(SHOTS):
        raise SystemExit(f"이미지 수가 다르다: 카드 {len(found)} vs 렌더 {len(SHOTS)}")

    idx = 0
    total_before = total_after = 0

    def swap(m: re.Match[str]) -> str:
        nonlocal idx, total_before, total_after
        alt = m.group(1)
        name, expect = SHOTS[idx]
        if alt != expect:
            raise SystemExit(f"{idx}번째 alt 불일치: 문서 '{alt}' vs 기대 '{expect}'")
        raw = (shots_dir / name).read_bytes()
        total_before += len(m.group(2))
        b64 = base64.b64encode(raw).decode("ascii")
        total_after += len(b64)
        idx += 1
        return f'<img alt="{alt}" src="data:image/jpeg;base64,{b64}"'

    card = IMG.sub(lambda m: swap(m) + '"', card)

    # 오브젝트 수 — 실제 익스포트되는 수로 맞춘다
    card = re.sub(r"(<dt>오브젝트</dt><dd>)[\d,]+(</dd>)", r"\g<1>1,572\g<2>", card)

    HTML.write_text(html[:start] + card + html[end:], encoding="utf-8")
    print(f"교체 {idx}장 · base64 {total_before // 1024}KB → {total_after // 1024}KB")
    print(f"index.html {HTML.stat().st_size // 1024}KB")


main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "renders")
