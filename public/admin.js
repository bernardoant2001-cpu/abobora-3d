// moderação da exposição (carregado por admin.html)
const SHAPES = { Redonda: 'Redonda', Alta: 'Alta', Achatada: 'Achatada', Cabaca: 'Pera' }
const ACCS = { AccWitch: 'Chapéu de bruxa', AccTopHat: 'Cartola', AccBow: 'Laço', AccHorns: 'Chifres' }
const $ = (s) => document.querySelector(s)
let token = ''
let status = 'approved'
try { token = sessionStorage.getItem('abobora-admin') || '' } catch {}

async function api(method, body) {
  const res = await fetch(method === 'GET' ? `/api/admin?status=${status}` : '/api/admin', {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) { logout(); throw new Error('Senha inválida.') }
  if (!res.ok) throw new Error(data.error || 'Erro no servidor.')
  return data
}

function card(e) {
  const el = document.createElement('article')
  el.className = 'card'
  const img = document.createElement('img')
  img.src = e.thumb
  img.alt = `Abóbora de ${e.name}`
  const name = document.createElement('div')
  name.className = 'name'
  name.textContent = e.name
  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.textContent = `${new Date(e.createdAt).toLocaleString('pt-BR')} · ${SHAPES[e.shape] || e.shape}${e.accessory ? ' · ' + (ACCS[e.accessory] || e.accessory) : ''}`
  const actions = document.createElement('div')
  actions.className = 'actions'
  const act = (label, action, cls, confirmText) => {
    const b = document.createElement('button')
    b.textContent = label
    if (cls) b.className = cls
    b.addEventListener('click', async () => {
      if (confirmText && !confirm(confirmText)) return
      actions.querySelectorAll('button').forEach((x) => (x.disabled = true))
      try { await api('POST', { action, id: e.id }); el.remove(); count() }
      catch (err) { $('#status').textContent = err.message; actions.querySelectorAll('button').forEach((x) => (x.disabled = false)) }
    })
    actions.append(b)
  }
  if (status === 'pending') {
    act('Aprovar', 'approve', 'dark')
    act('Recusar', 'reject', 'danger', `Recusar e apagar a abóbora de "${e.name}"?`)
  } else {
    act('Tirar da exposição', 'remove', 'danger', `Tirar a abóbora de "${e.name}" da exposição e apagar?`)
  }
  el.append(img, name, meta, actions)
  return el
}

function count() {
  const n = $('#grid').children.length
  $('#status').textContent = n ? `${n} abóbora${n > 1 ? 's' : ''}` : status === 'pending' ? 'Nenhuma abóbora antiga aguardando.' : 'Nenhuma abóbora na exposição.'
}

let loading = 0
async function load() {
  // se a pessoa trocar de aba no meio do carregamento, só vale a resposta da aba atual
  const ticket = ++loading
  $('#grid').replaceChildren()
  $('#status').textContent = 'Carregando…'
  try {
    const entries = await api('GET')
    if (ticket !== loading) return
    entries.forEach((e) => $('#grid').append(card(e)))
    count()
  } catch (err) { if (ticket === loading) $('#status').textContent = err.message }
}

function logout() {
  token = ''
  try { sessionStorage.removeItem('abobora-admin') } catch {}
  $('#panel').hidden = true
  $('#login').hidden = false
}

function enter() {
  $('#login').hidden = true
  $('#panel').hidden = false
  load()
}

$('#login').addEventListener('submit', (e) => {
  e.preventDefault()
  token = $('#token').value.trim()
  try { sessionStorage.setItem('abobora-admin', token) } catch {}
  $('#token').value = ''
  enter()
})
$('#logout').addEventListener('click', logout)
document.querySelectorAll('[data-status]').forEach((b) =>
  b.addEventListener('click', () => {
    status = b.dataset.status
    document.querySelectorAll('[data-status]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
    load()
  }),
)
if (token) enter()
