import * as THREE from 'three'
import { audio } from './audio'
import { FX } from './world'

/** gato preto com esqueleto (blender/cat.py): atravessa a mesa, para, olha para você e mia */
function createCat(room: THREE.Object3D) {
  const cat = room.getObjectByName('Cat')!
  cat.updateMatrixWorld(true)
  const rootInv = cat.getWorldQuaternion(new THREE.Quaternion()).invert()
  // cada osso gira em eixos do gato (x = frente, y = cima, z = lado), convertidos para o espaço do osso
  const bone = (name: string) => {
    const o = cat.getObjectByName(name)!
    const rel = rootInv.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion())).invert()
    const axis = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(rel).normalize()
    return { o, rest: o.quaternion.clone(), side: axis(0, 0, 1), up: axis(0, 1, 0), fwd: axis(1, 0, 0) }
  }
  type Bone = ReturnType<typeof bone>
  const spine = bone('CatSpine')
  const head = bone('CatHead')
  const legs = [0, 1, 2, 3].map((i) => ({ up: bone(`CatLegUp${i}`), low: bone(`CatLegLow${i}`) }))
  const tail = [0, 1, 2, 3, 4, 5].map((i) => bone(`CatTail${i}`))
  let eye: THREE.MeshStandardMaterial | undefined
  cat.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if (m?.name === 'CatEye') eye = m
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true
      o.frustumCulled = false
    }
  })
  eye?.emissive.set('#ffe7a0')
  cat.visible = false

  const q = new THREE.Quaternion()
  const pose = (b: Bone, ...turns: [THREE.Vector3, number][]) => {
    b.o.quaternion.copy(b.rest)
    for (const [axis, angle] of turns) b.o.quaternion.multiply(q.setFromAxisAngle(axis, angle))
  }

  return {
    cat,
    /** walk: 0 parado, 1 andando; turn: 0 olhando para frente, 1 olhando para a câmera */
    pose(t: number, walk: number, turn: number, mood: number) {
      const phase = t * 8
      // passo de desenho animado: patas em diagonal juntas, joelho dobra quando a pata sobe
      legs.forEach((l, i) => {
        const p = phase + (i === 0 || i === 3 ? 0 : Math.PI)
        const swing = Math.sin(p) * 0.55 * walk
        const lift = Math.max(0, Math.cos(p)) * 0.9 * walk
        const front = i < 2 ? 1 : -1
        pose(l.up, [l.up.side, swing])
        pose(l.low, [l.low.side, -lift * front])
      })
      // corpo quica e balança; parado, respira
      const bob = Math.abs(Math.sin(phase)) * walk
      cat.position.y = bob * 0.018
      pose(spine, [spine.side, Math.sin(phase * 2) * 0.03 * walk], [spine.fwd, Math.sin(phase) * 0.04 * walk + Math.sin(t * 2.2) * 0.01 * (1 - walk)])
      // cabeça: acompanha o passo e vira para a câmera inclinando de leve (charme)
      pose(head, [head.up, turn * 1.3], [head.fwd, turn * 0.18 + Math.sin(phase * 2) * 0.04 * walk], [head.side, -0.05 * bob + turn * 0.06])
      // rabo ondula em onda: cada osso atrasado em relação ao anterior
      tail.forEach((b, k) => {
        // base quase parada, movimento cresce até a ponta
        const amp = ((walk ? 0.18 : 0.26) + k * 0.03) * [0.15, 0.55, 0.8, 1, 1, 1][k]
        pose(b, [b.side, Math.sin(t * (walk ? 3.2 : 4.4) - k * 0.75) * amp * 0.5], [b.fwd, Math.sin(t * 2.3 - k * 0.6) * amp])
      })
      if (eye) eye.emissiveIntensity = 0.15 + turn * 0.9 + mood * 1.2
    },
  }
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

export function createSurprises(scene: THREE.Scene, room: THREE.Object3D) {
  const c = createCat(room)
  const g = createGhost()
  scene.attach(c.cat)
  scene.add(g.ghost)

  let catAt = 28
  let catT = -1
  let meowed = false
  let walk = 1
  let ghostStart: number | null = null
  let ghostT: number | null = null
  let ghostReady = 0
  // à direita da abóbora, numa faixa que a câmera vê acima da barra de ferramentas
  const START = 4.8
  const STOP = 1.85
  const LANE = 1.2
  const SPEED = 0.9
  const pos = g.geo.attributes.position

  return {
    /** chamado quando as luzes apagam */
    lightsOff(t: number) {
      if (t < ghostReady || ghostStart !== null || ghostT !== null) return
      ghostStart = t + 1.2
      ghostReady = t + 25
    },
    update(t: number, dt: number, mood: number) {
      // gato: entra pela direita, para ao lado da abóbora, olha, mia, dá meia-volta e sai por onde entrou
      if (catT < 0 && t > catAt) {
        catT = 0
        meowed = false
        c.cat.visible = true
      }
      if (catT >= 0) {
        catT += dt
        const walkIn = (START - STOP) / SPEED
        const look = 2.6
        const turnBack = 0.8
        let x = STOP
        let heading = Math.PI
        let moving = true
        let turn = 0
        if (catT < walkIn) x = START - catT * SPEED
        else if (catT < walkIn + look) {
          moving = false
          const k = (catT - walkIn) / look
          turn = k < 0.85 ? Math.min(1, k * 4) : (1 - k) / 0.15
          if (!meowed && k > 0.3) {
            meowed = true
            audio.meow()
          }
        } else if (catT < walkIn + look + turnBack) {
          const k = (catT - walkIn - look) / turnBack
          heading = Math.PI * (1 - (1 - Math.cos(k * Math.PI)) / 2)
        } else {
          heading = 0
          x = STOP + (catT - walkIn - look - turnBack) * SPEED
        }
        c.cat.position.x = x
        c.cat.position.z = LANE
        c.cat.rotation.set(0, heading, 0)
        walk += ((moving ? 1 : 0) - walk) * (1 - Math.exp(-dt * 8))
        c.pose(t, walk, turn, mood)
        if (x > START + 0.2) {
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
