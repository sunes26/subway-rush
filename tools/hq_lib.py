"""고품질 마감 패스가 공유하는 메시 조립기.

레퍼런스(TurboSquid 1402902 와이어프레임 · 홍대입구역 2호선 실사)를 대조해 보면
품질 차이는 형태가 아니라 **면의 분할 수**에서 갈린다. 큰 면 하나를 그대로 두지 않고
모듈·리빌·트림으로 쪼개면 폴리곤이 늘어난 만큼 정보량이 늘어난다.

그래서 이 라이브러리는 두 가지만 한다.

  1. `Batch` — 같은 머티리얼의 조각 수천 개를 **한 메시로 누적**한다.
     오브젝트를 1,000개 만들면 씬이 못 버티고, 익스포트도 느려진다.
  2. 상자·튜브·판 헬퍼 — 감김 순서를 한 곳에 박아 둔다.

감김 순서를 손으로 쓰면 반드시 틀린다. 이 프로젝트에서 같은 뿌리의 결함이
여덟 번 나왔고 전부 "어느 면이 카메라를 향하는가"였다. `docs` 대신
`station-facing-rules` 메모를 참고할 것.
"""

from __future__ import annotations

import math

import bpy

# 바깥을 향하는 감김 (v0..v3 = z0면 CCW, v4..v7 = z1면)
BOX_FACES = (
    (3, 2, 1, 0),
    (4, 5, 6, 7),
    (1, 5, 4, 0),
    (2, 6, 5, 1),
    (3, 7, 6, 2),
    (0, 4, 7, 3),
)


def mat(name: str, rgb, emit=None, strength: float = 0.0, metallic: float = 0.0,
        roughness: float = 0.6):
    """머티리얼을 만들거나 가져온다.

    색은 **두 곳**에 넣는다 — `diffuse_color`는 Blender 뷰포트(Workbench)가 읽고,
    Principled Base Color는 glTF `baseColorFactor`로 나가 게임이 읽는다.
    한쪽만 고치면 Blender와 웹의 색이 갈라진다.
    """
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = (*rgb, 1.0)
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


class Batch:
    """한 머티리얼의 조각들을 한 메시로 누적한다."""

    def __init__(self, name: str, material):
        self.name = name
        self.material = material
        self.verts: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []

    # ── 기본 도형 ────────────────────────────────────────────────
    def box(self, x0, y0, z0, x1, y1, z1):
        x0, x1 = min(x0, x1), max(x0, x1)
        y0, y1 = min(y0, y1), max(y0, y1)
        z0, z1 = min(z0, z1), max(z0, z1)
        n = len(self.verts)
        self.verts += [
            (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
            (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
        ]
        self.faces += [tuple(n + i for i in f) for f in BOX_FACES]

    def bevel_box(self, x0, y0, z0, x1, y1, z1, r=0.012):
        """모서리를 깎은 상자.

        베벨 모디파이어를 340개에 걸었더니 용량이 6.7 MB까지 갔다.
        같은 효과를 지오메트리로 직접 만들면 예측 가능한 만큼만 늘어난다 —
        상자 하나당 6면 → 26면.
        """
        x0, x1 = min(x0, x1), max(x0, x1)
        y0, y1 = min(y0, y1), max(y0, y1)
        z0, z1 = min(z0, z1), max(z0, z1)
        r = min(r, (x1 - x0) / 2.5, (y1 - y0) / 2.5, (z1 - z0) / 2.5)
        if r <= 1e-4:
            return self.box(x0, y0, z0, x1, y1, z1)
        n = len(self.verts)
        xs, ys, zs = (x0 + r, x1 - r), (y0 + r, y1 - r), (z0 + r, z1 - r)
        # 8각 단면을 z로 3단(하 챔퍼 · 몸통 · 상 챔퍼) 쌓는다
        ring = lambda ix, iy: [
            (xs[0], y0 + iy, 0), (xs[1], y0 + iy, 0),
            (x1 + ix, ys[0], 0), (x1 + ix, ys[1], 0),
            (xs[1], y1 - iy, 0), (xs[0], y1 - iy, 0),
            (x0 - ix, ys[1], 0), (x0 - ix, ys[0], 0),
        ]
        levels = [(-r, r, z0), (0.0, 0.0, zs[0]), (0.0, 0.0, zs[1]), (-r, r, z1)]
        for ix, iy, z in levels:
            for vx, vy, _ in ring(ix, iy):
                self.verts.append((vx, vy, z))
        for lv in range(3):
            a, b = n + lv * 8, n + (lv + 1) * 8
            for i in range(8):
                j = (i + 1) % 8
                self.faces.append((a + i, a + j, b + j, b + i))
        self.faces.append(tuple(n + i for i in range(7, -1, -1)))
        self.faces.append(tuple(n + 24 + i for i in range(8)))

    def tube(self, axis, a0, a1, u, v, radius, seg=12, cap=True):
        """`axis`('x'|'y'|'z') 방향 원통. (u, v)는 나머지 두 축의 중심.

        단면을 반시계로 돌렸을 때 법선이 바깥을 향하는지는 **축마다 부호가 다르다.**
        x·z 축은 바깥, y 축만 안쪽이 된다 (오른손 좌표계에서 y가 뒤집힌 짝이다).
        이걸 한 규칙으로 뭉뚱그렸다가 y 방향 덕트가 통째로 안팎이 뒤집혀 나왔다.
        """
        n = len(self.verts)
        flip = (axis == "y")
        ring = [(math.cos(2 * math.pi * i / seg) * radius,
                 math.sin(2 * math.pi * i / seg) * radius) for i in range(seg)]
        for a in (a0, a1):
            for cu, cv in ring:
                if axis == "x":
                    self.verts.append((a, u + cu, v + cv))
                elif axis == "y":
                    self.verts.append((u + cu, a, v + cv))
                else:
                    self.verts.append((u + cu, v + cv, a))
        for i in range(seg):
            j = (i + 1) % seg
            f = (n + i, n + j, n + seg + j, n + seg + i)
            self.faces.append(tuple(reversed(f)) if flip else f)
        if cap:
            lo = tuple(n + i for i in range(seg - 1, -1, -1))
            hi = tuple(n + seg + i for i in range(seg))
            self.faces.append(tuple(reversed(lo)) if flip else lo)
            self.faces.append(tuple(reversed(hi)) if flip else hi)

    def disc(self, cx, cy, z, radius, seg=16, up=True):
        n = len(self.verts)
        for i in range(seg):
            t = 2 * math.pi * i / seg
            self.verts.append((cx + math.cos(t) * radius, cy + math.sin(t) * radius, z))
        idx = range(seg) if up else range(seg - 1, -1, -1)
        self.faces.append(tuple(n + i for i in idx))

    def ring(self, cx, cy, z0, z1, r_in, r_out, seg=24):
        """납작한 고리 — 기둥 걸레받이·캡 몰딩에 쓴다."""
        n = len(self.verts)
        for r in (r_in, r_out):
            for z in (z0, z1):
                for i in range(seg):
                    t = 2 * math.pi * i / seg
                    self.verts.append((cx + math.cos(t) * r, cy + math.sin(t) * r, z))
        # 0:in/z0 1:in/z1 2:out/z0 3:out/z1
        q = lambda k: n + k * seg
        for i in range(seg):
            j = (i + 1) % seg
            self.faces.append((q(2) + i, q(2) + j, q(3) + j, q(3) + i))   # 바깥
            self.faces.append((q(1) + i, q(1) + j, q(0) + j, q(0) + i))   # 안쪽
            self.faces.append((q(3) + i, q(3) + j, q(1) + j, q(1) + i))   # 윗면
            self.faces.append((q(0) + i, q(0) + j, q(2) + j, q(2) + i))   # 아랫면

    def quad(self, pts):
        n = len(self.verts)
        self.verts += list(pts)
        self.faces.append(tuple(n + i for i in range(len(pts))))

    def plate(self, axis, at, u0, v0, u1, v1, flip=False):
        """축에 수직인 한 면짜리 판. 데칼·사인 페이스에 쓴다."""
        if axis == "z":
            p = [(u0, v0, at), (u1, v0, at), (u1, v1, at), (u0, v1, at)]
        elif axis == "y":
            p = [(u0, at, v0), (u1, at, v0), (u1, at, v1), (u0, at, v1)]
        else:
            p = [(at, u0, v0), (at, u1, v0), (at, u1, v1), (at, u0, v1)]
        self.quad(list(reversed(p)) if flip else p)

    # ── 확정 ─────────────────────────────────────────────────────
    def build(self, collection=None, shade_smooth=False):
        if not self.faces:
            return None
        me = bpy.data.meshes.new(self.name)
        me.from_pydata(self.verts, [], self.faces)
        me.validate()
        me.update()
        me.materials.append(self.material)
        for p in me.polygons:
            p.use_smooth = shade_smooth

        # 같은 이름이 이미 있으면 **메시만 갈아 끼운다.**
        # 새 오브젝트를 만들어 rename 하면 방금 만든 쪽이 `.001`이 되고,
        # 그 `.001`을 정리하려다 새것을 지우는 사고가 난다. 빌더는 몇 번을 돌려도
        # 결과가 같아야 한다 — 이 패스들은 렌더를 보며 반복해서 다시 돌린다.
        ob = bpy.data.objects.get(self.name)
        if ob is not None and ob.type == "MESH":
            stale = ob.data
            ob.data = me
            if stale.users == 0:
                bpy.data.meshes.remove(stale)
            return ob
        ob = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        return ob


def zone_collection(name: str):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def frange(a, b, step):
    n = int(round((b - a) / step))
    return [a + i * step for i in range(n + 1)]
