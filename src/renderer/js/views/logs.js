'use strict'

;(function () {
  const { $, $$, el, clockTime, toast, debounce, Bus } = window.UI

  const MAX_LINES = 4000

  const els = {}
  const entries = []
  const levels = new Set(['info', 'success', 'warning', 'error'])
  let query = ''
  let follow = true
  let unread = false

  function cache () {
    Object.assign(els, {
      body: $('#log-body'),
      search: $('#log-search'),
      follow: $('#log-follow'),
      copy: $('#log-copy'),
      clear: $('#log-clear'),
      chips: $('#log-levels'),
      dot: $('#nav-log-dot')
    })
  }

  const visible = entry => levels.has(entry.level) &&
    (!query || entry.message.toLowerCase().includes(query))

  function lineNode (entry) {
    return el('div', { class: `log-line is-${entry.level}` }, [
      el('span', { class: 'log-time', text: entry.time }),
      el('span', { class: 'log-text', text: entry.message })
    ])
  }

  function repaint () {
    els.body.replaceChildren(...entries.filter(visible).map(lineNode))
    if (follow) els.body.scrollTop = els.body.scrollHeight
  }

  function append (entry) {
    entries.push(entry)
    if (entries.length > MAX_LINES) entries.splice(0, entries.length - MAX_LINES)

    if (!visible(entry)) return
    els.body.append(lineNode(entry))
    while (els.body.children.length > MAX_LINES) els.body.firstChild.remove()
    if (follow) els.body.scrollTop = els.body.scrollHeight
  }

  function markUnread (level) {
    if (window.Store.view === 'logs') return
    if (level !== 'warning' && level !== 'error') return
    unread = true
    els.dot.classList.add('is-on')
  }

  function init () {
    cache()

    els.search.addEventListener('input', debounce(() => {
      query = els.search.value.trim().toLowerCase()
      repaint()
    }, 160))

    els.follow.addEventListener('change', event => {
      follow = event.target.checked
      if (follow) els.body.scrollTop = els.body.scrollHeight
    })

    $$('.chip', els.chips).forEach(chip => {
      chip.addEventListener('click', () => {
        const level = chip.dataset.level
        if (levels.has(level)) levels.delete(level)
        else levels.add(level)
        chip.classList.toggle('is-on', levels.has(level))
        repaint()
      })
    })

    els.copy.addEventListener('click', async () => {
      const text = entries.filter(visible).map(entry => `${entry.time} ${entry.message}`).join('\n')
      await navigator.clipboard.writeText(text)
      toast('Log copied to the clipboard', 'success')
    })

    els.clear.addEventListener('click', () => {
      entries.length = 0
      repaint()
    })

    Bus.on('log', ({ msg, level }) => {
      const entry = { time: clockTime(), message: String(msg), level: level || 'info' }
      append(entry)
      markUnread(entry.level)
    })

    Bus.on('view', name => {
      if (name !== 'logs') return
      unread = false
      els.dot.classList.remove('is-on')
      if (follow) els.body.scrollTop = els.body.scrollHeight
    })
  }

  window.Views = window.Views || {}
  window.Views.logs = { init }
})()
