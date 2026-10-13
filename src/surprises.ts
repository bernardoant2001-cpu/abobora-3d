import * as THREE from 'three'
import { audio } from './audio'
import { FX } from './world'

/** gato preto que atravessa a mesa, para, olha para você e mia */
function createCat() {
  const fur = new THREE.MeshStandardMaterial({ color: '#070505', roughness: 0.65 })
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.4, 0.4) })
  const cat = new THREE.Group()

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.3, 6, 14), fur)
  body.rotation.z = Math.PI / 2
  body.position.y = 0.24

  const head = new THREE.Group()
  head.position.set(0.25, 0.36, 0)
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.105, 16, 12), fur))
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.1, 4), fur)
    ear.position.set(0.01, 0.1, s * 0.055)
    ear.rotation.x = s * 0.35
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.019, 10, 8), eyeMat)
    eye.position.set(0.088, 0.018, s * 0.042)
    eye.scale.set(0.6, 1.4, 1)
    head.add(ear, eye)
  }

  const tailCurve = new THREE.CatmullRomCurve3(
    [[-0.2, 0.26, 0], [-0.33, 0.38, 0], [-0.37, 0.58, 0.01], [-0.3, 0.72, 0.03]].map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  )
  const tail = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 24, 0.022, 6), fur)
  const tailPivot = new THREE.Group()
  tailPivot.position.set(-0.2, 0.26, 0)
  tail.position.set(0.2, -0.26, 0)
  tailPivot.add(tail)

  const legGeo = new THREE.CylinderGeometry(0.026, 0.022, 0.2, 8).translate(0, -0.1, 0)
  const legs = [
    [0.13, 0.06],
    [0.13, -0.06],
    [-0.13, 0.06],
    [-0.13, -0.06],
  ].map(([x, z]) => {
    const pivot = new THREE.Group()
    pivot.position.set(x, 0.2, z)
    pivot.add(new THREE.Mesh(legGeo, fur))
    return pivot
  })

  cat.add(body, head, tailPivot, ...legs)
  cat.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null))
  cat.rotation.y = Math.PI
  cat.visible = false
  return { cat, head, tailPivot, legs, eyeMat }
}

/** fantasma de lençol que flutua pela sala quando as luzes apagam */
function createGhost() {
  const profile = [
    [0, 1.0],
    [0.12, 0.98],
    [0.22, 0.9],
    [0.28, 0.75],
    [0.3, 0.5],
    [0.32, 0.25],
    [0.37, 0.0],
  ].map(([r, h]) => new THREE.Vector2(r, h))
  const geo = new THREE.LatheGeometry(profile, 40)
  const base = geo.attributes.position.array.slice()
  const sheet = new THREE.MeshStandardMaterial({
    color: '#f4f0ff',
    emissive: '#c8d4ff',
    emissiveIntensity: 0.7,
    roughness: 0.6,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
  const face = new THREE.MeshBasicMaterial({ color: '#05030a', transparent: true, opacity: 0, depthWrite: false })
  const ghost = new THREE.Group()
  ghost.add(new THREE.Mesh(geo, sheet))
  for (const [x, y, sx, sy] of [[-0.09, 0.72, 1, 1.5], [0.09, 0.72, 1, 1.5], [0, 0.55, 1.1, 1.3]]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), face)
    m.position.set(x, y, 0.27)
    m.scale.set(sx, sy, 0.5)
    ghost.add(m)
  }
  ghost.scale.setScalar(1.5)
  ghost.visible = false
  ghost.traverse((o) => o.layers.set(FX))
  return { ghost, geo, base, sheet, face }
}

export function createSurprises(scene: THREE.Scene) {
  const c = createCat()
  const g = createGhost()
  scene.add(c.cat, g.ghost)

  let catAt = 28
  let catT = -1
  let meowed = false
  let ghostStart: number | null = null
  let ghostT: number | null = null
  let ghostReady = 0
  const STOP = 0.4
  const pos = g.geo.attributes.position

  return {
    /** chamado quando as luzes apagam */
    lightsOff(t: number) {
      if (t < ghostReady || ghostStart !== null || ghostT !== null) return
      ghostStart = t + 1.2
      ghostReady = t + 25
    },
    update(t: number, dt: number) {
      // gato: entra pela direita, para no meio, olha, mia e sai pela esquerda
      if (catT < 0 && t > catAt) {
        catT = 0
        meowed = false
        c.cat.visible = true
      }
      if (catT >= 0) {
        catT += dt
        const walkIn = (4.6 - STOP) / 0.9
        const look = 2.6
        let x: number
        let moving = true
        let turn = 0
        if (catT < walkIn) x = 4.6 - catT * 0.9
        else if (catT < walkIn + look) {
          x = STOP
          moving = false
          const k = (catT - walkIn) / look
          turn = k < 0.85 ? Math.min(1, k * 4) : (1 - k) / 0.15
          if (!meowed && k > 0.3) {
            meowed = true
            audio.meow()
          }
        } else x = STOP - (catT - walkIn - look) * 0.9
        c.cat.position.set(x, 0, 2.0)
        c.head.rotation.y = (turn * Math.PI) / 2
        c.eyeMat.color.setRGB(2.2 + turn * 1.6, 1.8 + turn * 1.2, 0.3)
        const phase = t * 11
        // patas em diagonal andam juntas
        c.legs.forEach((l, i) => (l.rotation.z = moving ? Math.sin(phase + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.5 : 0))
        c.cat.position.y = moving ? Math.abs(Math.sin(phase)) * 0.012 : 0
        c.tailPivot.rotation.x = Math.sin(t * (moving ? 3 : 6)) * (moving ? 0.25 : 0.5)
        if (x < -4.6) {
          catT = -1
          c.cat.visible = false
          catAt = t + 70 + Math.random() * 40
        }
      }

      // fantasma: aparece perto da cortina e atravessa a sala por trás da abóbora
      if (ghostStart !== null && t >= ghostStart) {
        ghostStart = null
        ghostT = 0
        g.ghost.visible = true
        audio.ghost()
      }
      if (ghostT !== null) {
        ghostT += dt
        const D = 7
        const k = ghostT / D
        g.ghost.position.set(3.4 - k * 6.8, 1.0 + k * 0.5 + Math.sin(ghostT * 2.2) * 0.12, -3.0 + Math.sin(k * Math.PI) * 0.6)
        g.ghost.rotation.y = -0.4 + Math.sin(ghostT * 1.3) * 0.25
        const fade = Math.min(1, ghostT / 1.0, (D - ghostT) / 1.2)
        g.sheet.opacity = 0.72 * fade
        g.face.opacity = 0.9 * fade
        const a = pos.array as Float32Array
        for (let i = 0; i < pos.count; i++) {
          const y = g.base[i * 3 + 1]
          if (y > 0.06) continue
          const ang = Math.atan2(g.base[i * 3 + 2], g.base[i * 3])
          a[i * 3 + 1] = y + Math.sin(ang * 7 + ghostT * 4) * 0.05
        }
        pos.needsUpdate = true
        if (ghostT >= D) {
          ghostT = null
          g.ghost.visible = false
        }
      }
    },
  }
}
