import * as THREE from 'three'
import { createSmallPumpkin, leafGeometry } from './pumpkin'

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

function srgb(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const NIGHT = '#140b1f'

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

/** faixa cilíndrica com colinas, árvores secas, túmulos e a casa assombrada */
function horizon() {
  const R = 40
  const TOP = 9
  const BOTTOM = -1.5
  const C = Math.PI * 2 * R
  const W = 4096
  const H = 512
  const [c, g] = canvas(W, H)
  const rand = rng(31)
  // desenha em unidades do mundo (x ao longo da circunferência, y para cima)
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
  for (const u of [0.05, 0.13, 0.21, 0.3, 0.36, 0.415, 0.475, 0.535, 0.615, 0.68, 0.74, 0.82, 0.9, 0.95]) {
    const x = u * C
    const h = 1.2 + rand() * 1.3
    branch(x, near(x) - 0.2, h, Math.PI / 2 + (rand() - 0.5) * 0.2, 0.22 + rand() * 0.1, 5)
  }

  // túmulos
  for (const [u, s] of [[0.442, 1], [0.452, 0.8], [0.461, 1.1], [0.47, 0.7]]) {
    const x = u * C
    const y = near(x) - 0.15
    g.beginPath()
    g.moveTo(x - 0.35 * s, y)
    g.lineTo(x - 0.35 * s, y + 0.55 * s)
    g.arc(x, y + 0.55 * s, 0.35 * s, Math.PI, 0, true)
    g.lineTo(x + 0.35 * s, y)
    g.fill()
  }

  // casa assombrada
  const hx = 0.548 * C
  const hy = near(hx) - 0.2
  g.beginPath()
  g.rect(hx - 1.6, hy, 3.2, 1.9)
  g.moveTo(hx - 1.9, hy + 1.8)
  g.lineTo(hx, hy + 3.1)
  g.lineTo(hx + 1.9, hy + 1.8)
  g.rect(hx - 2.4, hy, 1.0, 3.2)
  g.moveTo(hx - 2.6, hy + 3.1)
  g.lineTo(hx - 1.9, hy + 4.7)
  g.lineTo(hx - 1.2, hy + 3.1)
  g.rect(hx + 0.8, hy + 2.2, 0.35, 1.1)
  g.fill()
  g.fillStyle = '#ffb347'
  g.shadowColor = '#ff9a2e'
  g.shadowBlur = 18
  for (const [x, y, w, h] of [
    [-2.05, 2.2, 0.3, 0.45],
    [-1.1, 0.8, 0.45, 0.5],
    [0.6, 0.8, 0.45, 0.5],
    [-0.18, 2.05, 0.36, 0.36],
  ]) {
    g.fillRect(hx + x, hy + y, w, h)
  }
  g.shadowBlur = 0

  // morcegos
  g.fillStyle = '#0b0614'
  for (const [u, y, s] of [[0.43, 7.4, 0.5], [0.445, 8.1, 0.35], [0.418, 8.4, 0.3], [0.6, 7.8, 0.4]]) {
    const x = u * C
    g.beginPath()
    g.moveTo(x, y)
    g.quadraticCurveTo(x - 0.5 * s, y + 0.5 * s, x - 1.3 * s, y + 0.4 * s)
    g.quadraticCurveTo(x - 0.9 * s, y + 0.1 * s, x - 0.75 * s, y - 0.15 * s)
    g.quadraticCurveTo(x - 0.4 * s, y, x, y - 0.3 * s)
    g.quadraticCurveTo(x + 0.4 * s, y, x + 0.75 * s, y - 0.15 * s)
    g.quadraticCurveTo(x + 0.9 * s, y + 0.1 * s, x + 1.3 * s, y + 0.4 * s)
    g.quadraticCurveTo(x + 0.5 * s, y + 0.5 * s, x, y)
    g.fill()
  }

  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, TOP - BOTTOM, 128, 1, true),
    new THREE.MeshBasicMaterial({ map: srgb(c), transparent: true, side: THREE.BackSide, fog: false, depthWrite: false }),
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
    new THREE.SpriteMaterial({ map: srgb(c), color: new THREE.Color(1.5, 1.5, 1.5), fog: false, depthWrite: false }),
  )
  sprite.position.set(17, 8.5, -58)
  sprite.scale.setScalar(18)
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
    new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }),
  )
}

function woodTexture() {
  const [c, g] = canvas(1024, 512)
  const rand = rng(11)
  const planks = 5
  const ph = 512 / planks
  for (let p = 0; p < planks; p++) {
    const y0 = p * ph
    g.fillStyle = `hsl(${22 + rand() * 6} 42% ${24 + rand() * 6}%)`
    g.fillRect(0, y0, 1024, ph)
    for (let k = 0; k < 26; k++) {
      g.strokeStyle = `rgba(35,16,6,${0.08 + rand() * 0.14})`
      g.lineWidth = 1 + rand() * 2.5
      const base = y0 + rand() * ph
      const f = 0.004 + rand() * 0.006
      const amp = 2 + rand() * 5
      const ph0 = rand() * 6
      g.beginPath()
      for (let x = 0; x <= 1024; x += 16) g.lineTo(x, base + Math.sin(x * f + ph0) * amp)
      g.stroke()
    }
    if (rand() < 0.7) {
      const kx = 80 + rand() * 860
      const ky = y0 + ph * (0.3 + rand() * 0.4)
      for (let r = 4; r < 26; r += 5) {
        g.strokeStyle = `rgba(40,18,6,${0.35 - r / 100})`
        g.lineWidth = 2
        g.beginPath()
        g.ellipse(kx, ky, r * 1.8, r * 0.7, 0, 0, Math.PI * 2)
        g.stroke()
      }
    }
    g.fillStyle = 'rgba(12,5,2,0.85)'
    g.fillRect(0, y0, 1024, 3)
  }
  const t = srgb(c)
  t.anisotropy = 8
  return t
}

function table() {
  const group = new THREE.Group()
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.78 })
  const top = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.16, 5), wood)
  top.position.set(0, -0.08, 0.6)
  top.receiveShadow = true
  group.add(top)
  const legGeo = new THREE.BoxGeometry(0.22, 2.2, 0.22)
  for (const [x, z] of [[-3.3, -1.6], [3.3, -1.6], [-3.3, 2.8], [3.3, 2.8]]) {
    const leg = new THREE.Mesh(legGeo, wood)
    leg.position.set(x, -1.26, z)
    leg.castShadow = true
    group.add(leg)
  }
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(40, 64),
    new THREE.MeshStandardMaterial({ color: '#1d1426', roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -2.36
  ground.receiveShadow = true
  group.add(ground)
  return group
}

function candles() {
  const group = new THREE.Group()
  const wax = new THREE.MeshStandardMaterial({ color: '#efe3c8', roughness: 0.55 })
  const fire = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.4, 0.7) })
  const flameGeo = new THREE.SphereGeometry(1, 12, 10)
  const flames: THREE.Mesh[] = []
  for (const [x, z, h] of [[-2.15, 0.75, 0.5], [-1.88, 1.0, 0.34], [-2.42, 1.05, 0.24]]) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.082, h, 20), wax)
    body.position.set(x, h / 2, z)
    body.castShadow = true
    const flame = new THREE.Mesh(flameGeo, fire)
    flame.position.set(x, h + 0.06, z)
    flame.scale.set(0.028, 0.06, 0.028)
    flames.push(flame)
    group.add(body, flame)
  }
  const light = new THREE.PointLight('#ffae5c', 1.4, 6, 2)
  light.position.set(-2.15, 0.75, 0.9)
  group.add(light)
  return { group, flames, light }
}

function tableLeaves() {
  const rand = rng(23)
  const geo = leafGeometry()
  const group = new THREE.Group()
  const colors = ['#c2410c', '#b45309', '#9a3412', '#d97706', '#7c2d12']
  const spots = [[-1.3, 1.25], [1.5, 1.1], [0.9, 1.55], [-0.6, 1.6], [2.5, -0.2], [-2.8, 0.2], [1.9, 0.6], [-1.6, -0.9]]
  spots.forEach(([x, z], i) => {
    const leaf = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.8, side: THREE.DoubleSide }),
    )
    leaf.position.set(x, 0.03, z)
    leaf.rotation.set(-Math.PI / 2 + (rand() - 0.5) * 0.2, 0, rand() * Math.PI * 2)
    leaf.scale.setScalar(0.7 + rand() * 0.5)
    leaf.receiveShadow = true
    group.add(leaf)
  })
  return group
}

function embers() {
  const rand = rng(3)
  const n = 60
  const pos = new Float32Array(n * 3)
  const seed = Array.from({ length: n }, () => [rand() * 8 - 4, rand() * 3.2, rand() * 4 - 2.4, 0.1 + rand() * 0.25, rand() * 6])
  const [c, g] = canvas(64, 64)
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.3, 'rgba(255,255,255,0.5)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.07,
      map: new THREE.CanvasTexture(c),
      color: new THREE.Color(2.4, 1.2, 0.35),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  points.frustumCulled = false
  const update = (t: number) => {
    seed.forEach(([x, y, z, speed, ph], i) => {
      pos[i * 3] = x + Math.sin(t * 0.4 + ph) * 0.35
      pos[i * 3 + 1] = (y + t * speed) % 3.2 + 0.2
      pos[i * 3 + 2] = z + Math.cos(t * 0.3 + ph) * 0.25
    })
    geo.attributes.position.needsUpdate = true
  }
  return { points, update }
}

export function createWorld(scene: THREE.Scene, geo: THREE.BufferGeometry) {
  scene.background = skyTexture()
  scene.fog = new THREE.Fog(NIGHT, 12, 40)
  scene.add(horizon(), moon(), stars(), table(), tableLeaves())

  const lamps = candles()
  scene.add(lamps.group)

  for (const [x, z, s, r] of [[2.25, -0.55, 0.34, 0.4], [2.85, 0.45, 0.24, 1.7], [-2.6, -0.9, 0.29, 2.6]]) {
    const p = createSmallPumpkin(geo, s)
    p.position.x = x
    p.position.z = z
    p.rotation.y = r
    scene.add(p)
  }

  const sparks = embers()
  scene.add(sparks.points)

  return (t: number) => {
    sparks.update(t)
    lamps.flames.forEach((f, i) => {
      const k = 0.85 + 0.15 * Math.sin(t * (11 + i * 3) + i)
      f.scale.y = 0.06 * k
    })
    lamps.light.intensity = 1.4 * (0.9 + 0.1 * Math.sin(t * 9.3))
  }
}
