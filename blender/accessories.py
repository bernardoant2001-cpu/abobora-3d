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


def witch_hat(col, parent, hat, band, brass):
    root = _empty('AccWitch', (0.0, 0.97, 0.02), (0.1, 0.0, 0.08), col, parent)
    brim = [(0.34, 0.0), (0.7, -0.012), (0.99, -0.03), (1.02, -0.01), (0.99, 0.012), (0.7, 0.02), (0.34, 0.035)]
    _obj('WitchBrim', _sweep(brim, 64, True, lambda x, y, z, a, r, h: (x, y + 0.05 * math.sin(2 * a + 0.6) * (r / 1.0) ** 2, z)),
         hat, col, root)

    H = 1.2

    def bend(x, y, z, a, r, h):
        t = h / H
        return x - 0.42 * t ** 2.6, y - 0.12 * t ** 3, z + 0.08 * t ** 3

    cone = [(0.0, 0.0)] + [(0.43 * (1 - (k / 14)) ** 1.15 * (1 + 0.035 * math.sin(k * 1.7)), H * k / 14) for k in range(15)]
    cone[-1] = (0.0, H)
    _obj('WitchCrown', _sweep(cone[1:], 40, False, bend), hat, col, root)
    _obj('WitchBand', _sweep([(0.425, 0.03), (0.445, 0.04), (0.425, 0.17), (0.4, 0.17)], 48, True), band, col, root)
    for size, loc in (((0.16, 0.025, 0.03), (0, 0.16, 0.44)), ((0.16, 0.025, 0.03), (0, 0.05, 0.44)),
                      ((0.025, 0.13, 0.03), (-0.07, 0.105, 0.44)), ((0.025, 0.13, 0.03), (0.07, 0.105, 0.44))):
        _box('WitchBuckle', size, loc, brass, col, root)
    return root


def top_hat(col, parent, hat, band):
    root = _empty('AccTopHat', (0.0, 0.96, 0.0), (0.06, 0.0, -0.1), col, parent)
    brim = [(0.34, 0.0), (0.55, -0.005), (0.64, 0.01), (0.65, 0.03), (0.6, 0.035), (0.34, 0.035)]

    def curl(x, y, z, a, r, h):
        k = max(0.0, (r - 0.4) / 0.25)
        return x, y + 0.09 * math.cos(a) ** 2 * k * k, z

    _obj('TopHatBrim', _sweep(brim, 64, True, curl), hat, col, root)
    _obj('TopHatCrown', _sweep([(0.355, 0.02), (0.37, 0.3), (0.395, 0.62), (0.41, 0.78), (0.0, 0.79)], 48), hat, col, root)
    _obj('TopHatBand', _sweep([(0.362, 0.04), (0.378, 0.05), (0.384, 0.2), (0.37, 0.2)], 48, True), band, col, root)
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
    witch_hat(col, pumpkin, hat, purple, brass)
    top_hat(col, pumpkin, hat, red)
    bow(col, pumpkin, red)
    horns(col, pumpkin, horn)
