#!/usr/bin/env python3
"""실행 중인 Blender 애드온 소켓(127.0.0.1:9876) 직결 헬퍼.

등록된 mcp__Blender__* 도구 래퍼가 전부 타임아웃하므로 애드온 프로토콜을 직접 쓴다.

  python3 bl.py code <파일.py>     # 파이썬 파일을 Blender 안에서 실행 (stdout 회수)
  python3 bl.py scene              # get_scene_info
  python3 bl.py shot <출력.png>    # 뷰포트 스크린샷
"""
import socket, json, sys, os

HOST, PORT = "127.0.0.1", 9876


def call(cmd, params=None, timeout=600):
    s = socket.create_connection((HOST, PORT), timeout=timeout)
    s.settimeout(timeout)
    s.sendall(json.dumps({"type": cmd, "params": params or {}}).encode())
    buf = b""
    while True:
        chunk = s.recv(1 << 20)
        if not chunk:
            break
        buf += chunk
        try:
            d = json.loads(buf.decode())
            s.close()
            return d
        except Exception:
            continue
    s.close()
    if not buf:
        raise RuntimeError("empty response from Blender addon")
    return json.loads(buf.decode())


def run_code(src, timeout=600):
    r = call("execute_code", {"code": src}, timeout)
    if r.get("status") != "success":
        raise RuntimeError("Blender error: %s" % r.get("message"))
    return r["result"].get("result", "")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    mode = sys.argv[1]
    if mode == "code":
        src = open(sys.argv[2]).read()
        out = run_code(src)
        print(out, end="")
        # 스크립트가 실패를 알리는 관례: 마지막 줄에 'ERROR:' 를 찍는다
        if "ERROR:" in out:
            return 1
    elif mode == "scene":
        print(json.dumps(call("get_scene_info"), ensure_ascii=False, indent=1))
    elif mode == "shot":
        out = os.path.abspath(sys.argv[2])
        r = call("get_viewport_screenshot",
                 {"max_size": int(sys.argv[3]) if len(sys.argv) > 3 else 1200,
                  "filepath": out, "format": "png"})
        if r.get("status") != "success":
            raise RuntimeError(r.get("message"))
        print(json.dumps(r["result"]))
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
