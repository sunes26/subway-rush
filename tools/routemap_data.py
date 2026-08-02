"""서울교통공사 사이버스테이션 노선 데이터 → CSV.

실행:  python3 tools/routemap_data.py [linedata.js] [out.csv]
       (인자 없이 돌리면 사이버스테이션에서 직접 받는다)

출처
  http://www.seoulmetro.co.kr/kr/cyberStation.do 가 쓰는
  http://www.seoulmetro.co.kr/kr/getLineData.do

왜 이 데이터인가
  처음에는 국가철도공단 표준데이터(실측 위경도)를 썼다. 좌표는 정확하지만
  **역 순서가 없다** — 역번호가 지리 순서가 아니라, 경부선에서 코드 순으로
  이으면 수원역 다음이 독산역(24km)이 된다. 최소신장트리로 우회했지만
  그건 추정이다.

  이 데이터에는 노선마다 **순서대로 늘어선 점 목록**이 있다. 이름이 있는
  점은 역이고, 이름이 없는 점은 노선이 꺾이는 자리다. 그대로 이으면 공식
  노선도의 선 모양이 나온다. 환승 표시(data-marker)와 역명 붙일 방향
  (data-labelPos)까지 들어 있다.

  즉 순서·모양·환승·역명이 전부 원본에 있다. 추정할 것이 없다.
"""
import csv
import json
import os
import re
import subprocess
import sys

URL = "http://www.seoulmetro.co.kr/kr/getLineData.do"
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SRC = sys.argv[1] if len(sys.argv) > 1 else None
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
    REPO, "assets", "data", "seoul_rail.csv")

# 흰색 덧그림 레이어(-1)와 철도가 아닌 한강버스는 뺀다.
SKIP = {"1-GA-1", "RV", "RV-1"}


def fetch():
    if SRC:
        return open(SRC, encoding="utf-8", errors="replace").read()
    out = subprocess.run(["curl", "-sS", "-m", "40", "-L", URL],
                         capture_output=True)
    if out.returncode != 0:
        raise RuntimeError("내려받기 실패: %s" % out.stderr.decode()[:200])
    return out.stdout.decode("utf-8", "replace")


def main():
    raw = fetch()
    body = raw[raw.index("{"):raw.rindex("}") + 1]
    body = re.sub(r",(\s*[}\]])", r"\1", body)      # 후행 쉼표
    data = json.loads(body)

    rows = []
    for key, v in data.items():
        if key in SKIP:
            continue
        a = v.get("attr", {})
        label = (a.get("data-label") or key).strip()
        colour = (a.get("data-color") or "#888888").lstrip("#").upper()
        for seq, st in enumerate(v.get("stations", [])):
            co = st.get("data-coords") or ""
            if "," not in co:
                continue
            x, y = co.split(",")[:2]
            rows.append({
                "line": label, "line_key": key, "colour": colour, "seq": seq,
                "x": float(x), "y": float(y),
                "name": (st.get("station-nm") or "").strip(),
                "sub": (st.get("sub-nm") or "").strip(),
                "marker": (st.get("data-marker") or "").lstrip("@"),
                "label_pos": (st.get("data-labelPos") or "").strip(),
            })

    if not rows:
        raise RuntimeError("역 데이터를 하나도 못 읽었다 — 원본 형식이 바뀌었나")
    named = [r for r in rows if r["name"]]
    if len(named) < 500:
        raise RuntimeError("이름 있는 역이 %d개뿐이다 — 파싱이 깨졌다" % len(named))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["line", "line_key", "colour", "seq",
                                           "x", "y", "name", "sub", "marker",
                                           "label_pos"])
        w.writeheader()
        w.writerows(rows)

    per = {}
    for r in rows:
        per.setdefault(r["line"], [0, 0])
        per[r["line"]][0] += 1
        per[r["line"]][1] += 1 if r["name"] else 0
    print("RAILDATA OK -> %s" % OUT)
    print("  점 %d개 · 역 %d개 · 노선 %d개 · 환승표시 %d개"
          % (len(rows), len(named), len(per),
             sum(1 for r in rows if "interchange" in r["marker"])))
    for k in sorted(per, key=lambda x: -per[x][1]):
        print("    %-12s 점 %3d · 역 %3d" % (k, per[k][0], per[k][1]))


main()
