import * as THREE from 'three'

// tampo da mesa e chão (mesmas medidas de blender/scene.py)
const TABLE = { x0: -3.55, x1: 3.55, z0: -1.85, z1: 3.05 }
const FLOOR = -2.36
const MAX = 240

type Bit = {
  kind: 0 | 1
  p: THREE.Vector3
  v: THREE.Vector3
  q: THREE.Quaternion
  spin: THREE.Vector3
  size: number
  resting: boolean
  hit: boolean
}

/** sementes e pedacinhos de polpa que saltam enquanto a abóbora é cortada */
export type Collider = { center: THREE.Vector3; radius: number; height: number }

export function createSeeds(scene: THREE.Scene, collider: () => Collider, onHit: () => void) {
  const seedGeo = new THREE.SphereGeometry(1, 10, 6).scale(1, 0.32, 0.6)
  const chunkGeo = new THREE.IcosahedronGeometry(1, 0)
  const meshes = [
    new THREE.InstancedMesh(seedGeo, new THREE.MeshStandardMaterial({ color: '#efe2b8', roughness: 0.45 }), MAX),
    new THREE.InstancedMesh(chunkGeo, new THREE.MeshStandardMaterial({ color: '#ff9a3c', roughness: 0.6, flatShading: true }), MAX),
  ]
  const zero = new THREE.Matrix4().makeScale(0, 0, 0)
  for (const m of meshes) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    for (let i = 0; i < MAX; i++) m.setMatrixAt(i, zero)
    m.receiveShadow = true
    m.frustumCulled = false
    scene.add(m)
  }
  const slots: (Bit | null)[][] = [Array(MAX).fill(null), Array(MAX).fill(null)]
  const next = [0, 0]
  const mat = new THREE.Matrix4()
  const scl = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  const dq = new THREE.Quaternion()
  const euler = new THREE.Euler()

  const write = (kind: 0 | 1, i: number, b: Bit) => {
    scl.set(b.size, b.size, b.size)
    meshes[kind].setMatrixAt(i, mat.compose(b.p, b.q, scl))
    meshes[kind].instanceMatrix.needsUpdate = true
  }

  return {
    spawn(point: THREE.Vector3, normal: THREE.Vector3, n = 1) {
      for (let k = 0; k < n; k++) {
        const kind = (Math.random() < 0.55 ? 0 : 1) as 0 | 1
        const i = next[kind]
        next[kind] = (i + 1) % MAX
        const v = normal.clone().multiplyScalar(0.9 + Math.random() * 1.1)
        v.x += (Math.random() - 0.5) * 1.2
        v.z += (Math.random() - 0.5) * 1.2
        v.y += 0.8 + Math.random() * 0.8
        slots[kind][i] = {
          kind,
          p: point.clone().addScaledVector(normal, 0.04),
          v,
          q: new THREE.Quaternion().setFromEuler(euler.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)),
          spin: new THREE.Vector3().randomDirection().multiplyScalar(6 + Math.random() * 10),
          size: kind === 0 ? 0.05 + Math.random() * 0.016 : 0.028 + Math.random() * 0.03,
          resting: false,
          hit: false,
        }
      }
    },
    clear() {
      for (const kind of [0, 1] as const) {
        slots[kind].fill(null)
        for (let i = 0; i < MAX; i++) meshes[kind].setMatrixAt(i, zero)
        meshes[kind].instanceMatrix.needsUpdate = true
      }
    },
    update(dt: number) {
      const { center, radius, height } = collider()
      for (const kind of [0, 1] as const) {
        slots[kind].forEach((b, i) => {
          if (!b || b.resting) return
          b.v.y -= 9.8 * 0.7 * dt
          b.p.addScaledVector(b.v, dt)
          dq.setFromEuler(euler.set(b.spin.x * dt, b.spin.y * dt, b.spin.z * dt))
          b.q.multiply(dq)

          // não deixa entrar na abóbora (elipsoide achatado)
          tmp.copy(b.p).sub(center)
          const e = (tmp.x * tmp.x + tmp.z * tmp.z) / (radius * radius) + (tmp.y * tmp.y) / (height * height)
          if (e < 1) {
            b.p.copy(center).addScaledVector(tmp, 1.01 / Math.sqrt(Math.max(e, 0.01)))
            const n = tmp.set(tmp.x / (radius * radius), tmp.y / (height * height), tmp.z / (radius * radius)).normalize()
            const vn = b.v.dot(n)
            if (vn < 0) b.v.addScaledVector(n, -1.4 * vn)
          }

          const onTable = b.p.x > TABLE.x0 && b.p.x < TABLE.x1 && b.p.z > TABLE.z0 && b.p.z < TABLE.z1
          const ground = (onTable ? 0 : FLOOR) + b.size * 0.35
          if (b.p.y < ground && (onTable ? b.p.y > -0.3 : true)) {
            b.p.y = ground
            if (!b.hit && b.v.y < -1) {
              b.hit = true
              onHit()
            }
            b.v.y *= -0.28
            b.v.x *= 0.55
            b.v.z *= 0.55
            b.spin.multiplyScalar(0.5)
            if (b.v.length() < 0.35) {
              b.resting = true
              // deita de lado no tampo
              b.q.setFromEuler(euler.set(0, Math.random() * Math.PI * 2, 0))
            }
          }
          write(kind, i, b)
        })
      }
    },
  }
}
