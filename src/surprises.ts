import * as THREE from 'three'
import { audio } from './audio'
import { FX } from './world'

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
  const g = createGhost()
  scene.add(g.ghost)

  let ghostStart: number | null = null
  let ghostT: number | null = null
  let ghostReady = 0
  const pos = g.geo.attributes.position

  return {
    /** chamado quando as luzes apagam */
    lightsOff(t: number) {
      if (t < ghostReady || ghostStart !== null || ghostT !== null) return
      ghostStart = t + 1.2
      ghostReady = t + 25
    },
    update(t: number, dt: number) {
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
