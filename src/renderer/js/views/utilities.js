'use strict'

;(function () {
  const { $, el, num, mb, clockTime, toast, Bus } = window.UI
  const { Engine, Memory, Settings, Updates } = window.API

  const MINI_LOG_LINES = 40

  const els = {}
  let looping = false
  let pollTimer = null
  let lastPhase = ''

  function cache () {
    Object.assign(els, {
      fill: $('#mem-fill'),
      used: $('#mem-used'),
      total: $('#mem-total'),
      deep: $('#mem-deep'),
      interval: $('#mem-interval'),
      flush: $('#mem-flush'),
      loop: $('#mem-loop'),
      log: $('#mem-log'),
      guard: $('#mem-guard'),
      threshold: $('#mem-threshold'),
      spoof: $('#btn-spoof'),
      uninject: $('#btn-uninject'),
      restart: $('#btn-engine-restart'),
      exitMode: $('#exit-mode'),
      upVersions: $('#up-versions'),
      upCheck: $('#up-check'),
      upGauge: $('#up-gauge'),
      upFill: $('#up-fill'),
      upProgress: $('#up-progress'),
      upSize: $('#up-size'),
      upStatus: $('#up-status'),
      upApplyRow: $('#up-apply-row'),
      upApplyNote: $('#up-apply-note'),
      upApply: $('#up-apply'),
      upAuto: $('#up-auto'),
      upUrl: $('#up-url')
    })
  }

  function paintUpdates (state) {
    if (!state || !els.upVersions) return

    const about = $('#about-version')
    if (about) about.textContent = state.appVersion || '—'

    if (state.phase === 'ready' && lastPhase !== 'ready' && state.pendingApp) {
      toast(`Update ${state.pendingApp.version} downloaded — it installs when you close the app`, 'success')
    }
    lastPhase = state.phase

    const engine = state.engineVersion ? ` · engine ${state.engineVersion}` : ''
    els.upVersions.textContent = `NebulaStrap ${state.appVersion || '?'}${engine}`
    els.upAuto.checked = state.auto !== false
    if (document.activeElement !== els.upUrl) els.upUrl.value = state.customUrl || ''

    const downloading = state.phase === 'downloading' && state.progress
    els.upGauge.hidden = !downloading
    if (downloading) {
      const { percent, received, total, what } = state.progress
      els.upFill.style.width = `${percent}%`
      els.upProgress.textContent = `${what === 'engine' ? 'Engine' : 'App'} · ${percent}%`
      els.upSize.textContent = total ? `${mb(received / 1048576)} of ${mb(total / 1048576)}` : mb(received / 1048576)
    }

    const pending = state.pendingApp
    els.upApplyRow.hidden = !pending
    if (pending) {
      els.upApplyNote.textContent = `Version ${pending.version} is on disk. It installs by itself when you close the app.`
    }

    els.upCheck.disabled = state.phase === 'checking' || state.phase === 'downloading'

    if (state.phase === 'checking') els.upStatus.textContent = 'Looking for a newer build...'
    else if (state.phase === 'downloading') els.upStatus.textContent = 'Downloading in the background - carry on, nothing is interrupted.'
    else if (state.phase === 'error') els.upStatus.innerHTML = `<span class="bad">${state.error || 'the check failed'}</span>`
    else if (state.phase === 'ready') els.upStatus.textContent = 'Ready to install.'
    else if (state.phase === 'uptodate') els.upStatus.textContent = 'This is the newest build.'
    else els.upStatus.textContent = 'No check has run yet.'
  }

  async function refreshUpdates () {
    try {
      const state = await Updates.state()
      if (state?.ok !== false) paintUpdates(state)
    } catch {}
  }

  async function checkUpdates () {
    els.upCheck.disabled = true
    const reply = await Updates.check()
    if (reply?.ok === false && reply.error) toast(reply.error, 'error')
    els.upCheck.disabled = false
    refreshUpdates()
  }

  function paintMemory (memory) {
    if (!memory) return
    els.fill.style.width = `${memory.percent}%`
    els.used.textContent = `${mb(memory.usedMB)} used · ${memory.percent}%`
    els.total.textContent = `${mb(memory.totalMB)} total`
  }

  function note (html) {
    els.log.prepend(el('div', { html: `<span class="muted">${clockTime()}</span> ${html}` }))
    while (els.log.children.length > MINI_LOG_LINES) els.log.lastChild.remove()
  }

  async function flushOnce () {
    els.flush.disabled = true
    try {
      const reply = await Memory.flush(els.deep.checked)
      if (!reply.ok) note(`<span class="bad">flush failed: ${reply.error || 'unknown error'}</span>`)
    } catch (error) {
      note(`<span class="bad">${error.message}</span>`)
    } finally {
      els.flush.disabled = false
    }
  }

  async function toggleLoop () {
    if (looping) {
      await Memory.stopLoop()
      return
    }
    const seconds = Math.max(0.05, Number(els.interval.value) || 2)
    els.interval.value = seconds
    Settings.write({ flush: { intervalSeconds: seconds, deep: els.deep.checked } })
    const reply = await Memory.startLoop(seconds, els.deep.checked)
    if (!reply.ok) toast(reply.error || 'Could not start the loop', 'error')
  }

  function setLooping (value) {
    looping = value
    els.loop.classList.toggle('is-on', value)
    els.loop.textContent = value ? 'Stop loop' : 'Start loop'
  }

  function setGuarding (value, threshold) {
    els.guard.checked = value
    if (threshold) els.threshold.value = threshold
    els.threshold.disabled = !value
  }

  async function applyGuard () {
    if (els.guard.checked) {
      const threshold = Math.max(50, Math.min(99, Math.round(Number(els.threshold.value) || 88)))
      els.threshold.value = threshold
      await Memory.startGuard(threshold, els.deep.checked)
      Settings.write({ flush: { guard: true, threshold } })
    } else {
      await Memory.stopGuard()
      Settings.write({ flush: { guard: false } })
    }
  }

  async function restore (mode) {
    const live = window.Store.status.injected
    if (!live) {
      toast('Nothing is injected right now', 'info')
      return
    }
    const reply = await Engine.restore(mode)
    if (!reply.ok) {
      toast(reply.error || 'Not attached', 'error')
      return
    }
    if (reply.residue) {
      toast(`${num(reply.restored)} put back — ${num(reply.residue)} would not go back, restart Roblox`, 'warning')
    } else {
      toast(`${num(reply.restored)} flags stripped — nothing left in the client`, 'success')
    }
    if (mode !== 'defaults') Bus.emit('flags-replaced')
  }

  function onShow () {
    refreshUpdates()
    Memory.status().then(reply => reply.ok && paintMemory(reply.memory))
    clearInterval(pollTimer)
    pollTimer = setInterval(async () => {
      const reply = await Memory.status()
      if (reply.ok) paintMemory(reply.memory)
    }, 2500)
  }

  function onHide () {
    clearInterval(pollTimer)
    pollTimer = null
  }

  function init () {
    cache()

    els.flush.addEventListener('click', flushOnce)
    Bus.on('flush-now', flushOnce)
    els.loop.addEventListener('click', toggleLoop)
    els.deep.addEventListener('change', () => {
      Settings.write({ flush: { deep: els.deep.checked } })
      if (els.guard.checked) applyGuard()
    })
    els.guard.addEventListener('change', applyGuard)
    els.threshold.addEventListener('change', () => {
      if (els.guard.checked) applyGuard()
      else Settings.write({ flush: { threshold: Math.max(50, Math.min(99, Number(els.threshold.value) || 88)) } })
    })
    els.interval.addEventListener('change', () => {
      const seconds = Math.max(0.05, Math.min(600, Number(els.interval.value) || 2))
      els.interval.value = seconds
      Settings.write({ flush: { intervalSeconds: seconds } })
      if (looping) Memory.startLoop(seconds, els.deep.checked)
    })

    els.spoof.addEventListener('click', () => restore('spoof'))
    els.uninject.addEventListener('click', () => restore('defaults'))
    els.restart.addEventListener('click', () => {
      Engine.restart()
      toast('Restarting the engine', 'info')
    })

    els.exitMode.addEventListener('change', () => {
      Settings.write({ exitMode: els.exitMode.value })
    })

    els.upCheck.addEventListener('click', checkUpdates)
    els.upAuto.addEventListener('change', () => Updates.set({ auto: els.upAuto.checked }))
    els.upUrl.addEventListener('change', async () => {
      const reply = await Updates.set({ url: els.upUrl.value.trim() })
      if (reply?.ok === false) toast(reply.error || 'that address was not accepted', 'error')
      else toast('Update source saved', 'success')
      refreshUpdates()
    })
    els.upApply.addEventListener('click', async () => {
      const reply = await Updates.apply('app')
      if (reply?.ok === false) toast(reply.error || 'nothing to install', 'error')
    })

    Updates.onEvent(state => paintUpdates(state))
    refreshUpdates()

    Memory.onEvent(event => {
      if (event.ev === 'flush') {
        paintMemory(event.memory)
        const freed = event.freedMB > 0 ? `<b>+${mb(event.freedMB)}</b> freed` : 'nothing to reclaim'
        const why = event.auto ? `<span class="warn">guard @ ${event.trigger}%</span> · ` : ''
        note(`${why}${freed} · ${num(event.trimmed)} processes trimmed${event.purged ? ' · standby purged' : ''}`)
      } else if (event.ev === 'loop') setLooping(Boolean(event.running))
      else if (event.ev === 'guard') setGuarding(Boolean(event.watching), event.threshold)
      else if (event.ev === 'error') note(`<span class="bad">${event.message}</span>`)
    })

    Bus.on('config', config => {
      els.deep.checked = config.flush?.deep !== false
      els.interval.value = config.flush?.intervalSeconds ?? 2
      els.guard.checked = config.flush?.guard !== false
      els.threshold.value = config.flush?.threshold ?? 88
      els.exitMode.value = config.exitMode || 'ask'
    })

    setLooping(false)
    Memory.settings().then(reply => {
      if (reply?.ok && reply.guard) setGuarding(Boolean(reply.guard.watching), reply.guard.threshold)
    })
  }

  window.Views = window.Views || {}
  window.Views.utilities = { init, onShow, onHide }
})()
