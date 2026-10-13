// Exposição: visitantes enviam a abóbora com o nome; depois de aprovada em /admin.html ela aparece aqui

export type Entry = {
  id: string
  name: string
  shape: string
  accessory: string | null
  createdAt: string
  mask: string
  thumb: string
}

type Look = { shape: string; accessory: string | null }

type Options = {
  /** miniatura JPEG da abóbora atual */
  capture: () => string
  /** desenho do corte em PNG */
  exportMask: () => string
  current: () => Look
  /** mostra a abóbora de alguém na mesa */
  view: (entry: Entry, mask: HTMLImageElement) => void
  /** volta para a abóbora da pessoa */
  back: () => void
  /** a pessoa já esculpiu alguma coisa? */
  hasCarving: () => boolean
}

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('não carregou'))
    img.src = src
  })
}

export function createGallery(o: Options) {
  const overlay = $('#expo')
  const grid = $('#expo-grid')
  const status = $('#expo-status')
  const form = $<HTMLFormElement>('#expo-form')
  const formView = $('#expo-send')
  const preview = $<HTMLImageElement>('#expo-preview')
  const nameInput = $<HTMLInputElement>('#expo-name')
  const message = $('#expo-message')
  const sendButton = $<HTMLButtonElement>('#expo-submit')
  const banner = $('#viewing')
  const bannerName = $('#viewing-name')
  let snapshot: { thumb: string; mask: string; look: Look } | null = null
  let viewing = false

  const show = (open: boolean) => {
    overlay.hidden = !open
    document.body.classList.toggle('expo-open', open)
    if (open) {
      formView.hidden = true
      refresh()
    }
  }

  async function refresh() {
    grid.replaceChildren()
    status.textContent = 'Carregando as obras…'
    try {
      const res = await fetch('/api/gallery')
      if (!res.ok) throw new Error()
      const entries = (await res.json()) as Entry[]
      status.textContent = entries.length ? '' : 'Ainda não tem nenhuma abóbora exposta. Que tal ser a primeira pessoa?'
      for (const e of entries) grid.append(card(e))
    } catch {
      status.textContent = 'Não consegui carregar a exposição agora. Tenta de novo daqui a pouco.'
    }
  }

  function card(e: Entry) {
    const b = document.createElement('button')
    b.className = 'frame'
    b.title = `Ver a abóbora de ${e.name} na mesa`
    const img = document.createElement('img')
    img.src = e.thumb
    img.alt = `Abóbora esculpida por ${e.name}`
    img.loading = 'lazy'
    img.width = 240
    img.height = 300
    const plate = document.createElement('span')
    plate.className = 'plate'
    plate.textContent = e.name
    b.append(img, plate)
    b.addEventListener('click', () => visit(e))
    return b
  }

  async function visit(e: Entry) {
    status.textContent = `Trazendo a abóbora de ${e.name}…`
    try {
      const mask = await loadImage(e.mask)
      o.view(e, mask)
      viewing = true
      bannerName.textContent = e.name
      banner.hidden = false
      document.body.classList.add('is-viewing')
      show(false)
    } catch {
      status.textContent = 'Não consegui abrir essa abóbora. Tenta outra.'
    }
  }

  function back() {
    if (!viewing) return
    viewing = false
    banner.hidden = true
    document.body.classList.remove('is-viewing')
    o.back()
  }

  function openForm() {
    if (viewing) back()
    snapshot = { thumb: o.capture(), mask: o.exportMask(), look: o.current() }
    preview.src = snapshot.thumb
    message.textContent = o.hasCarving() ? '' : 'Sua abóbora ainda está sem rosto. Dá pra enviar assim mesmo, mas fica mais legal esculpida!'
    message.className = 'expo-message'
    sendButton.disabled = false
    form.hidden = false
    formView.hidden = false
    nameInput.focus()
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    if (!snapshot) return
    const name = nameInput.value.trim()
    if (!name) return nameInput.focus()
    sendButton.disabled = true
    message.className = 'expo-message'
    message.textContent = 'Enviando…'
    try {
      const res = await fetch('/api/gallery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          shape: snapshot.look.shape,
          accessory: snapshot.look.accessory,
          mask: snapshot.mask,
          thumb: snapshot.thumb,
          website: (form.elements.namedItem('website') as HTMLInputElement).value,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Não deu pra enviar agora.')
      message.className = 'expo-message ok'
      message.textContent = 'Recebemos sua abóbora! Ela entra na exposição assim que for aprovada.'
      form.hidden = true
      try {
        localStorage.setItem('abobora-nome', name)
      } catch {
        /* sem armazenamento: só não lembra o nome */
      }
    } catch (err) {
      message.className = 'expo-message error'
      message.textContent = (err as Error).message
      sendButton.disabled = false
    }
  })

  try {
    nameInput.value = localStorage.getItem('abobora-nome') ?? ''
  } catch {
    /* sem armazenamento */
  }

  $('#gallery').addEventListener('click', () => show(overlay.hidden === true))
  $('#expo-close').addEventListener('click', () => show(false))
  $('#expo-open-form').addEventListener('click', openForm)
  $('#expo-cancel').addEventListener('click', () => (formView.hidden = true))
  $('#viewing-back').addEventListener('click', back)
  overlay.addEventListener('click', (e) => e.target === overlay && show(false))
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    if (!formView.hidden) formView.hidden = true
    else if (!overlay.hidden) show(false)
  })

  return {
    get viewing() {
      return viewing
    },
  }
}
