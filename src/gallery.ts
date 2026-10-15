// Exposição: visitantes enviam a abóbora com o nome e ela aparece aqui na hora (dá pra tirar em /admin.html).
// Cada obra tem um link próprio (/a/<id>) que abre direto nela, e pode receber curtidas.

export type Entry = {
  id: string
  name: string
  shape: string
  accessory: string | null
  createdAt: string
  mask: string
  thumb: string
  paint?: string
  likes?: number
}

type Look = { shape: string; accessory: string | null }

type Options = {
  /** miniatura JPEG da abóbora atual */
  capture: () => string
  /** desenho do corte em PNG */
  exportMask: () => string
  /** pintura em PNG (null se não pintou) */
  exportPaint: () => string | null
  current: () => Look
  /** mostra a abóbora de alguém na mesa */
  view: (entry: Entry, mask: HTMLImageElement, paint: HTMLImageElement | null) => void
  /** volta para a abóbora da pessoa */
  back: () => void
  /** a pessoa já esculpiu ou pintou alguma coisa? */
  hasCarving: () => boolean
}

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!
const LIKED_KEY = 'abobora-curtidas'
const shareUrl = (id: string) => `${location.origin}/a/${id}`

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('não carregou'))
    img.src = src
  })
}

function readLiked() {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(LIKED_KEY) ?? '[]'))
  } catch {
    return new Set<string>()
  }
}

/** compartilha pelo menu do celular quando existe; senão copia o link */
async function share(url: string, title: string, button: HTMLButtonElement) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title, url })
      return
    } catch {
      /* cancelou: tenta copiar */
    }
  }
  const label = button.textContent
  try {
    await navigator.clipboard.writeText(url)
    button.textContent = 'Link copiado!'
  } catch {
    prompt('Copie o link:', url)
  }
  setTimeout(() => (button.textContent = label), 1800)
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
  const myLink = $('#expo-mylink')
  const myLinkCopy = $<HTMLButtonElement>('#expo-mylink-copy')
  const banner = $('#viewing')
  const bannerName = $('#viewing-name')
  const bannerShare = $<HTMLButtonElement>('#viewing-share')
  const bannerLike = $<HTMLButtonElement>('#viewing-like')
  const sortButtons = document.querySelectorAll<HTMLButtonElement>('[data-sort]')
  let snapshot: { thumb: string; mask: string; paint: string | null; look: Look } | null = null
  let viewing: Entry | null = null
  let entries: Entry[] = []
  let sort: 'recent' | 'likes' = 'recent'
  let sentId = ''
  const liked = readLiked()

  const show = (open: boolean) => {
    overlay.hidden = !open
    document.body.classList.toggle('expo-open', open)
    if (!open) return Promise.resolve()
    formView.hidden = true
    return refresh()
  }

  async function refresh() {
    grid.replaceChildren()
    status.textContent = 'Carregando as obras…'
    try {
      const res = await fetch('/api/gallery')
      if (!res.ok) throw new Error()
      entries = (await res.json()) as Entry[]
      status.textContent = entries.length ? '' : 'Ainda não tem nenhuma abóbora exposta. Que tal ser a primeira pessoa?'
      render()
    } catch {
      status.textContent = 'Não consegui carregar a exposição agora. Tenta de novo daqui a pouco.'
    }
  }

  function render() {
    const list = [...entries]
    if (sort === 'likes') list.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
    grid.replaceChildren(...list.map(card))
  }

  function likeLabel(button: HTMLButtonElement, e: Entry) {
    const on = liked.has(e.id)
    button.setAttribute('aria-pressed', String(on))
    button.setAttribute('aria-label', `${on ? 'Descurtir' : 'Curtir'} a abóbora de ${e.name}`)
    button.querySelector('span')!.textContent = String(e.likes ?? 0)
  }

  async function toggleLike(e: Entry, buttons: HTMLButtonElement[]) {
    const on = !liked.has(e.id)
    // muda na hora; se o servidor recusar, desfaz
    on ? liked.add(e.id) : liked.delete(e.id)
    e.likes = Math.max(0, (e.likes ?? 0) + (on ? 1 : -1))
    buttons.forEach((b) => likeLabel(b, e))
    try {
      const res = await fetch('/api/like', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.id, on }) })
      const data = await res.json()
      if (!res.ok) throw new Error()
      e.likes = data.likes
    } catch {
      on ? liked.delete(e.id) : liked.add(e.id)
      e.likes = Math.max(0, (e.likes ?? 0) + (on ? -1 : 1))
    }
    try {
      localStorage.setItem(LIKED_KEY, JSON.stringify([...liked]))
    } catch {
      /* sem armazenamento */
    }
    buttons.forEach((b) => likeLabel(b, e))
  }

  function likeButton(e: Entry, extra: HTMLButtonElement[] = []) {
    const b = document.createElement('button')
    b.className = 'like'
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5c-1.6-2.4-6.5-2.6-7.6 1-1 3.3 2.2 6.6 7.6 10.8 5.4-4.2 8.6-7.5 7.6-10.8-1.1-3.6-6-3.4-7.6-1z"/></svg><span></span>'
    likeLabel(b, e)
    b.addEventListener('click', (ev) => {
      ev.stopPropagation()
      toggleLike(e, [b, ...extra])
    })
    return b
  }

  function card(e: Entry) {
    const fig = document.createElement('figure')
    fig.className = 'frame-card'
    const b = document.createElement('button')
    b.className = 'frame'
    b.title = `Ver a abóbora de ${e.name} na mesa`
    const img = document.createElement('img')
    img.src = e.thumb
    img.alt = `Abóbora esculpida por ${e.name}`
    img.loading = 'lazy'
    // obra apagada há pouco (a lista pública fica alguns segundos em cache): some em vez de mostrar moldura vazia
    img.onerror = () => fig.remove()
    img.width = 240
    img.height = 300
    b.append(img)
    b.addEventListener('click', () => visit(e))
    const caption = document.createElement('figcaption')
    const plate = document.createElement('span')
    plate.className = 'plate'
    plate.textContent = e.name
    caption.append(plate, likeButton(e))
    fig.append(b, caption)
    return fig
  }

  async function visit(e: Entry, fromLink = false) {
    status.textContent = `Trazendo a abóbora de ${e.name}…`
    try {
      const [mask, paint] = await Promise.all([loadImage(e.mask), e.paint ? loadImage(e.paint).catch(() => null) : null])
      o.view(e, mask, paint)
      viewing = e
      bannerName.textContent = e.name
      likeLabel(bannerLike, e)
      banner.hidden = false
      document.body.classList.add('is-viewing')
      if (!fromLink) history.replaceState(null, '', `/a/${e.id}`)
      show(false)
    } catch {
      status.textContent = 'Não consegui abrir essa abóbora. Tenta outra.'
    }
  }

  function back() {
    if (!viewing) return
    viewing = null
    banner.hidden = true
    document.body.classList.remove('is-viewing')
    history.replaceState(null, '', '/')
    o.back()
  }

  function openForm() {
    if (viewing) back()
    snapshot = { thumb: o.capture(), mask: o.exportMask(), paint: o.exportPaint(), look: o.current() }
    preview.src = snapshot.thumb
    message.textContent = o.hasCarving() ? '' : 'Sua abóbora ainda está sem rosto. Dá pra enviar assim mesmo, mas fica mais legal esculpida!'
    message.className = 'expo-message'
    myLink.hidden = true
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
          paint: snapshot.paint,
          website: (form.elements.namedItem('website') as HTMLInputElement).value,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Não deu pra enviar agora.')
      message.className = 'expo-message ok'
      message.textContent = 'Pronto, sua abóbora já está na exposição!'
      form.hidden = true
      if (data.id) {
        sentId = data.id
        $('#expo-mylink-url').textContent = shareUrl(sentId).replace(/^https?:\/\//, '')
        myLink.hidden = false
      }
      if (data.entry) {
        entries = [{ ...data.entry, likes: 0 }, ...entries.filter((e) => e.id !== data.entry.id)]
        status.textContent = ''
        render()
      }
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

  sortButtons.forEach((b) =>
    b.addEventListener('click', () => {
      sort = b.dataset.sort as typeof sort
      sortButtons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
      render()
    }),
  )
  myLinkCopy.addEventListener('click', () => share(shareUrl(sentId), 'Minha abóbora', myLinkCopy))
  bannerShare.addEventListener('click', () => viewing && share(shareUrl(viewing.id), `Abóbora de ${viewing.name}`, bannerShare))
  bannerLike.addEventListener('click', () => viewing && toggleLike(viewing, [bannerLike]))
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
      return !!viewing
    },
    /** abre uma abóbora pelo link /a/<id> */
    async openLink(id: string) {
      try {
        const res = await fetch(`/api/gallery?id=${encodeURIComponent(id)}`)
        if (!res.ok) throw new Error()
        await visit((await res.json()) as Entry, true)
      } catch {
        history.replaceState(null, '', '/')
        await show(true)
        status.textContent = 'Essa abóbora ainda não está na exposição (talvez tenha sido retirada). Dá uma olhada nas outras!'
      }
    },
  }
}
