"""애니메이션 조립 헬퍼."""
import bpy
import math
from mathutils import Euler

D = math.radians


def ease(u):
    return u * u * (3 - 2 * u)


def curve(f, keys):
    """(프레임, 값) 키 사이를 smoothstep 으로 잇는다."""
    if f <= keys[0][0]:
        return keys[0][1]
    for i in range(len(keys) - 1):
        f0, v0 = keys[i]
        f1, v1 = keys[i + 1]
        if f0 <= f <= f1:
            u = ease((f - f0) / float(f1 - f0)) if f1 > f0 else 0.0
            return v0 + (v1 - v0) * u
    return keys[-1][1]


def lower_at(sample, f0, n, f):
    """샘플을 순환시켜 하체를 가져온다. ONCE 클립도 다리는 계속 숨 쉬어야 한다."""
    k = ((f - 1) % n) + f0
    return {bn: {"loc": list(sn["loc"]),
                 "rot": [math.degrees(x) for x in sn["rot"]]}
            for bn, sn in sample[k].items()}


def lower_cycle(sample, f0, n_src, n_dst, f):
    """소스 사이클을 목표 길이로 리샘플한다.

    루프 클립의 길이가 소스와 다르면(예: 61프레임 Idle → 46프레임 Aim)
    앞에서부터 잘라 쓰면 마지막 프레임이 첫 프레임으로 안 닫힌다(실측 3.3mm).
    소스는 `f1 == f_n` 인 닫힌 주기이므로 `(n-1)` 구간으로 선형 보간한다.
    """
    x = (f - 1) / float(n_dst - 1) * (n_src - 1)
    i0 = min(int(math.floor(x)), n_src - 1)
    t = x - math.floor(x)
    i1 = min(i0 + 1, n_src - 1)
    a, b = sample[f0 + i0], sample[f0 + i1]
    return {bn: {"loc": [a[bn]["loc"][k] * (1 - t) + b[bn]["loc"][k] * t
                         for k in range(3)],
                 "rot": [math.degrees(a[bn]["rot"][k] * (1 - t) + b[bn]["rot"][k] * t)
                         for k in range(3)]}
            for bn in a}


def new_action(name):
    if name in bpy.data.actions:
        raise RuntimeError("action name collision: %s" % name)
    a = bpy.data.actions.new(name)
    a.use_fake_user = True
    return a


def write_action(rig, keyed, name, nframes, framefunc, scene=None):
    """프레임 함수를 돌려 액션을 굽는다. 액션 이름 == 출고 클립 이름."""
    scene = scene or bpy.context.scene
    act = new_action(name)
    ad = rig.animation_data or rig.animation_data_create()
    ad.action = act
    for f in range(1, nframes + 1):
        scene.frame_set(f)
        data = framefunc(f)
        for bn in keyed:
            pb = rig.pose.bones[bn]
            v = data.get(bn, {})
            pb.location = v.get("loc", (0.0, 0.0, 0.0))
            pb.rotation_euler = Euler([D(x) for x in v.get("rot", (0, 0, 0))], 'XYZ')
            pb.keyframe_insert("location", frame=f)
            pb.keyframe_insert("rotation_euler", frame=f)
    ad.action = None
    scene.frame_set(1)
    return act
