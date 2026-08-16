'use strict'

;(function () {
  const { $, $$, toast, num, askExit, Bus } = window.UI
  const { Engine, Settings, Win } = window.API

  const TITLES = {
    dashboard: 'Main',
    fastflags: 'Fast Flags',
    presets: 'Presets',
    macro: 'Macro',
    utilities: 'Utilities',
    logs: 'Logs',
    appearance: 'Appearance',
    about: 'Info & Credits'
  }

  function show (name) {
    if (!TITLES[name] || name === window.Store.view) return

    const previous = window.Views[window.Store.view]
    previous?.onHide?.()

    window.Store.view = name
    document.documentElement.dataset.view = name
    $('#view-title').textContent = TITLES[name]

    $$('.view').forEach(view => view.classList.toggle('is-active', view.dataset.view === name))
    $$('.nav-item').forEach(item => item.classList.toggle('is-active', item.dataset.view === name))

    window.Views[name]?.onShow?.()
    Bus.emit('view', name)
    Settings.write({ lastView: name })
  }

  function setEngineBadge (text) {
    const cell = $('#about-engine')
    cell.textContent = text
    cell.classList.toggle('is-ok', text.toLowerCase() === 'online')
  }

  function pushSettings () {
    const config = window.Store.config
    if (!config) return
    Engine.settings({
      fuzzy: Boolean(config.fuzzy),
      guard: config.guard !== false,
      limits: config.limits !== false,
      autoAttach: Boolean(config.autoAttach)
    })
    if (config.monitor) Engine.monitor(true, config.monitorInterval || 20)
  }

  function routeEngineEvent (event) {
    switch (event.ev) {
      case 'ready':
        Bus.emit('engine-state', 'online')
        setEngineBadge('Online')
        pushSettings()
        Engine.status().then(reply => window.Store.applyStatus(reply.status || {}))
        break

      case 'log':
        Bus.emit('log', event)
        break

      case 'status': {
        const { ev, ...status } = event
        window.Store.applyStatus(status)
        $('#about-build').textContent = status.version || 'Unknown'
        $('#about-offsets').textContent = num(status.offsets)
        break
      }

      case 'progress':
        Bus.emit('progress', event)
        break

      case 'macro':
        Bus.emit('macro', event)
        break

      case 'lost':
        toast('Roblox closed — session ended', 'error')
        break
    }
  }

  function wireWindowControls () {
    let asking = false

    $('#win-min').addEventListener('click', () => Win.minimize())
    $('#win-max').addEventListener('click', () => Win.maximize())
    $('#win-close').addEventListener('click', () => Win.close())

    Win.onExitAsk(async () => {
      if (asking) return
      asking = true
      try {
        const choice = await askExit({
          injected: window.Store.status.injected,
          monitoring: window.Store.status.monitoring
        })
        if (!choice) return
        if (choice.remember) {
          const mode = choice.action === 'quit' ? 'quit' : 'background'
          await Settings.write({ exitMode: mode })
          window.Store.setConfig({ ...(window.Store.config || {}), exitMode: mode })
        }
        if (choice.action === 'background') Win.background()
        else Win.quit()
      } finally {
        asking = false
      }
    })
  }

  function wireDropTarget () {
    const veil = $('#drop-veil')
    let depth = 0

    document.addEventListener('dragenter', event => {
      event.preventDefault()
      depth++
      veil.classList.add('is-on')
    })
    document.addEventListener('dragover', event => event.preventDefault())
    document.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1)
      if (!depth) veil.classList.remove('is-on')
    })
    document.addEventListener('drop', event => {
      event.preventDefault()
      depth = 0
      veil.classList.remove('is-on')
      const file = event.dataTransfer?.files?.[0]
      if (!file?.path) return
      show('fastflags')
      Bus.emit('import-path', file.path)
    })
  }

  function wireShortcuts () {
    document.addEventListener('keydown', event => {
      if (!event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      const jump = { 1: 'dashboard', 2: 'fastflags', 3: 'presets', 4: 'macro', 5: 'utilities', 6: 'logs', 7: 'appearance' }[key]
      if (jump) {
        event.preventDefault()
        show(jump)
        return
      }
      if (key === 'i' && !$('#btn-inject').disabled) {
        event.preventDefault()
        $('#btn-inject').click()
      } else if (key === 'a') {
        event.preventDefault()
        $('#btn-attach').click()
      }
    })
  }

  async function boot () {
    const config = await Settings.read()
    window.Theme.apply(config.appearance)

    for (const view of Object.values(window.Views)) view.init?.()

    $$('.nav-item').forEach(item => {
      item.addEventListener('click', () => show(item.dataset.view))
    })

    wireWindowControls()
    wireDropTarget()
    wireShortcuts()

    Bus.emit('engine-state', 'starting')

    const held = []
    let replaying = true
    Engine.onEvent(event => {
      if (replaying) held.push(event)
      else routeEngineEvent(event)
    })

    const history = await Engine.backlog().catch(() => ({ events: [], seq: 0 }))
    for (const event of history.events || []) routeEngineEvent(event)
    replaying = false
    for (const event of held) {
      if (!event.seq || event.seq > (history.seq || 0)) routeEngineEvent(event)
    }

    window.Store.setConfig(config)

    if (config.lastView && config.lastView !== 'dashboard') show(config.lastView)

    const status = await Engine.status().catch(() => null)
    if (status?.ok) {
      window.Store.applyStatus(status.status || {})
      Bus.emit('engine-state', 'online')
      setEngineBadge('Online')
    }

    pushSettings()
  }

  document.addEventListener('DOMContentLoaded', boot)
})()
