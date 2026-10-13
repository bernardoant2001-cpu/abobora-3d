"""
Acessórios da abóbora (chamado por scene.py): chapéu de bruxa, cartola, laço e chifres.

Cada um é um empty (AccWitch, AccTopHat, AccBow, AccHorns) filho da abóbora, em coordenadas locais
dela (y para cima, frente em +z). O site mostra um por vez e prende na tampa.
"""
import bpy
import bmesh
import math
from mathutils import Vector

TAU = math.tau


def V(x, y, z):
    return Vector((x, -z, y))


def _mat(name, color, rough, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    b = m.node_tree.nodes['Principled BSDF']
    h = color.lstrip('#')
    lin = [(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in lin]
    b.inputs['Base Color'].default_value = (*lin, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def _obj(name, bm, material, col, parent, smooth=True):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    ob.parent = parent
    return ob


def _sweep(profile, segs=48, closed=False, warp=None):
    """gira um perfil (raio, altura) em volta do eixo vertical; closed = perfil fechado (anel)"""
    bm = bmesh.new()
    rings = []
    for i in range(segs):
        a = TAU * i / segs
        ring = []
        for r, h in profile:
            x, y, z = math.cos(a) * r, h, math.sin(a) * r
            if warp:
                x, y, z = warp(x, y, z, a, r, h)
            ring.append(bm.verts.new(V(x, y, z)))
        rings.append(ring)
    n = len(profile)
    for i in range(segs):
        a, b = rings[i], rings[(i + 1) % segs]
        for k in range(n if closed else n - 1):
            k2 = (k + 1) % n
            bm.faces.new((a[k], b[k], b[k2], a[k2]))
    if not closed:
        if profile[0][0] > 1e-6:
            bm.faces.new([r[0] for r in reversed(rings)])
        if profile[-1][0] > 1e-6:
            bm.faces.new([r[-1] for r in rings])
    return bm


def _empty(name, loc, rot, col, parent):
    e = bpy.data.objects.new(name, None)
    e.location = V(*loc)
    e.rotation_euler = rot
    e.parent = parent
    col.objects.link(e)
    return e


def _box(name, size, loc, material, col, parent):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(size[0], size[2], size[1]), verts=bm.verts)
    bmesh.ops.translate(bm, vec=V(*loc), verts=bm.verts)
    return _obj(name, bm, material, col, parent, smooth=False)


def _ellipsoid(name, c, s, material, col, parent):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=14, radius=1)
    bmesh.ops.scale(bm, vec=(s[0], s[2], s[1]), verts=bm.verts)
    bmesh.ops.translate(bm, vec=V(*c), verts=bm.verts)
    return _obj(name, bm, material, col, parent)


def _tube(name, pts, radius, material, col, parent, segs=10):
    bm = bmesh.new()
    pts = [V(*p) for p in pts]
    rings = []
    for k, p in enumerate(pts):
        t = k / (len(pts) - 1)
        tan = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        n = tan.cross(Vector((0, 1, 0)))
        if n.length < 1e-4:
            n = tan.cross(Vector((1, 0, 0)))
        n.normalize()
        b = tan.cross(n)
        r = radius(t)
        rings.append([bm.verts.new(p + (n * math.cos(TAU * i / segs) + b * math.sin(TAU * i / segs)) * r) for i in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(rings[0])))
    tip = bm.verts.new(pts[-1] + (pts[-1] - pts[-2]).normalized() * radius(1) * 0.8)
    for i in range(segs):
        bm.faces.new((rings[-1][i], rings[-1][(i + 1) % segs], tip))
    return _obj(name, bm, material, col, parent)


def _smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def _tilted(name, loc, tilt, yaw, col, parent):
    """empty encostado na copa: inclina para acompanhar o cone (tilt) e gira para o lado (yaw)"""
    e = bpy.data.objects.new(name, None)
    e.location = V(*loc)
    e.rotation_euler = (-tilt, 0, yaw)
    e.parent = parent
    col.objects.link(e)
    return e


def _stitches(prefix, w, h, material, col, parent, n=4):
    """pontos de costura cruzando as bordas de um remendo (w × h, no plano xy do pai)"""
    for k in range(n):
        f = (k + 0.5) / n - 0.5
        for x, y, sx, sy in ((f * w, h / 2, 0.012, 0.05), (f * w, -h / 2, 0.012, 0.05),
                             (w / 2, f * h, 0.05, 0.012), (-w / 2, f * h, 0.05, 0.012)):
            _box(prefix, (sx, sy, 0.012), (x, y, 0.012), material, col, parent)


def _spider(col, parent, at, drop, body, thread):
    top = Vector(at)
    end = top - Vector((0, drop, 0))
    _tube('SpiderThread', [tuple(top), tuple(top.lerp(end, 0.5)), tuple(end)], lambda t: 0.004, thread, col, parent, 5)
    c = end - Vector((0, 0.07, 0))
    _ellipsoid('SpiderBody', tuple(c), (0.07, 0.075, 0.06), body, col, parent)
    _ellipsoid('SpiderHead', tuple(c + Vector((0, -0.075, 0.03))), (0.042, 0.04, 0.04), body, col, parent)
    for s in (-1, 1):
        for k in range(4):
            a = (k - 1.5) * 0.45
            base = c + Vector((s * 0.04, -0.03, math.sin(a) * 0.04))
            knee = base + Vector((s * 0.1, 0.07, math.sin(a) * 0.08))
            foot = knee + Vector((s * 0.06, -0.14, math.sin(a) * 0.05))
            _tube('SpiderLeg', [tuple(base), tuple(knee), tuple(foot)], lambda t: 0.009 * (1 - 0.6 * t), body, col, parent, 5)


def witch_hat(col, parent, hat, band, brass, patch, stitch, thread):
    root = _empty('AccWitch', (0.0, 0.05, 0.0), (0.0, 0.06, 0.15), col, parent)
    R0 = 0.56  # raio da copa na base (o site usa para assentar o chapéu na casca)
    RB = 1.38

    # aba larga e ondulada: cai na frente, levanta atrás, borda irregular
    def brim_warp(x, y, z, a, r, h):
        k = max(0.0, (r - R0) / (RB - R0))
        wave = 0.06 * math.sin(5 * a + 0.4) + 0.03 * math.sin(11 * a + 1.3)
        droop = -0.2 * math.sin(a) * k * k + 0.06 * k
        scal = 1 + 0.035 * math.sin(7 * a + 0.8) * k
        return x * scal, y + wave * k + droop, z * scal

    brim = [(R0 - 0.03, 0.0), (0.95, -0.016), (RB - 0.04, -0.035), (RB, -0.012), (RB - 0.03, 0.012), (0.95, 0.026), (R0 - 0.03, 0.045)]
    _obj('WitchBrim', _sweep(brim, 96, True, brim_warp), hat, col, root)

    # copa alta e amassada, com dois vincos e a ponta caída de lado
    H = 1.6

    def center(t):
        bend = _smooth(0.55, 1.0, t)
        return -0.16 * t * t - 0.62 * bend * bend, -0.46 * bend * bend

    def radius(t):
        r = R0 * (1 - t) ** 1.05
        return r * (1 - 0.08 * math.exp(-((t - 0.32) / 0.035) ** 2) - 0.06 * math.exp(-((t - 0.56) / 0.03) ** 2))

    def crown_warp(x, y, z, a, r, h):
        t = h / H
        cx, cy = center(t)
        s = 1 + 0.06 * math.sin(3 * a + t * 9) * (0.3 + t)
        return x * s + cx, y + cy, z * s

    N = 40
    prof = [(radius(k / N), H * k / N) for k in range(N)] + [(0.0, H)]
    _obj('WitchCrown', _sweep(prof, 48, False, crown_warp), hat, col, root)

    # faixa e fivela grande
    hb = lambda h: R0 * (1 - h / H) ** 1.05  # noqa: E731
    _obj('WitchBand', _sweep([(hb(0.03) - 0.005, 0.03), (hb(0.04) + 0.028, 0.045), (hb(0.27) + 0.028, 0.27),
                              (hb(0.27) - 0.005, 0.27)], 64, True), band, col, root)
    slope = math.atan(R0 / H)
    buckle = _tilted('WitchBuckle', (0, 0.15, hb(0.15) + 0.03), slope, 0, col, root)
    for size, loc in (((0.26, 0.045, 0.035), (0, 0.11, 0)), ((0.26, 0.045, 0.035), (0, -0.11, 0)),
                      ((0.045, 0.26, 0.035), (-0.11, 0, 0)), ((0.045, 0.26, 0.035), (0.11, 0, 0)),
                      ((0.03, 0.2, 0.04), (0.0, 0, 0.012))):
        _box('WitchBuckle', size, loc, brass, col, buckle)

    # remendo costurado na copa
    t = 0.42
    cx, cy = center(t)
    pr = _tilted('WitchPatch', (cx + 0.05, H * t + cy, radius(t) * 1.03 + 0.012), slope, 0.28, col, root)
    pr.rotation_euler = (-slope, 0.25, 0.28)
    _box('WitchPatch', (0.24, 0.2, 0.018), (0, 0, 0), patch, col, pr)
    _stitches('WitchStitch', 0.24, 0.2, stitch, col, pr)

    # aranhinha pendurada na aba
    a = math.pi / 2 - 0.75
    r = RB - 0.12
    bx, by, bz = brim_warp(math.cos(a) * r, 0.0, math.sin(a) * r, a, r, 0.0)
    _spider(col, root, (bx, by - 0.01, bz), 0.42, hat, thread)
    return root


def top_hat(col, parent, hat, band, feather):
    root = _empty('AccTopHat', (0.0, 0.02, 0.0), (0.0, -0.05, -0.2), col, parent)
    R0 = 0.4  # raio da copa na base (o site usa para assentar)
    RB = 0.74

    def curl(x, y, z, a, r, h):
        k = max(0.0, (r - 0.45) / (RB - 0.45))
        return x, y + 0.13 * math.cos(a) ** 2 * k * k - 0.03 * math.sin(a) * k, z

    brim = [(R0 - 0.02, 0.0), (0.6, -0.008), (RB - 0.02, 0.01), (RB, 0.035), (RB - 0.04, 0.045), (R0 - 0.02, 0.04)]
    _obj('TopHatBrim', _sweep(brim, 72, True, curl), hat, col, root)

    # copa alta, com cintura, topo alargado, levemente torta e amassada; tampo afundado
    H = 1.0
    N = 30
    rad = lambda t: R0 - 0.055 * math.sin(math.pi * t * 0.95) + 0.075 * t ** 3  # noqa: E731
    prof = [(rad(k / N), H * k / N) for k in range(N + 1)]
    rt = rad(1.0)
    prof += [(rt - 0.012, H + 0.012), (rt * 0.7, H - 0.02), (0.0, H - 0.035)]

    def crooked(x, y, z, a, r, h):
        t = min(h / H, 1.0)
        s = 1 + 0.035 * math.sin(2 * a + t * 5) * t
        return x * s + 0.12 * t * t, y + 0.03 * math.cos(a) * t, z * s

    _obj('TopHatCrown', _sweep(prof, 56, False, crooked), hat, col, root)

    # faixa de cetim com laço do lado esquerdo
    _obj('TopHatBand', _sweep([(rad(0.03) - 0.004, 0.035), (rad(0.04) + 0.022, 0.045), (rad(0.25) + 0.022, 0.25),
                               (rad(0.25) - 0.004, 0.25)], 64, True, crooked), band, col, root)
    side = _empty('TopHatBow', (rad(0.14) + 0.04, 0.14, 0.1), (0, 0, math.pi / 2 + 0.35), col, root)
    for s in (-1, 1):
        lobe = _ellipsoid('TopHatBowLobe', (s * 0.09, 0.0, 0.0), (0.1, 0.065, 0.03), band, col, side)
        lobe.rotation_euler = (0, s * -0.3, 0)
    _ellipsoid('TopHatBowKnot', (0, 0, 0.012), (0.035, 0.045, 0.035), band, col, side)

    # pena escura espetada na faixa, subindo e curvando para trás
    pts = []
    for k in range(25):
        t = k / 24
        pts.append(Vector((rad(0.15) + 0.06 + 0.2 * t, 0.12 + 0.95 * t - 0.15 * t ** 3, -0.02 - 0.5 * t ** 1.6)))
    bm = bmesh.new()
    normal = Vector((1, 0.2, 0.25)).normalized()
    rows = []
    for k, p in enumerate(pts):
        t = k / (len(pts) - 1)
        tan = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        sideways = tan.cross(normal).normalized()
        w = 0.13 * math.sin(math.pi * min(1.0, t * 1.08)) ** 0.7 * (0.75 if k % 4 == 2 else 1.0)
        curl_ = normal * w * w * 2.5
        rows.append([bm.verts.new(V(*(p + sideways * w * s + curl_ * abs(s)))) for s in (-1, 0, 1)])
    for a_, b_ in zip(rows, rows[1:]):
        bm.faces.new((a_[0], b_[0], b_[1], a_[1]))
        bm.faces.new((a_[1], b_[1], b_[2], a_[2]))
    _obj('TopHatFeather', bm, feather, col, root)
    _tube('TopHatQuill', [tuple(p) for p in pts[:14]], lambda t: 0.01 * (1 - 0.5 * t), band, col, root, 6)
    return root


def bow(col, parent, ribbon):
    root = _empty('AccBow', (0.0, 1.04, 0.32), (math.radians(-8), 0, 0.1), col, parent)
    for s in (-1, 1):
        lobe = _ellipsoid('BowLobe', (s * 0.15, 0.03, 0), (0.17, 0.11, 0.05), ribbon, col, root)
        lobe.rotation_euler = (0, s * -0.3, 0)
        tail = _tube('BowTail', [(s * 0.03, 0, 0), (s * 0.08, -0.1, 0.02), (s * 0.11, -0.2, 0.0)],
                     lambda t: 0.035 * (1 - 0.3 * t), ribbon, col, root, 8)
        tail.scale = (1, 0.5, 1)
    _ellipsoid('BowKnot', (0, 0.01, 0.01), (0.055, 0.06, 0.05), ribbon, col, root)
    return root


def horns(col, parent, horn):
    root = _empty('AccHorns', (0, 0, 0), (0, 0, 0), col, parent)
    for s in (-1, 1):
        base = Vector((s * 0.36, 0.84, 0.16))
        pts = []
        for k in range(16):
            t = k / 15
            pts.append(tuple(base + Vector((s * (0.22 * t - 0.18 * t ** 3), 0.5 * t, 0.06 * t))))
        _tube('Horn', pts, lambda t: 0.12 * (1 - t) ** 0.85 + 0.008, horn, col, root, 14)
    return root


def build_accessories(col, pumpkin):
    hat = _mat('AccHat', '#1c1418', 0.75)
    purple = _mat('AccBand', '#4a2463', 0.6)
    red = _mat('AccRibbon', '#8c1c24', 0.45)
    brass = _mat('AccBrass', '#b08a3a', 0.35, 0.85)
    horn = _mat('AccHorn', '#7a1810', 0.4)
    patch = _mat('AccPatch', '#3a2a40', 0.85)
    stitch = _mat('AccStitch', '#d8c7a0', 0.7)
    thread = _mat('AccThread', '#d9d6e6', 0.5)
    satin = _mat('AccSatin', '#5a2a6e', 0.3)
    feather = _mat('AccFeather', '#231a2e', 0.6)
    witch_hat(col, pumpkin, hat, purple, brass, patch, stitch, thread)
    top_hat(col, pumpkin, hat, satin, feather)
    bow(col, pumpkin, red)
    horns(col, pumpkin, horn)
