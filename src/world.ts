import * as THREE from 'three'
import { createFlame, flicker } from './flame'

/** camada de efeitos (céu, chamas, tinta, poeira) que fica fora da passada de contornos */
export const FX = 1
const NIGHT = '#140b1f'
const INK = 'rgba(16,9,3,0.92)'

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!] as const
}

function srgb(c: HTMLCanvasElement, repeat = 0) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.setScalar(1 / repeat)
  }
  return t
}

function fx<T extends THREE.Object3D>(o: T) {
  o.traverse((c) => c.layers.set(FX))
  return o
}

// ---------------------------------------------------------------- lá fora

function skyTexture() {
  const [c, g] = canvas(4, 512)
  const grd = g.createLinearGradient(0, 0, 0, 512)
  grd.addColorStop(0, '#04020b')
  grd.addColorStop(0.3, '#0d0824')
  grd.addColorStop(0.44, '#2a1747')
  grd.addColorStop(0.497, '#6a2f63')
  grd.addColorStop(0.5, NIGHT)
  grd.addColorStop(1, '#07040c')
  g.fillStyle = grd
  g.fillRect(0, 0, 4, 512)
  const t = srgb(c)
  t.mapping = THREE.EquirectangularReflectionMapping
  return t
}

/** faixa cilíndrica com colinas, árvores secas, túmulos e a casa assombrada, vista pela janela */
function horizon() {
  const R = 40
  const TOP = 9
  const BOTTOM = -1.5
  const C = Math.PI * 2 * R
  const W = 4096
  const H = 512
  const [c, g] = canvas(W, H)
  const rand = rng(31)
  g.setTransform(W / C, 0, 0, -H / (TOP - BOTTOM), 0, (TOP * H) / (TOP - BOTTOM))

  const wave = (base: number, terms: [number, number, number][]) => (x: number) =>
    terms.reduce((y, [k, a, p]) => y + a * Math.sin((Math.PI * 2 * k * x) / C + p), base)
  const far = wave(3.1, [[3, 0.6, 0.4], [7, 0.35, 1.3], [13, 0.15, 2.1]])
  const near = wave(2.2, [[2, 0.35, 2.2], [5, 0.25, 0.7], [11, 0.1, 1.7]])

  const hills = (f: (x: number) => number, color: string) => {
    g.fillStyle = color
    g.beginPath()
    g.moveTo(0, BOTTOM)
    for (let x = 0; x <= C; x += 0.5) g.lineTo(x, f(x))
    g.lineTo(C, BOTTOM)
    g.fill()
  }
  hills(far, '#2c1946')
  hills(near, NIGHT)

  g.strokeStyle = NIGHT
  g.fillStyle = NIGHT
  g.lineCap = 'round'
  const branch = (x: number, y: number, len: number, ang: number, w: number, depth: number) => {
    const x2 = x + Math.cos(ang) * len
    const y2 = y + Math.sin(ang) * len
    g.lineWidth = w
    g.beginPath()
    g.moveTo(x, y)
    g.quadraticCurveTo((x + x2) / 2 + (rand() - 0.5) * len * 0.4, (y + y2) / 2, x2, y2)
    g.stroke()
    if (depth === 0) return
    const n = rand() < 0.4 ? 3 : 2
    for (let i = 0; i < n; i++) {
      branch(x2, y2, len * (0.6 + rand() * 0.2), ang + (rand() - 0.5) * 1.5, w * 0.62, depth - 1)
    }
  }
  // só árvores distantes; a casa, as lápides e as árvores perto da janela são 3D (blender/scene.py)
  for (const u of [0.05, 0.15, 0.25, 0.35, 0.65, 0.75, 0.85, 0.95]) {
    const x = u * C
    const h = 1.2 + rand() * 1.3
    branch(x, near(x) - 0.2, h, Math.PI / 2 + (rand() - 0.5) * 0.2, 0.22 + rand() * 0.1, 5)
  }

  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, TOP - BOTTOM, 128, 1, true),
    new THREE.MeshBasicMaterial({ map: srgb(c), transparent: true, side: THREE.BackSide, depthWrite: false, fog: false }),
  )
  mesh.position.y = (TOP + BOTTOM) / 2
  mesh.renderOrder = -1
  return mesh
}

function moon() {
  const [c, g] = canvas(512, 512)
  const halo = g.createRadialGradient(256, 256, 60, 256, 256, 256)
  halo.addColorStop(0, 'rgba(255,214,150,0.45)')
  halo.addColorStop(0.45, 'rgba(255,170,110,0.12)')
  halo.addColorStop(1, 'rgba(255,150,100,0)')
  g.fillStyle = halo
  g.fillRect(0, 0, 512, 512)
  const disc = g.createRadialGradient(225, 225, 10, 256, 256, 130)
  disc.addColorStop(0, '#fff6dc')
  disc.addColorStop(1, '#f5d79a')
  g.fillStyle = disc
  g.beginPath()
  g.arc(256, 256, 128, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = 'rgba(214,170,110,0.35)'
  for (const [x, y, r] of [[220, 210, 26], [295, 240, 18], [250, 300, 32], [305, 315, 12], [200, 280, 10]]) {
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: srgb(c), color: new THREE.Color(0.95, 0.95, 0.95), depthWrite: false, fog: false }),
  )
  sprite.position.set(9, 9, -58)
  sprite.scale.setScalar(16)
  return sprite
}

function stars() {
  const rand = rng(5)
  const n = 700
  const pos = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const az = rand() * Math.PI * 2
    const el = Math.asin(0.07 + rand() * 0.93)
    pos.set([Math.cos(az) * Math.cos(el) * 95, Math.sin(el) * 95, Math.sin(az) * Math.cos(el) * 95], i * 3)
    const b = 0.35 + rand() * 0.65
    col.set([b, b, b * (0.85 + rand() * 0.15)], i * 3)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, depthWrite: false, fog: false }),
  )
}

/** morcegos batendo asas em volta de um ponto */
function bats(centers: THREE.Vector3[]) {
  const s = new THREE.Shape()
  s.moveTo(0, 0.06)
  s.quadraticCurveTo(0.25, 0.22, 0.62, 0.16)
  s.quadraticCurveTo(0.5, 0.06, 0.52, -0.06)
  s.quadraticCurveTo(0.42, 0.02, 0.36, -0.08)
  s.quadraticCurveTo(0.27, -0.01, 0.2, -0.1)
  s.quadraticCurveTo(0.12, -0.02, 0, -0.04)
  const wingGeo = new THREE.ShapeGeometry(s)
  wingGeo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshBasicMaterial({ color: '#0b0614', side: THREE.DoubleSide })
  const bodyGeo = new THREE.SphereGeometry(1, 8, 6)
  const flock = centers.flatMap((c, ci) =>
    [0, 1, 2].map((i) => {
      const bat = new THREE.Group()
      const body = new THREE.Mesh(bodyGeo, mat)
      body.scale.set(0.07, 0.06, 0.13)
      const right = new THREE.Mesh(wingGeo, mat)
      const left = new THREE.Mesh(wingGeo, mat)
      left.scale.x = -1
      bat.add(body, right, left)
      bat.scale.setScalar(1.6)
      return { bat, right, left, c, r: 2.2 + i * 1.1, speed: 0.35 + i * 0.12 + ci * 0.05, phase: i * 2.1 + ci }
    }),
  )
  const next = new THREE.Vector3()
  const at = (f: (typeof flock)[number], a: number, out: THREE.Vector3) =>
    out.set(f.c.x + Math.cos(a) * f.r, f.c.y + Math.sin(a * 2) * 0.5, f.c.z + Math.sin(a) * f.r * 0.6)
  return {
    group: new THREE.Group().add(...flock.map((f) => f.bat)),
    update(t: number) {
      for (const f of flock) {
        const a = t * f.speed + f.phase
        at(f, a, f.bat.position)
        f.bat.lookAt(at(f, a + 0.05, next))
        const flap = Math.sin(t * 16 + f.phase) * 0.75
        f.right.rotation.z = flap
        f.left.rotation.z = -flap
      }
    },
  }
}

// ---------------------------------------------------------------- texturas em nanquim

/** linha tremida de bico de pena */
function inkLine(g: CanvasRenderingContext2D, rand: () => number, x0: number, y0: number, x1: number, y1: number, w: number) {
  const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 24))
  g.lineWidth = w
  g.beginPath()
  for (let i = 0; i <= n; i++) {
    const t = i / n
    g.lineTo(x0 + (x1 - x0) * t + (rand() - 0.5) * 1.6, y0 + (y1 - y0) * t + (rand() - 0.5) * 1.6)
  }
  g.stroke()
}

function planks(seed: number, n: number, light: number, vertical = false, joints = true) {
  const S = 512
  const [c, g] = canvas(S, S)
  const rand = rng(seed)
  const w = S / n
  if (vertical) {
    g.translate(S, 0)
    g.rotate(Math.PI / 2)
  }
  g.lineCap = 'round'
  for (let p = 0; p < n; p++) {
    const y0 = p * w
    g.fillStyle = `hsl(${30 + rand() * 8} 48% ${light + (rand() - 0.5) * 10}%)`
    g.fillRect(0, y0, S, w)
    const shade = g.createLinearGradient(0, y0, 0, y0 + w)
    shade.addColorStop(0, 'rgba(40,20,5,0.35)')
    shade.addColorStop(0.25, 'rgba(40,20,5,0)')
    shade.addColorStop(0.8, 'rgba(40,20,5,0)')
    shade.addColorStop(1, 'rgba(40,20,5,0.45)')
    g.fillStyle = shade
    g.fillRect(0, y0, S, w)

    for (let k = 0; k < 7; k++) {
      g.strokeStyle = `rgba(25,12,4,${0.25 + rand() * 0.3})`
      g.lineWidth = 1 + rand() * 1.4
      const yy = y0 + w * (0.15 + rand() * 0.7)
      const xs = rand() * S * 0.4
      const xe = xs + S * (0.35 + rand() * 0.6)
      const f = 0.01 + rand() * 0.02
      g.beginPath()
      for (let x = xs; x <= xe; x += 12) g.lineTo(x, yy + Math.sin(x * f) * (2 + rand()))
      g.stroke()
    }
    if (rand() < 0.5) {
      const kx = 40 + rand() * (S - 80)
      const ky = y0 + w * (0.35 + rand() * 0.3)
      g.strokeStyle = INK
      for (let r = 3; r < 14; r += 4) {
        g.lineWidth = 1.4
        g.beginPath()
        g.ellipse(kx, ky, r * 2.2, r * 0.8, 0, 0, Math.PI * 2)
        g.stroke()
      }
    }
    g.strokeStyle = INK
    inkLine(g, rand, 0, y0 + 1, S, y0 + 1, 3.5)
    if (joints) {
      const jx = (rand() * 0.8 + 0.1) * S
      inkLine(g, rand, jx, y0, jx, y0 + w, 3)
      g.fillStyle = INK
      for (const dx of [-9, 9]) {
        for (const fy of [0.28, 0.72]) {
          g.beginPath()
          g.arc(jx + dx, y0 + w * fy, 2.6, 0, Math.PI * 2)
          g.fill()
        }
      }
    }
  }
  return c
}

function stones() {
  const S = 512
  const [c, g] = canvas(S, S)
  const rand = rng(17)
  g.fillStyle = '#2a1a0c'
  g.fillRect(0, 0, S, S)
  const rows = 4
  const rh = S / rows
  g.lineJoin = 'round'
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -70 : 0
    while (x < S) {
      const w = 110 + rand() * 90
      const cx = x + w / 2
      const cy = r * rh + rh / 2
      const hw = w / 2 - 4
      const hh = rh / 2 - 4
      const j = () => (rand() - 0.5) * 14
      const pts = [
        [cx - hw + j(), cy - hh + j()], [cx + j(), cy - hh + j() * 0.4], [cx + hw + j(), cy - hh + j()],
        [cx + hw + j() * 0.4, cy + j()], [cx + hw + j(), cy + hh + j()], [cx + j(), cy + hh + j() * 0.4],
        [cx - hw + j(), cy + hh + j()], [cx - hw + j() * 0.4, cy + j()],
      ]
      g.beginPath()
      pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)))
      g.closePath()
      g.fillStyle = `hsl(${32 + rand() * 6} 35% ${48 + rand() * 14}%)`
      g.fill()
      const sh = g.createLinearGradient(cx - w / 2, cy - rh / 2, cx + w / 2, cy + rh / 2)
      sh.addColorStop(0, 'rgba(255,240,200,0.18)')
      sh.addColorStop(1, 'rgba(30,15,4,0.4)')
      g.fillStyle = sh
      g.fill()
      g.strokeStyle = INK
      g.lineWidth = 3.5
      g.stroke()
      g.lineWidth = 1.3
      if (rand() < 0.5) {
        inkLine(g, rand, cx - w * 0.2, cy - rh * 0.1, cx + w * 0.1, cy + rh * 0.15, 1.3)
      }
      x += w
    }
  }
  return c
}

/** cartaz de desenho animado antigo com o nosso mascote */
function poster() {
  const W = 512
  const H = 728
  const [c, g] = canvas(W, H)
  const rand = rng(41)
  g.fillStyle = '#e8cf94'
  g.fillRect(0, 0, W, H)
  for (let i = 0; i < 8; i++) {
    const x = rand() * W
    const y = rand() * H
    const r = 40 + rand() * 120
    const st = g.createRadialGradient(x, y, 0, x, y, r)
    st.addColorStop(0, 'rgba(120,70,20,0.2)')
    st.addColorStop(1, 'rgba(120,70,20,0)')
    g.fillStyle = st
    g.fillRect(0, 0, W, H)
  }
  g.strokeStyle = INK
  g.lineWidth = 8
  g.strokeRect(18, 18, W - 36, H - 36)
  g.lineWidth = 2
  g.strokeRect(32, 32, W - 64, H - 64)

  g.fillStyle = INK
  g.textAlign = 'center'
  g.font = '92px Creepster, fantasy'
  g.fillText('ABÓBORA', W / 2, 135)
  g.font = '30px "Special Elite", monospace'
  g.fillText('a Risonha', W / 2, 180)

  const cx = W / 2
  const cy = 420
  g.lineCap = g.lineJoin = 'round'
  // braços de mangueira e luvas
  g.lineWidth = 12
  g.beginPath()
  g.moveTo(cx - 150, cy + 10)
  g.bezierCurveTo(cx - 230, cy - 10, cx - 220, cy - 110, cx - 200, cy - 150)
  g.moveTo(cx + 150, cy + 20)
  g.bezierCurveTo(cx + 220, cy + 30, cx + 230, cy + 90, cx + 205, cy + 130)
  g.stroke()
  for (const [gx, gy] of [[cx - 198, cy - 168], [cx + 205, cy + 148]]) {
    g.fillStyle = '#fff6dc'
    g.lineWidth = 5
    g.beginPath()
    g.arc(gx, gy, 28, 0, Math.PI * 2)
    g.fill()
    g.stroke()
    g.lineWidth = 3
    for (const d of [-8, 0, 8]) {
      g.beginPath()
      g.moveTo(gx + d, gy - 10)
      g.lineTo(gx + d, gy + 4)
      g.stroke()
    }
  }
  // corpo
  g.fillStyle = '#d98a2b'
  g.lineWidth = 6
  g.beginPath()
  g.ellipse(cx, cy, 165, 135, 0, 0, Math.PI * 2)
  g.fill()
  g.stroke()
  g.lineWidth = 4
  for (const dx of [-110, -55, 55, 110]) {
    g.beginPath()
    g.moveTo(cx + dx * 0.35, cy - 132)
    g.quadraticCurveTo(cx + dx * 1.25, cy, cx + dx * 0.35, cy + 132)
    g.stroke()
  }
  g.fillStyle = '#4a3a14'
  g.lineWidth = 5
  g.beginPath()
  g.moveTo(cx - 14, cy - 128)
  g.quadraticCurveTo(cx - 10, cy - 175, cx + 22, cy - 190)
  g.lineTo(cx + 30, cy - 176)
  g.quadraticCurveTo(cx + 10, cy - 165, cx + 14, cy - 128)
  g.closePath()
  g.fill()
  g.stroke()
  // olhos de fatia de torta
  for (const dx of [-55, 55]) {
    g.fillStyle = INK
    g.beginPath()
    g.ellipse(cx + dx, cy - 30, 26, 38, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#fff6dc'
    g.beginPath()
    g.moveTo(cx + dx, cy - 30)
    g.arc(cx + dx, cy - 30, 34, -1.25, -0.65)
    g.closePath()
    g.fill()
  }
  // sorrisão com dentes
  g.fillStyle = INK
  g.beginPath()
  g.moveTo(cx - 105, cy + 25)
  g.quadraticCurveTo(cx, cy + 150, cx + 105, cy + 25)
  g.quadraticCurveTo(cx, cy + 70, cx - 105, cy + 25)
  g.fill()
  g.fillStyle = '#fff6dc'
  for (const dx of [-40, 0, 40]) g.fillRect(cx + dx - 12, cy + 52 + Math.abs(dx) * -0.25, 24, 22)

  g.fillStyle = INK
  g.fillRect(40, 625, W - 80, 62)
  g.fillStyle = '#e8cf94'
  g.font = '28px "Special Elite", monospace'
  g.fillText('em  A NOITE DAS BRUXAS', W / 2, 665)
  const t = srgb(c)
  t.flipY = false
  return t
}

/** retrato sombrio cujos olhos brilham no escuro */
function painting() {
  const W = 256
  const H = 330
  const [c, g] = canvas(W, H)
  const bg = g.createRadialGradient(W / 2, H * 0.4, 10, W / 2, H / 2, H * 0.7)
  bg.addColorStop(0, '#4a4026')
  bg.addColorStop(1, '#0f0c07')
  g.fillStyle = bg
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#0a0806'
  g.beginPath()
  g.ellipse(W / 2, H + 40, 120, 120, 0, 0, Math.PI * 2)
  g.fill()
  g.fillRect(W / 2 - 22, 170, 44, 60)
  g.beginPath()
  g.ellipse(W / 2, 150, 48, 60, 0, 0, Math.PI * 2)
  g.fill()
  g.fillRect(W / 2 - 40, 40, 80, 62)
  g.beginPath()
  g.ellipse(W / 2, 100, 70, 10, 0, 0, Math.PI * 2)
  g.fill()

  const [e, eg] = canvas(W, H)
  eg.fillStyle = '#000'
  eg.fillRect(0, 0, W, H)
  for (const ctx of [g, eg]) {
    ctx.fillStyle = '#ffd23a'
    for (const x of [W / 2 - 18, W / 2 + 18]) {
      ctx.beginPath()
      ctx.ellipse(x, 148, 7, 4, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const map = srgb(c)
  const emissiveMap = srgb(e)
  map.flipY = emissiveMap.flipY = false
  return { map, emissiveMap }
}

function cobwebTexture() {
  const [c, g] = canvas(256, 256)
  g.strokeStyle = 'rgba(235,235,255,0.55)'
  g.lineWidth = 1.2
  const spokes = 7
  const angles = Array.from({ length: spokes }, (_, i) => (i / (spokes - 1)) * (Math.PI / 2))
  for (const a of angles) {
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(Math.cos(a) * 250, Math.sin(a) * 250)
    g.stroke()
  }
  for (let r = 22; r < 240; r += 20 + r * 0.08) {
    g.beginPath()
    angles.forEach((a, i) => {
      const rr = r * (1 + 0.04 * Math.sin(i * 2.3))
      const p = [Math.cos(a) * rr, Math.sin(a) * rr] as const
      if (i === 0) g.moveTo(...p)
      else {
        const m = (angles[i - 1] + a) / 2
        g.quadraticCurveTo(Math.cos(m) * rr * 0.9, Math.sin(m) * rr * 0.9, ...p)
      }
    })
    g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.flipY = false
  return t
}

/** máscara de tinta escorrendo, no tamanho do adesivo (w × h unidades) */
function dripTexture(w: number, h: number, seed: number) {
  const W = Math.min(1024, Math.round(w * 160))
  const H = Math.min(1024, Math.round(h * 160))
  const [c, g] = canvas(W, H)
  const rand = rng(seed)
  g.fillStyle = '#000'
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#fff'
  g.beginPath()
  g.moveTo(0, 0)
  for (let x = 0; x <= W; x += 6) g.lineTo(x, H * 0.04 + Math.sin(x * 0.05) * 3 + rand() * 4)
  g.lineTo(W, 0)
  g.fill()
  const count = Math.max(3, Math.round(w * 7))
  for (let i = 0; i < count; i++) {
    const x = rand() * W
    const dw = 4 + rand() * 9
    const len = H * (0.15 + rand() * 0.8)
    g.beginPath()
    g.moveTo(x - dw, 0)
    g.quadraticCurveTo(x - dw * 0.5, len * 0.5, x - dw * 0.45, len)
    g.lineTo(x + dw * 0.45, len)
    g.quadraticCurveTo(x + dw * 0.5, len * 0.5, x + dw, 0)
    g.fill()
    g.beginPath()
    g.ellipse(x, len, dw * 0.85, dw * 1.1, 0, 0, Math.PI * 2)
    g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.flipY = false
  return t
}

/** telhas arredondadas desenhadas a nanquim */
function shingles() {
  const S = 256
  const [c, g] = canvas(S, S)
  const rand = rng(23)
  g.fillStyle = '#1a120c'
  g.fillRect(0, 0, S, S)
  const rows = 8
  const rh = S / rows
  const tw = 32
  g.strokeStyle = INK
  g.lineWidth = 2.5
  for (let r = rows - 1; r >= 0; r--) {
    for (let x = r % 2 ? -tw / 2 : 0; x < S; x += tw) {
      g.fillStyle = `hsl(${20 + rand() * 10} 18% ${20 + rand() * 12}%)`
      g.beginPath()
      g.moveTo(x, r * rh)
      g.lineTo(x, r * rh + rh * 0.6)
      g.quadraticCurveTo(x + tw / 2, r * rh + rh * 1.35, x + tw, r * rh + rh * 0.6)
      g.lineTo(x + tw, r * rh)
      g.closePath()
      g.fill()
      g.stroke()
    }
  }
  return c
}

function puddleTexture(seed: number) {
  const [c, g] = canvas(256, 256)
  const rand = rng(seed)
  g.fillStyle = '#000'
  g.fillRect(0, 0, 256, 256)
  g.fillStyle = '#fff'
  for (let i = 0; i < 6; i++) {
    g.beginPath()
    g.ellipse(128 + (rand() - 0.5) * 90, 128 + (rand() - 0.5) * 80, 30 + rand() * 45, 25 + rand() * 35, rand() * 3, 0, Math.PI * 2)
    g.fill()
  }
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2
    const r = 95 + rand() * 25
    g.beginPath()
    g.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r * 0.9, 3 + rand() * 6, 0, Math.PI * 2)
    g.fill()
  }
  return new THREE.CanvasTexture(c)
}

/** troca os materiais exportados do Blender pelas versões desenhadas a nanquim */
function dress(root: THREE.Object3D) {
  const wood = planks(11, 5, 58)
  const tex: Record<string, (m: THREE.MeshStandardMaterial) => void> = {
    TableWood: (m) => (m.map = srgb(wood, 2.6)),
    Floor: (m) => (m.map = srgb(planks(29, 6, 46), 3.2)),
    DarkWood: (m) => (m.map = srgb(planks(7, 4, 34, false, false), 2.2)),
    Wallpaper: (m) => (m.map = srgb(planks(13, 5, 52, true), 2.6)),
    Stone: (m) => (m.map = srgb(stones(), 2.2)),
    // lá fora fica escuro de propósito: silhueta contra o céu, com as janelas acesas se destacando
    HouseWall: (m) => {
      m.map = srgb(planks(37, 6, 34, true), 2.4)
      m.color.set('#221a22')
    },
    HouseRoof: (m) => {
      m.map = srgb(shingles(), 1.6)
      m.color.set('#2e2428')
    },
    HouseTrim: (m) => m.color.set('#120c0a'),
    // brilho contido: com mais que isso o halo do bloom lava a fachada inteira
    HouseWindowLit: (m) => (m.emissiveIntensity = 1.6),
    HouseWindowFlicker: (m) => (m.emissiveIntensity = 1.6),
    OutsideGround: (m) => m.color.set('#110c12'),
    Grave: (m) => m.color.set('#2a2630'),
    Poster: (m) => (m.map = poster()),
    Painting: (m) => {
      Object.assign(m, painting())
      m.emissive.set('#ffffff')
      m.emissiveIntensity = 3
    },
    Cobweb: (m) => {
      m.map = cobwebTexture()
      m.transparent = true
      m.depthWrite = false
      m.color.set('#a8a6c0')
    },
  }
  const done = new Set<THREE.Material>()
  let seed = 1
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = mesh.receiveShadow = true
    const first = [mesh.material].flat()[0] as THREE.MeshStandardMaterial
    if (first.name === 'InkDrip' || first.name === 'InkPuddle') {
      mesh.geometry.computeBoundingBox()
      const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3())
      mesh.material = new THREE.MeshStandardMaterial({
        color: '#0b0603',
        roughness: first.name === 'InkPuddle' ? 0.08 : 0.22,
        alphaMap: first.name === 'InkDrip' ? dripTexture(size.x, size.y, seed++) : puddleTexture(seed++),
        alphaTest: 0.5,
      })
      mesh.castShadow = false
      fx(mesh)
      return
    }
    for (const m of [mesh.material].flat() as THREE.MeshStandardMaterial[]) {
      if (m.name === 'Cobweb') {
        mesh.castShadow = false
        fx(mesh)
      }
      if (done.has(m)) continue
      done.add(m)
      tex[m.name]?.(m)
      m.needsUpdate = true
    }
  })
}

// ---------------------------------------------------------------- fogo, velas, luminária, poeira

/** potes e poções: vidro translúcido com líquido brilhante pela metade, em vez de um bloco emissivo chapado */
function bottles(root: THREE.Object3D) {
  const glass = new THREE.MeshStandardMaterial({
    color: '#e8f0ff',
    roughness: 0.06,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
  })
  // a borda do vidro pega a luz do líquido e desenha o pote mesmo no escuro
  glass.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float edge = 1.0 - abs( dot( normal, normalize( vViewPosition ) ) );
      totalEmissiveRadiance += vec3( 1.0, 0.85, 0.55 ) * pow( edge, 3.0 ) * 0.9;`,
    )
  }
  // brilho mais forte no centro e mais fraco nas bordas: dá volume ao líquido
  const rounded = (m: THREE.MeshStandardMaterial) => {
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance *= 0.15 + 0.85 * pow( abs( dot( normal, normalize( vViewPosition ) ) ), 1.6 );`,
      )
    }
    return m
  }
  const liquids: THREE.MeshStandardMaterial[] = []
  const jars: THREE.Mesh[] = []
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined
    if (m && (m.name === 'JarGlow' || m.name === 'Potion')) jars.push(o as THREE.Mesh)
  })
  for (const jar of jars) {
    const potion = (jar.material as THREE.Material).name === 'Potion'
    const liquid = rounded(
      new THREE.MeshStandardMaterial({
        color: potion ? '#16301c' : '#33240c',
        emissive: potion ? '#7dff9a' : '#ffc95a',
        emissiveIntensity: 1,
        roughness: 0.3,
      }),
    )
    liquids.push(liquid)
    const fill = new THREE.Mesh(jar.geometry, liquid)
    fill.scale.set(0.8, 0.6, 0.8)
    fill.position.y = 0.012
    jar.material = glass
    jar.castShadow = false
    jar.add(fill)
  }
  return (t: number) => liquids.forEach((l, i) => (l.emissiveIntensity = 0.55 + 0.35 * flicker(t * 0.35, 40 + i)))
}

function fireplace(at: THREE.Vector3, embers?: THREE.MeshStandardMaterial) {
  const group = new THREE.Group()
  group.position.copy(at)
  const tongues = [
    [-0.4, 0.42],
    [-0.2, 0.62],
    [0.0, 0.75],
    [0.2, 0.6],
    [0.4, 0.45],
  ].map(([x, h], i) => {
    const f = createFlame(20 + i, h, FX)
    f.group.position.set(x, -0.12, (i % 2) * 0.08 - 0.04)
    group.add(f.group)
    return f
  })
  const light = new THREE.PointLight('#ff7a2a', 14, 0, 2)
  const home = new THREE.Vector3(0, 0.4, 0.5)
  light.position.copy(home)
  group.add(light)
  const warm = new THREE.Color('#ff6a1a')
  const hot = new THREE.Color('#ffa850')
  const emberBase = embers?.emissiveIntensity ?? 1
  return {
    group,
    update(t: number) {
      const f = flicker(t, 3)
      tongues.forEach((tg, i) => tg.update(t, 0.75 + 0.5 * flicker(t, 20 + i)))
      light.intensity = 14 * f
      light.color.copy(warm).lerp(hot, (f - 0.72) / 0.28)
      light.position.set(home.x + (flicker(t * 1.3, 5) - 0.86) * 0.4, home.y + (flicker(t, 6) - 0.86) * 0.2, home.z)
      if (embers) embers.emissiveIntensity = emberBase * (0.6 + 0.6 * flicker(t * 0.6, 9))
    },
  }
}

function dust() {
  const rand = rng(3)
  const n = 90
  const pos = new Float32Array(n * 3)
  const seed = Array.from({ length: n }, () => [rand() * 6 - 3, rand() * 3.6, rand() * 6.5 - 4.5, 0.02 + rand() * 0.06, rand() * 6])
  const [c, g] = canvas(64, 64)
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.35, 'rgba(255,255,255,0.4)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.035,
      map: new THREE.CanvasTexture(c),
      color: new THREE.Color(1.3, 1.2, 0.9),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  points.frustumCulled = false
  const update = (t: number) => {
    seed.forEach(([x, y, z, speed, ph], i) => {
      pos[i * 3] = x + Math.sin(t * 0.25 + ph) * 0.3
      pos[i * 3 + 1] = ((y + t * speed) % 3.6) + 0.1
      pos[i * 3 + 2] = z + Math.cos(t * 0.2 + ph) * 0.2
    })
    geo.attributes.position.needsUpdate = true
  }
  return { points, update }
}

function findMaterial(root: THREE.Object3D, name: string) {
  const all: THREE.Material[] = []
  root.traverse((o) => all.push(...[(o as THREE.Mesh).material ?? []].flat()))
  return all.find((m) => m.name === name) as THREE.MeshStandardMaterial | undefined
}

export function createWorld(scene: THREE.Scene, room: THREE.Object3D) {
  scene.background = skyTexture()
  // névoa só alcança a paisagem lá fora (a sala inteira fica a menos de 16 unidades da câmera)
  scene.fog = new THREE.Fog('#2b1b33', 22, 110)
  scene.add(fx(horizon()), fx(moon()), fx(stars()), room)
  dress(room)
  const updateBottles = bottles(room)

  const flock = bats(['BatsMoon', 'BatsTower'].map((n) => room.getObjectByName(n)!.position))
  scene.add(flock.group)
  const flickerWin = findMaterial(room, 'HouseWindowFlicker')
  const flickerBase = flickerWin?.emissiveIntensity ?? 1

  // pouca luz ambiente: a sala vive das poças de luz (lâmpada, velas, lareira, abóbora)
  const hemi = new THREE.HemisphereLight('#d9b27a', '#2a1808', 0.32)
  const fill = new THREE.DirectionalLight('#ffd9a8', 0.3)
  fill.position.set(3, 5, 8)
  const moonLight = new THREE.DirectionalLight('#c9d4ff', 1.6)
  moonLight.position.set(6, 9, -16)
  moonLight.castShadow = true
  moonLight.shadow.mapSize.set(2048, 2048)
  moonLight.shadow.radius = 3
  const cam = moonLight.shadow.camera
  cam.left = cam.bottom = -8
  cam.right = cam.top = 8
  cam.near = 1
  cam.far = 45
  moonLight.shadow.bias = -0.0005
  moonLight.shadow.normalBias = 0.03
  scene.add(hemi, fill, moonLight)

  // luminária pendente balançando sobre a mesa, com falhas de vez em quando
  const pivot = room.getObjectByName('LampPivot')!
  const bulbAt = room.getObjectByName('Lamp')!.position
  const spot = new THREE.SpotLight('#ffd89a', 38, 14, 0.78, 0.65, 2)
  spot.position.copy(bulbAt)
  spot.target.position.set(bulbAt.x, bulbAt.y - 3, bulbAt.z)
  spot.castShadow = true
  spot.shadow.mapSize.set(1024, 1024)
  spot.shadow.radius = 6
  spot.shadow.bias = -0.0006
  spot.shadow.normalBias = 0.02
  spot.shadow.camera.near = 0.1
  spot.shadow.camera.far = 14
  pivot.add(spot, spot.target)
  const bulb = (room.getObjectByName('LampBulb') as THREE.Mesh).material as THREE.MeshStandardMaterial
  const bulbGlow = bulb.emissiveIntensity * 0.4
  pivot.traverse((o) => (o.castShadow = false))
  let glitchAt = 9
  const glitch = (t: number) => {
    if (t > glitchAt + 0.7) glitchAt = t + 7 + Math.random() * 12
    if (t < glitchAt) return 1
    return Math.sin(t * 83) > 0.15 ? 1 : 0.12
  }

  // velas: cada chama com sua tremulação; uma luz para o grupo da mesa e outra para a lareira
  const candles: { flame: ReturnType<typeof createFlame>; seed: number; group: string }[] = []
  const centers: Record<string, THREE.Vector3> = { Table: new THREE.Vector3(), Mantel: new THREE.Vector3() }
  const counts: Record<string, number> = { Table: 0, Mantel: 0 }
  room.updateMatrixWorld(true)
  room.traverse((o) => {
    if (!o.name.startsWith('Flame')) return
    const group = o.name.includes('Table') ? 'Table' : 'Mantel'
    const seed = 60 + candles.length * 7
    const flame = createFlame(seed, group === 'Table' ? 0.14 : 0.1, FX)
    o.getWorldPosition(flame.group.position)
    flame.group.position.y -= 0.04
    scene.add(flame.group)
    candles.push({ flame, seed, group })
    centers[group].add(flame.group.position)
    counts[group]++
  })
  const candleLights = (['Table', 'Mantel'] as const).map((g, i) => {
    const light = new THREE.PointLight('#ffae5c', g === 'Table' ? 1.8 : 0.9, g === 'Table' ? 6 : 4.5, 2)
    const home = centers[g].divideScalar(Math.max(1, counts[g])).add(new THREE.Vector3(0, 0.18, 0.12))
    light.position.copy(home)
    scene.add(light)
    return { light, home, base: light.intensity, seed: 80 + i }
  })

  const fireNode = room.getObjectByName('Fire')
  const hearth = fireNode ? fireplace(fireNode.getWorldPosition(new THREE.Vector3()), findMaterial(room, 'Embers')) : null
  if (hearth) scene.add(hearth.group)

  const motes = dust()
  scene.add(fx(motes.points))

  const lerp = THREE.MathUtils.lerp
  return (t: number, mood: number) => {
    hemi.intensity = lerp(0.32, 0.04, mood)
    fill.intensity = lerp(0.3, 0, mood)
    moonLight.intensity = lerp(1.6, 1.3, mood)
    const lamp = glitch(t) * (1 - mood)
    spot.intensity = 38 * lamp
    bulb.emissiveIntensity = bulbGlow * lamp
    pivot.rotation.z = 0.045 * Math.sin(t * 0.8)
    pivot.rotation.x = 0.03 * Math.sin(t * 0.63 + 1.2)
    motes.update(t)
    flock.update(t)
    updateBottles(t)
    if (flickerWin) {
      const k = 0.55 + 0.3 * Math.sin(t * 7.1) + 0.15 * Math.sin(t * 17.3)
      flickerWin.emissiveIntensity = flickerBase * (Math.sin(t * 0.4) > 0.93 ? 0.05 : k)
    }
    hearth?.update(t)
    for (const c of candles) c.flame.update(t, flicker(t, c.seed) * 1.1)
    for (const c of candleLights) {
      const f = flicker(t, c.seed)
      c.light.intensity = c.base * f * (1 + mood * 0.4)
      c.light.position.set(c.home.x + (flicker(t * 1.7, c.seed + 1) - 0.86) * 0.08, c.home.y, c.home.z)
    }
  }
}
