// todo o som é sintetizado com Web Audio: nada de arquivos para baixar

const KEY = 'abobora-mudo'
const VOLUME = 0.5
let ctx: AudioContext | null = null
let master: GainNode
let noise: AudioBuffer
let muted = (() => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
})()
let scrape: { gain: GainNode; filter: BiquadFilterNode } | null = null

function noiseSource(loop = true) {
  const src = ctx!.createBufferSource()
  src.buffer = noise
  src.loop = loop
  return src
}

function envelope(param: AudioParam, t: number, peak: number, attack: number, release: number) {
  param.setValueAtTime(0, t)
  param.linearRampToValueAtTime(peak, t + attack)
  param.exponentialRampToValueAtTime(0.0001, t + attack + release)
}

function ambience() {
  const c = ctx!
  // vento: ruído filtrado com filtro e volume variando devagar
  const wind = noiseSource()
  const band = c.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = 0.8
  const windGain = c.createGain()
  windGain.gain.value = 0.05
  wind.connect(band).connect(windGain).connect(master)
  wind.start()
  const gust = () => {
    const t = c.currentTime
    band.frequency.setTargetAtTime(250 + Math.random() * 650, t, 1.5)
    windGain.gain.setTargetAtTime(0.025 + Math.random() * 0.06, t, 2)
    setTimeout(gust, 2000 + Math.random() * 3000)
  }
  gust()

  // lareira: ronco grave e estalos
  const rumble = noiseSource()
  const low = c.createBiquadFilter()
  low.type = 'lowpass'
  low.frequency.value = 180
  const rumbleGain = c.createGain()
  rumbleGain.gain.value = 0.05
  rumble.connect(low).connect(rumbleGain).connect(master)
  rumble.start()
  const crackle = () => {
    const t = c.currentTime
    for (let i = 0; i < 1 + Math.floor(Math.random() * 4); i++) {
      const s = noiseSource(false)
      const hp = c.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 1200 + Math.random() * 2500
      const g = c.createGain()
      envelope(g.gain, t + i * 0.04 + Math.random() * 0.05, 0.05 + Math.random() * 0.1, 0.002, 0.03 + Math.random() * 0.05)
      s.connect(hp).connect(g).connect(master)
      s.start(t, Math.random() * 1.5, 0.2)
    }
    setTimeout(crackle, 150 + Math.random() * 900)
  }
  crackle()

  // coruja ao longe de vez em quando
  const owl = () => {
    hoot(c.currentTime, 0.9)
    hoot(c.currentTime + 1.2, 0.5)
    hoot(c.currentTime + 1.55, 0.9)
    setTimeout(owl, 22000 + Math.random() * 30000)
  }
  setTimeout(owl, 9000)
}

function hoot(t: number, len: number) {
  const c = ctx!
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(390, t)
  o.frequency.exponentialRampToValueAtTime(330, t + len * 0.5)
  const g = c.createGain()
  envelope(g.gain, t, 0.05, len * 0.25, len * 0.6)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 900
  o.connect(lp).connect(g).connect(master)
  o.start(t)
  o.stop(t + len + 0.1)
}

function ready() {
  return ctx && ctx.state === 'running'
}

export const audio = {
  get muted() {
    return muted
  },
  /** precisa vir de um gesto do usuário (política de autoplay) */
  start() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume()
      return
    }
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = muted ? 0 : VOLUME
    // limitador e um corte nos agudos: nada estoura nem fica estridente, mesmo com vários sons juntos
    const soft = ctx.createBiquadFilter()
    soft.type = 'lowpass'
    soft.frequency.value = 7000
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -18
    limiter.knee.value = 12
    limiter.ratio.value = 8
    limiter.attack.value = 0.003
    limiter.release.value = 0.25
    master.connect(soft).connect(limiter).connect(ctx.destination)
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    ambience()
  },
  setMuted(m: boolean) {
    muted = m
    try {
      localStorage.setItem(KEY, m ? '1' : '0')
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
    if (ctx) master.gain.setTargetAtTime(m ? 0 : VOLUME, ctx.currentTime, 0.1)
  },
  /** faca/raspador arrastando na casca; speed ~ quanto o cursor andou */
  scrape(speed: number, shave: boolean) {
    if (!ready()) return
    const c = ctx!
    if (!scrape) {
      const s = noiseSource()
      const filter = c.createBiquadFilter()
      filter.type = 'bandpass'
      const gain = c.createGain()
      gain.gain.value = 0
      s.connect(filter).connect(gain).connect(master)
      s.start()
      scrape = { gain, filter }
    }
    const t = c.currentTime
    scrape.filter.frequency.setTargetAtTime(shave ? 3200 : 1500 + Math.min(speed, 1) * 900, t, 0.03)
    scrape.filter.Q.value = shave ? 1.5 : 2.5
    scrape.gain.gain.setTargetAtTime(Math.min(0.13, 0.03 + speed * 0.2) * (shave ? 0.6 : 1), t, 0.03)
  },
  stopScrape() {
    if (scrape && ctx) scrape.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.06)
  },
  /** corte reto concluído: lâmina atravessando e o pedaço soltando */
  slice() {
    if (!ready()) return
    const c = ctx!
    const t = c.currentTime
    const s = noiseSource(false)
    const f = c.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 3
    f.frequency.setValueAtTime(3000, t)
    f.frequency.exponentialRampToValueAtTime(500, t + 0.25)
    const g = c.createGain()
    envelope(g.gain, t, 0.18, 0.02, 0.3)
    s.connect(f).connect(g).connect(master)
    s.start(t, 0, 0.4)
    thump(t + 0.12, 140, 0.25)
  },
  /** tampa saindo: "pop" de rolha */
  pop() {
    if (!ready()) return
    const t = ctx!.currentTime
    thump(t, 520, 0.18, 160)
  },
  /** semente quicando na mesa */
  tick() {
    if (!ready()) return
    const c = ctx!
    const t = c.currentTime
    const o = c.createOscillator()
    o.frequency.value = 1800 + Math.random() * 1400
    const g = c.createGain()
    envelope(g.gain, t, 0.025, 0.002, 0.04)
    o.connect(g).connect(master)
    o.start(t)
    o.stop(t + 0.06)
  },
  click() {
    if (!ready()) return
    const t = ctx!.currentTime
    thump(t, 2200, 0.05, 1500, 0.004)
    thump(t + 0.07, 1800, 0.05, 1200, 0.004)
  },
  /** lamento de fantasma */
  ghost() {
    if (!ready()) return
    const c = ctx!
    const t = c.currentTime
    const g = c.createGain()
    envelope(g.gain, t, 0.09, 1.2, 2.6)
    const delay = c.createDelay()
    delay.delayTime.value = 0.28
    const fb = c.createGain()
    fb.gain.value = 0.35
    g.connect(master)
    g.connect(delay).connect(fb).connect(delay)
    delay.connect(master)
    for (const [f0, detune] of [[330, 0], [334, 7]]) {
      const o = c.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(f0, t)
      o.frequency.linearRampToValueAtTime(f0 * 1.5, t + 1.4)
      o.frequency.linearRampToValueAtTime(f0 * 0.8, t + 3.6)
      o.detune.value = detune
      const lfo = c.createOscillator()
      lfo.frequency.value = 5.5
      const depth = c.createGain()
      depth.gain.value = 12
      lfo.connect(depth).connect(o.frequency)
      o.connect(g)
      o.start(t)
      lfo.start(t)
      o.stop(t + 4)
      lfo.stop(t + 4)
    }
  },
  /** gargalhada de desenho animado: sílabas "rá" descendo */
  laugh() {
    if (!ready()) return
    const c = ctx!
    const t0 = c.currentTime
    for (let i = 0; i < 6; i++) {
      const t = t0 + i * 0.16
      const o = c.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(230 - i * 14, t)
      o.frequency.exponentialRampToValueAtTime(170 - i * 12, t + 0.12)
      const f1 = c.createBiquadFilter()
      f1.type = 'bandpass'
      f1.frequency.value = 800
      f1.Q.value = 5
      const f2 = c.createBiquadFilter()
      f2.type = 'bandpass'
      f2.frequency.value = 1250
      f2.Q.value = 6
      const g = c.createGain()
      envelope(g.gain, t, 0.11, 0.02, 0.12)
      o.connect(f1).connect(g)
      o.connect(f2).connect(g)
      g.connect(master)
      o.start(t)
      o.stop(t + 0.16)
    }
  },

}

function thump(t: number, from: number, len: number, to = 60, attack = 0.005) {
  const c = ctx!
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(from, t)
  o.frequency.exponentialRampToValueAtTime(to, t + len)
  const g = c.createGain()
  envelope(g.gain, t, 0.17, attack, len)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + len + 0.05)
}
