'use strict'

const $ = (selector, scope = document) => scope.querySelector(selector)
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector))

function el (tag, props = {}, children = []) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key === 'html') node.innerHTML = value
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value)
    else if (key === 'dataset') Object.assign(node.dataset, value)
    else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value)
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child)
  }
  return node
}

function icon (id, className = 'btn-icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', className)
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
  use.setAttribute('href', `#${id}`)
  svg.append(use)
  return svg
}

const num = value => Number(value || 0).toLocaleString('en-US')

function mb (value) {
  const amount = Number(value || 0)
  return amount >= 1024 ? `${(amount / 1024).toFixed(1)} GB` : `${Math.round(amount)} MB`
}

function clockTime (date = new Date()) {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map(part => String(part).padStart(2, '0'))
    .join(':')
}

function debounce (fn, delay = 180) {
  let timer = null
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

function coerce (raw) {
  const text = String(raw).trim()
  const low = text.toLowerCase()
  if (low === 'true') return true
  if (low === 'false') return false
  if (text !== '' && !Number.isNaN(Number(text))) return Number(text)
  return text
}

const toastHost = () => document.getElementById('toast-host')

function toast (message, kind = 'info') {
  const node = el('div', { class: `toast is-${kind}`, text: message })
  toastHost().append(node)
  setTimeout(() => {
    node.classList.add('is-out')
    setTimeout(() => node.remove(), 220)
  }, 3000)
}

function ask ({ title, body, note, confirmLabel = 'Continue', cancelLabel = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    let settled = false

    const finish = answer => {
      if (settled) return
      settled = true
      document.removeEventListener('keydown', onKey, true)
      veil.classList.remove('is-on')
      setTimeout(() => veil.remove(), 180)
      resolve(answer)
    }

    const onKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        finish(false)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        finish(true)
      }
    }

    const yes = el('button', {
      class: danger ? 'btn btn-danger' : 'btn btn-accent',
      text: confirmLabel,
      onclick: () => finish(true)
    })

    const dialog = el('div', { class: `dialog${danger ? ' is-danger' : ''}` }, [
      el('h2', { class: 'dialog-title', text: title }),
      el('p', { class: 'dialog-body', text: body }),
      note ? el('p', { class: 'dialog-note', text: note }) : null,
      el('div', { class: 'dialog-actions' }, [
        el('button', { class: 'btn', text: cancelLabel, onclick: () => finish(false) }),
        yes
      ])
    ])

    const veil = el('div', {
      class: 'dialog-veil',
      onclick: event => { if (event.target === veil) finish(false) }
    }, [dialog])

    document.body.append(veil)
    document.addEventListener('keydown', onKey, true)
    requestAnimationFrame(() => {
      veil.classList.add('is-on')
      yes.focus()
    })
  })
}

function askText ({ title, body = '', label = '', value = '', placeholder = '', confirmLabel = 'Save', cancelLabel = 'Cancel' } = {}) {
  return new Promise(resolve => {
    let settled = false

    const finish = answer => {
      if (settled) return
      settled = true
      document.removeEventListener('keydown', onKey, true)
      veil.classList.remove('is-on')
      setTimeout(() => veil.remove(), 180)
      resolve(answer)
    }

    const input = el('input', {
      class: 'input',
      type: 'text',
      spellcheck: 'false',
      placeholder,
      value: String(value || '')
    })

    const submit = () => {
      const text = input.value.trim()
      if (!text) {
        input.focus()
        return
      }
      finish(text)
    }

    const onKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        finish(null)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        submit()
      }
    }

    const dialog = el('div', { class: 'dialog' }, [
      el('h2', { class: 'dialog-title', text: title }),
      body ? el('p', { class: 'dialog-body', text: body }) : null,
      label ? el('p', { class: 'picker-label', text: label }) : null,
      input,
      el('div', { class: 'dialog-actions' }, [
        el('button', { class: 'btn', text: cancelLabel, onclick: () => finish(null) }),
        el('button', { class: 'btn btn-accent', text: confirmLabel, onclick: submit })
      ])
    ])

    const veil = el('div', {
      class: 'dialog-veil',
      onclick: event => { if (event.target === veil) finish(null) }
    }, [dialog])

    document.body.append(veil)
    document.addEventListener('keydown', onKey, true)
    requestAnimationFrame(() => {
      veil.classList.add('is-on')
      input.focus()
      input.select()
    })
  })
}

function askChoice ({ title, body = '', choices = [], cancelLabel = 'Cancel' } = {}) {
  return new Promise(resolve => {
    let settled = false

    const finish = answer => {
      if (settled) return
      settled = true
      document.removeEventListener('keydown', onKey, true)
      veil.classList.remove('is-on')
      setTimeout(() => veil.remove(), 180)
      resolve(answer)
    }

    const onKey = event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      finish(null)
    }

    const dialog = el('div', { class: 'dialog' }, [
      el('h2', { class: 'dialog-title', text: title }),
      body ? el('p', { class: 'dialog-body', text: body }) : null,
      el('div', { class: 'exit-grid' }, choices.map(choice => el('button', {
        class: 'block block-tall',
        onClick: () => finish(choice.id)
      }, [
        el('span', { class: 'block-name', text: choice.name }),
        choice.note ? el('span', { class: 'block-note', text: choice.note }) : null
      ]))),
      el('div', { class: 'dialog-actions' }, [
        el('button', { class: 'btn', text: cancelLabel, onclick: () => finish(null) })
      ])
    ])

    const veil = el('div', {
      class: 'dialog-veil',
      onclick: event => { if (event.target === veil) finish(null) }
    }, [dialog])

    document.body.append(veil)
    document.addEventListener('keydown', onKey, true)
    requestAnimationFrame(() => veil.classList.add('is-on'))
  })
}

function menu ({ x = 0, y = 0, title = '', items = [] } = {}) {
  return new Promise(resolve => {
    let settled = false

    const finish = id => {
      if (settled) return
      settled = true
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onOutside, true)
      window.removeEventListener('blur', onGone)
      window.removeEventListener('resize', onGone)
      host.classList.remove('is-on')
      setTimeout(() => host.remove(), 140)
      resolve(id)
    }

    const onKey = event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      finish(null)
    }

    const onOutside = event => {
      if (!host.contains(event.target)) finish(null)
    }

    const onGone = () => finish(null)

    const host = el('div', { class: 'ctx-menu' }, [
      title ? el('span', { class: 'ctx-title', text: title }) : null,
      ...items.map(item => {
        if (item.separator) return el('span', { class: 'ctx-sep' })
        return el('button', {
          class: `ctx-item${item.danger ? ' is-danger' : ''}`,
          disabled: Boolean(item.disabled),
          onclick: () => finish(item.id)
        }, [
          el('span', { class: 'ctx-label', text: item.label }),
          item.hint ? el('span', { class: 'ctx-hint', text: item.hint }) : null
        ])
      })
    ])

    document.body.append(host)
    const box = host.getBoundingClientRect()
    host.style.left = `${Math.max(8, Math.min(x, window.innerWidth - box.width - 8))}px`
    host.style.top = `${Math.max(8, Math.min(y, window.innerHeight - box.height - 8))}px`

    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onOutside, true)
    window.addEventListener('blur', onGone)
    window.addEventListener('resize', onGone)
    requestAnimationFrame(() => host.classList.add('is-on'))
  })
}

function askExit ({ injected = 0, monitoring = false } = {}) {
  return new Promise(resolve => {
    let settled = false

    const finish = answer => {
      if (settled) return
      settled = true
      document.removeEventListener('keydown', onKey, true)
      veil.classList.remove('is-on')
      setTimeout(() => veil.remove(), 180)
      resolve(answer)
    }

    const remember = el('input', { type: 'checkbox', id: 'exit-remember' })

    const choose = action => finish({ action, remember: remember.checked })

    const onKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        finish(null)
      }
    }

    const liveNote = monitoring
      ? 'Live Monitor keeps rewriting flags, the RAM guard keeps watching, and the window comes back from the tray icon.'
      : 'The engine, the RAM guard and your session stay up, and the window comes back from the tray icon.'

    const quitNote = injected
      ? `Takes all ${num(injected)} live flags back out of Roblox, stops the engine and exits.`
      : 'Stops the engine and exits. Nothing is left running.'

    const dialog = el('div', { class: 'dialog dialog-wide' }, [
      el('h2', { class: 'dialog-title', text: 'Close NebulaStrap?' }),
      el('p', { class: 'dialog-body', text: 'Closing the window does not have to close the app — it can keep working while it is out of the way.' }),
      el('div', { class: 'exit-grid' }, [
        el('button', { class: 'block block-tall', onClick: () => choose('background') }, [
          el('span', { class: 'block-name', text: 'Keep running in the background' }),
          el('span', { class: 'block-note', text: liveNote })
        ]),
        el('button', { class: 'block block-tall is-quit', onClick: () => choose('quit') }, [
          el('span', { class: 'block-name', text: 'Close completely' }),
          el('span', { class: 'block-note', text: quitNote })
        ])
      ]),
      el('label', { class: 'dialog-remember', for: 'exit-remember' }, [
        remember,
        el('span', { text: 'Remember this and stop asking (change it in Utilities)' })
      ]),
      el('div', { class: 'dialog-actions' }, [
        el('button', { class: 'btn', text: 'Cancel', onclick: () => finish(null) })
      ])
    ])

    const veil = el('div', {
      class: 'dialog-veil',
      onclick: event => { if (event.target === veil) finish(null) }
    }, [dialog])

    document.body.append(veil)
    document.addEventListener('keydown', onKey, true)
    requestAnimationFrame(() => veil.classList.add('is-on'))
  })
}

const FLAG_FAMILIES = [
  { id: 'Flag', name: 'Boolean', glyph: 'true / false', kind: 'bool' },
  { id: 'Int', name: 'Integer', glyph: '0 1 2 3', kind: 'number' },
  { id: 'Float', name: 'Float', glyph: '0.5', kind: 'number' },
  { id: 'Double', name: 'Double', glyph: '0.5000', kind: 'number' },
  { id: 'String', name: 'Text', glyph: 'abc', kind: 'text' },
  { id: 'Log', name: 'Log level', glyph: '0 1 2', kind: 'number' },
  { id: 'Variable', name: 'Anything', glyph: 'auto', kind: 'text' }
]

const FLAG_SCOPES = [
  { id: '', name: 'Static', sub: 'F' },
  { id: 'D', name: 'Dynamic', sub: 'DF' },
  { id: 'S', name: 'Synced', sub: 'SF' },
  { id: 'SD', name: 'Synced dynamic', sub: 'SDF' }
]

const FLAG_PREFIXES = []
for (const family of FLAG_FAMILIES) {
  for (const scope of FLAG_SCOPES) {
    FLAG_PREFIXES.push({ text: `${scope.id}F${family.id}`, scope: scope.id, family: family.id })
  }
}
FLAG_PREFIXES.sort((a, b) => b.text.length - a.text.length)

function splitFlagName (full) {
  for (const entry of FLAG_PREFIXES) {
    if (full.startsWith(entry.text) && full.length > entry.text.length) {
      return { scope: entry.scope, family: entry.family, bare: full.slice(entry.text.length) }
    }
  }
  return null
}

function askFlags ({ title = 'Add flags', onAdd, parseText, suggest, pickFile, parseFile } = {}) {
  return new Promise(resolve => {
    const state = {
      mode: 'single',
      scope: '',
      family: 'Flag',
      bare: '',
      custom: false,
      value: 'true',
      known: null,
      text: '',
      parsed: null,
      file: null,
      merge: true,
      dupes: 'overwrite',
      busy: false,
      added: 0
    }

    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      document.removeEventListener('keydown', onKey, true)
      veil.classList.remove('is-on')
      setTimeout(() => veil.remove(), 180)
      resolve({ added: state.added })
    }

    const family = () => FLAG_FAMILIES.find(entry => entry.id === state.family)
    const fullName = () => (state.custom ? state.bare : `${state.scope}F${state.family}${state.bare}`)

    const tabs = el('div', { class: 'tabs' })
    const panels = el('div', { class: 'picker-body' })

    const nameInput = el('input', {
      class: 'input',
      type: 'text',
      spellcheck: 'false',
      placeholder: 'DFIntRakNetLoopMs',
      value: ''
    })
    const suggestBox = el('div', { class: 'suggest', hidden: 'hidden' })
    const scopeGrid = el('div', { class: 'block-grid' })
    const typeGrid = el('div', { class: 'block-grid' })
    const valueHost = el('div', { class: 'picker-row' })
    const preview = el('p', { class: 'picker-preview' })
    const warn = el('p', { class: 'picker-warn' })

    const textArea = el('textarea', {
      class: 'textarea textarea-tall',
      spellcheck: 'false',
      placeholder: 'DFIntRakNetLoopMs = 1\nFFlagDebugGraphicsPreferD3D11 = true\n\n{ "DFIntTaskSchedulerTargetFps": 240 }'
    })
    const textNote = el('p', { class: 'picker-tally' })

    const fileNote = el('p', { class: 'picker-tally' })
    const fileName = el('p', { class: 'picker-file' })

    const status = el('span', { class: 'dialog-status' })
    const addButton = el('button', { class: 'btn btn-accent', text: 'Add' })
    const keepButton = el('button', { class: 'btn btn-ghost', text: 'Add & keep open' })

    const singlePanel = el('div', { class: 'picker-panel' }, [
      el('p', { class: 'picker-label', text: 'Type' }),
      typeGrid,
      el('p', { class: 'picker-label', text: 'Scope' }),
      scopeGrid,
      el('p', { class: 'picker-label', text: 'Name' }),
      el('div', { class: 'suggest-wrap' }, [nameInput, suggestBox]),
      el('p', { class: 'picker-label', text: 'Value' }),
      valueHost,
      preview,
      warn
    ])

    const mergeHostText = el('div', { class: 'mode-grid' })
    const mergeHostFile = el('div', { class: 'mode-grid' })
    const dupeHostText = el('div', { class: 'mode-grid' })
    const dupeHostFile = el('div', { class: 'mode-grid' })

    const textPanel = el('div', { class: 'picker-panel', hidden: 'hidden' }, [
      el('p', { class: 'picker-label', text: 'Paste JSON, a config, or one flag per line' }),
      textArea,
      el('div', { class: 'picker-row picker-row-tight' }, [
        el('button', {
          class: 'btn btn-sm',
          text: 'Paste from clipboard',
          onClick: async () => {
            try {
              const clip = await navigator.clipboard.readText()
              if (!clip) return
              textArea.value = clip
              onText()
            } catch {
              textNote.textContent = 'Windows would not hand over the clipboard — paste with Ctrl+V instead.'
            }
          }
        }),
        el('button', {
          class: 'btn btn-sm btn-ghost',
          text: 'Clear',
          onClick: () => {
            textArea.value = ''
            onText()
          }
        })
      ]),
      textNote,
      el('p', { class: 'picker-label', text: 'How it goes in' }),
      mergeHostText,
      dupeHostText
    ])

    const filePanel = el('div', { class: 'picker-panel', hidden: 'hidden' }, [
      el('p', { class: 'picker-label', text: 'Read the flags out of a file' }),
      el('div', { class: 'picker-row picker-row-tight' }, [
        el('button', {
          class: 'btn btn-accent btn-sm',
          text: 'Choose a file…',
          onClick: chooseFile
        })
      ]),
      fileName,
      fileNote,
      el('p', { class: 'picker-label', text: 'How it goes in' }),
      mergeHostFile,
      dupeHostFile,
      el('p', { class: 'picker-hint', text: 'JSON, TXT, CFG or a log — anything with flags in it.' })
    ])

    panels.append(singlePanel, textPanel, filePanel)

    const MODES = [
      { id: 'single', name: 'One flag', panel: singlePanel },
      { id: 'text', name: 'Paste / JSON', panel: textPanel },
      { id: 'file', name: 'Import file', panel: filePanel }
    ]

    function paintTabs () {
      tabs.replaceChildren(...MODES.map(mode => el('button', {
        class: `tab${state.mode === mode.id ? ' is-on' : ''}`,
        text: mode.name,
        onClick: () => {
          state.mode = mode.id
          paintTabs()
          paintMerge()
          paintFooter()
          if (mode.id === 'single') nameInput.focus()
          if (mode.id === 'text') textArea.focus()
        }
      })))
      for (const mode of MODES) mode.panel.hidden = state.mode !== mode.id
    }

    function paintName () {
      const full = fullName()
      if (nameInput.value !== full) nameInput.value = full
      preview.replaceChildren(
        el('b', { text: full || 'FFlagName' }),
        el('span', { text: '=' }),
        el('b', { text: state.value === '' ? '?' : state.value })
      )
      warn.textContent = state.custom && state.bare
        ? 'No known prefix on that name — the value type will be guessed at write time.'
        : ''
      paintFooter()
    }

    function buildValue () {
      const kind = family().kind
      if (kind === 'bool') {
        if (!['true', 'false'].includes(state.value.toLowerCase())) state.value = 'true'
        const pick = wanted => {
          state.value = wanted
          buildValue()
          paintName()
        }
        valueHost.replaceChildren(
          el('button', {
            class: `block block-wide${state.value.toLowerCase() === 'true' ? ' is-on' : ''}`,
            onClick: () => pick('true')
          }, [el('span', { class: 'block-glyph', text: '1' }), el('span', { class: 'block-name', text: 'True' })]),
          el('button', {
            class: `block block-wide${state.value.toLowerCase() === 'false' ? ' is-on' : ''}`,
            onClick: () => pick('false')
          }, [el('span', { class: 'block-glyph', text: '0' }), el('span', { class: 'block-name', text: 'False' })])
        )
        return
      }
      if (['true', 'false'].includes(state.value.toLowerCase()) && kind === 'number') state.value = ''
      const input = el('input', {
        class: 'input',
        type: 'text',
        spellcheck: 'false',
        placeholder: kind === 'number' ? '60' : 'text value',
        value: state.value
      })
      input.addEventListener('input', () => {
        state.value = input.value
        paintName()
      })
      valueHost.replaceChildren(input)
    }

    function paintBlocks () {
      scopeGrid.replaceChildren(...FLAG_SCOPES.map(scope => el('button', {
        class: `block${!state.custom && state.scope === scope.id ? ' is-on' : ''}`,
        onClick: () => {
          state.scope = scope.id
          state.custom = false
          paintBlocks()
          paintName()
        }
      }, [
        el('span', { class: 'block-sub', text: `${scope.sub}…` }),
        el('span', { class: 'block-name', text: scope.name })
      ])))

      typeGrid.replaceChildren(...FLAG_FAMILIES.map(entry => el('button', {
        class: `block${!state.custom && state.family === entry.id ? ' is-on' : ''}`,
        onClick: () => {
          state.family = entry.id
          state.custom = false
          paintBlocks()
          buildValue()
          paintName()
        }
      }, [
        el('span', { class: 'block-glyph', text: entry.glyph }),
        el('span', { class: 'block-name', text: entry.name }),
        el('span', { class: 'block-sub', text: `${state.scope}F${entry.id}` })
      ])))
    }

    function duplicateCount () {
      if (state.mode === 'text') return state.parsed?.duplicates || 0
      if (state.mode === 'file') return state.file?.duplicates || 0
      return 0
    }

    function paintMerge () {
      const modeBlocks = host => host.replaceChildren(
        el('button', {
          class: `block block-tall${state.merge ? ' is-on' : ''}`,
          onClick: () => {
            state.merge = true
            paintMerge()
            paintFooter()
          }
        }, [
          el('span', { class: 'block-name', text: 'Merge into my list' }),
          el('span', { class: 'block-note', text: 'Keeps every flag you already have and adds these on top' })
        ]),
        el('button', {
          class: `block block-tall${state.merge ? '' : ' is-on'}`,
          onClick: () => {
            state.merge = false
            paintMerge()
            paintFooter()
          }
        }, [
          el('span', { class: 'block-name', text: 'Replace my list' }),
          el('span', { class: 'block-note', text: 'Throws away every flag in the list and uses only these' })
        ])
      )

      const dupes = duplicateCount()
      const dupeBlocks = host => {
        if (!state.merge || !dupes) {
          host.replaceChildren()
          return
        }
        host.replaceChildren(
          el('button', {
            class: `block block-tall${state.dupes === 'overwrite' ? ' is-on' : ''}`,
            onClick: () => {
              state.dupes = 'overwrite'
              paintMerge()
            }
          }, [
            el('span', { class: 'block-name', text: `Overwrite the ${num(dupes)} duplicate${dupes === 1 ? '' : 's'}` }),
            el('span', { class: 'block-note', text: 'The new value wins for any flag you already had' })
          ]),
          el('button', {
            class: `block block-tall${state.dupes === 'skip' ? ' is-on' : ''}`,
            onClick: () => {
              state.dupes = 'skip'
              paintMerge()
            }
          }, [
            el('span', { class: 'block-name', text: 'Skip them, keep mine' }),
            el('span', { class: 'block-note', text: 'Duplicates are not added at all — your values stay' })
          ])
        )
      }

      modeBlocks(mergeHostText)
      modeBlocks(mergeHostFile)
      dupeBlocks(dupeHostText)
      dupeBlocks(dupeHostFile)
    }

    function paintSuggestions (reply) {
      const names = reply?.names || []
      if (!names.length) {
        suggestBox.hidden = true
        suggestBox.replaceChildren()
      } else {
        suggestBox.hidden = false
        suggestBox.replaceChildren(...names.map(bare => el('button', {
          class: 'suggest-item',
          onClick: () => {
            state.bare = bare
            state.custom = false
            suggestBox.hidden = true
            paintBlocks()
            paintName()
            askSuggest()
          }
        }, [
          el('span', { class: 'suggest-name', text: bare }),
          el('span', { class: 'suggest-tag', text: `${state.scope}F${state.family}` })
        ])))
      }

      if (!reply || !reply.offsets) {
        status.textContent = 'Attach to Roblox to check names against the build'
        status.className = 'dialog-status'
        return
      }
      if (reply.exact) {
        status.textContent = 'This flag exists on the build you are attached to'
        status.className = 'dialog-status is-ok'
      } else if (state.bare) {
        status.textContent = `${num(reply.total)} flag${reply.total === 1 ? '' : 's'} on this build contain that text`
        status.className = 'dialog-status'
      } else {
        status.textContent = ''
      }
    }

    const askSuggest = debounce(async () => {
      if (state.mode !== 'single' || !suggest) return
      const query = state.custom ? state.bare : state.bare
      if (!query || query.length < 2) {
        paintSuggestions(null)
        return
      }
      try {
        paintSuggestions(await suggest(query, 8))
      } catch {
        paintSuggestions(null)
      }
    }, 180)

    const onText = debounce(async () => {
      state.text = textArea.value
      if (!state.text.trim()) {
        state.parsed = null
        textNote.textContent = ''
        paintFooter()
        return
      }
      if (!parseText) {
        state.parsed = { count: 0 }
        return
      }
      const reply = await parseText(state.text)
      state.parsed = reply?.ok ? reply : null
      textNote.textContent = describe(reply)
      textNote.className = `picker-tally${reply?.count ? ' is-ok' : ' is-warn'}`
      paintMerge()
      paintFooter()
    }, 260)

    function describe (reply) {
      if (!reply || !reply.count) return 'Nothing in that text looks like an FFlag yet.'
      const bits = [`${num(reply.count)} flag${reply.count === 1 ? '' : 's'} found`]
      if (reply.duplicates) bits.push(`${num(reply.duplicates)} already in your list`)
      if (reply.unknown) bits.push(`${num(reply.unknown)} not on this build`)
      return bits.join(' · ')
    }

    async function chooseFile () {
      if (!pickFile || !parseFile) return
      const path = await pickFile()
      if (!path) return
      fileName.textContent = path
      const reply = await parseFile(path)
      if (!reply?.ok) {
        state.file = null
        fileNote.textContent = reply?.error || 'No FFlags in that file.'
        fileNote.className = 'picker-tally is-warn'
      } else {
        state.file = { path, count: reply.count, duplicates: reply.duplicates || 0 }
        fileNote.textContent = describe(reply)
        fileNote.className = 'picker-tally is-ok'
      }
      paintMerge()
      paintFooter()
    }

    function ready () {
      if (state.busy) return false
      if (state.mode === 'single') return Boolean(state.custom ? state.bare.trim() : state.bare.trim())
      if (state.mode === 'text') return Boolean(state.parsed?.count)
      return Boolean(state.file?.count)
    }

    function paintFooter () {
      addButton.disabled = !ready()
      keepButton.disabled = !ready()
      keepButton.hidden = state.mode !== 'single' && !state.merge

      if (state.mode === 'single') {
        addButton.textContent = 'Add flag'
        return
      }
      const count = state.mode === 'text' ? state.parsed?.count : state.file?.count
      const amount = count ? `${num(count)} ` : ''
      addButton.textContent = state.merge ? `Add ${amount}flags` : `Replace with ${amount}flags`
    }

    async function submit (keepOpen) {
      if (!ready() || !onAdd) return

      let payload = null
      if (state.mode === 'single') {
        const full = fullName().trim()
        if (!full) return
        if (family().kind === 'number' && !state.custom && Number.isNaN(Number(state.value))) {
          warn.textContent = `${state.scope}F${state.family} flags hold a number — "${state.value}" is not one.`
          return
        }
        payload = { kind: 'single', name: full, value: coerce(state.value) }
      } else {
        const shared = { merge: state.merge, keep: state.merge && state.dupes === 'skip' }
        payload = state.mode === 'text'
          ? { kind: 'text', text: state.text, ...shared }
          : { kind: 'file', path: state.file.path, ...shared }
      }

      state.busy = true
      paintFooter()
      let reply = null
      try {
        reply = await onAdd(payload)
      } catch (error) {
        reply = { ok: false, error: error.message }
      }
      state.busy = false

      if (!reply?.ok) {
        status.textContent = reply?.error || 'That did not go in'
        status.className = 'dialog-status is-bad'
        paintFooter()
        return
      }

      if (!reply.added && reply.skipped) {
        status.textContent = `All ${num(reply.skipped)} of them were already in your list — nothing added`
        status.className = 'dialog-status is-ok'
        paintFooter()
        return
      }

      state.added += reply.added || 0
      if (!keepOpen) {
        finish()
        return
      }

      status.textContent = `Added ${num(reply.added || 0)} — ${num(state.added)} this session`
      status.className = 'dialog-status is-ok'
      if (state.mode === 'single') {
        state.bare = ''
        paintName()
        nameInput.focus()
      } else if (state.mode === 'text') {
        textArea.value = ''
        state.parsed = null
        textNote.textContent = ''
      } else {
        state.file = null
        fileNote.textContent = ''
        fileName.textContent = ''
      }
      paintFooter()
    }

    nameInput.addEventListener('input', () => {
      const typed = nameInput.value.trim()
      const found = splitFlagName(typed)
      if (found) {
        state.scope = found.scope
        state.family = found.family
        state.bare = found.bare
        state.custom = false
        buildValue()
      } else {
        state.bare = typed
        state.custom = true
      }
      paintBlocks()
      paintName()
      askSuggest()
    })
    nameInput.addEventListener('blur', () => setTimeout(() => { suggestBox.hidden = true }, 160))

    textArea.addEventListener('input', onText)

    addButton.addEventListener('click', () => submit(false))
    keepButton.addEventListener('click', () => submit(true))

    const onKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        finish()
      } else if (event.key === 'Enter' && !event.shiftKey && state.mode !== 'text') {
        event.preventDefault()
        event.stopPropagation()
        submit(false)
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        event.stopPropagation()
        submit(false)
      }
    }

    const dialog = el('div', { class: 'dialog dialog-wide' }, [
      el('div', { class: 'dialog-top' }, [
        el('h2', { class: 'dialog-title', text: title }),
        tabs
      ]),
      panels,
      el('div', { class: 'dialog-actions' }, [
        status,
        el('button', { class: 'btn', text: 'Close', onclick: () => finish() }),
        keepButton,
        addButton
      ])
    ])

    const veil = el('div', {
      class: 'dialog-veil',
      onclick: event => { if (event.target === veil) finish() }
    }, [dialog])

    paintTabs()
    paintBlocks()
    paintMerge()
    buildValue()
    paintName()

    document.body.append(veil)
    document.addEventListener('keydown', onKey, true)
    requestAnimationFrame(() => {
      veil.classList.add('is-on')
      nameInput.focus()
    })
  })
}

const Bus = {
  _topics: new Map(),
  on (topic, handler) {
    if (!this._topics.has(topic)) this._topics.set(topic, new Set())
    this._topics.get(topic).add(handler)
    return () => this._topics.get(topic).delete(handler)
  },
  emit (topic, payload) {
    for (const handler of this._topics.get(topic) || []) {
      try {
        handler(payload)
      } catch (error) {
        console.error(`[bus] ${topic} handler failed:`, error)
      }
    }
  }
}

function askHotkeys ({ title = 'App hotkeys', rows = [] } = {}) {
  return new Promise(resolve => {
    let settled = false
    const chosen = {}
    for (const row of rows) chosen[row.action] = row.value || ''

    const finish = answer => {
      if (settled) return
      settled = true
      document.removeEventListener('keydown', onKey, true)
      veil.classList.remove('is-on')
      setTimeout(() => veil.remove(), 180)
      resolve(answer)
    }

    const onKey = event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      finish(null)
    }

    const accelerator = event => {
      const parts = []
      if (event.ctrlKey) parts.push('Control')
      if (event.altKey) parts.push('Alt')
      if (event.shiftKey) parts.push('Shift')
      const key = event.key
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return ''
      if (key === ' ') parts.push('Space')
      else if (key.length === 1) parts.push(key.toUpperCase())
      else parts.push(key)
      return parts.join('+')
    }

    const grid = el('div', { class: 'hotkey-grid' }, rows.map(row => {
      const input = el('input', {
        class: 'input hotkey-input',
        type: 'text',
        readonly: 'true',
        value: row.value || '',
        placeholder: 'click, then press',
        onkeydown: event => {
          event.preventDefault()
          if (event.key === 'Backspace' || event.key === 'Delete') {
            input.value = ''
            chosen[row.action] = ''
            return
          }
          const combo = accelerator(event)
          if (!combo) return
          input.value = combo
          chosen[row.action] = combo
        }
      })
      return el('div', { class: 'hotkey-row' }, [
        el('span', { class: 'hotkey-label', text: row.label }),
        input
      ])
    }))

    const dialog = el('div', { class: 'dialog dialog-wide' }, [
      el('h2', { class: 'dialog-title', text: title }),
      el('p', {
        class: 'dialog-body',
        text: 'Click a box and press the keys you want. Backspace clears one. These work while you are in the game.'
      }),
      grid,
      el('div', { class: 'dialog-actions' }, [
        el('button', { class: 'btn', text: 'Cancel', onclick: () => finish(null) }),
        el('button', { class: 'btn btn-accent', text: 'Save hotkeys', onclick: () => finish({ ...chosen }) })
      ])
    ])

    const veil = el('div', {
      class: 'dialog-veil',
      onclick: event => { if (event.target === veil) finish(null) }
    }, [dialog])

    document.body.append(veil)
    document.addEventListener('keydown', onKey, true)
    requestAnimationFrame(() => veil.classList.add('is-on'))
  })
}

window.UI = { $, $$, el, icon, num, mb, clockTime, debounce, coerce, toast, ask, askText, askChoice, askFlags, askExit, askHotkeys, menu, splitFlagName, Bus }
