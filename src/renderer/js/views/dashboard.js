'use strict'

;(function () {
  const { $, el, num, clockTime, toast, ask, Bus } = window.UI
  const { Engine, Settings, Win, Multi, Fps } = window.API

  const MAIN_LOG_LINES = 40

  const els = {}
  let attachBusy = false
  let monitorBusy = false
  let fpsState = null

  function cache () {
    Object.assign(els, {
      strip: $('#strip'),
      tileStatus: $('#tile-status'),
      tilePid: $('#tile-pid'),
      tileBuild: $('#tile-build'),
      tileFlags: $('#ledger-flags'),
      tileOffsets: $('#tile-offsets'),
      monitorState: $('#monitor-state'),
      autoAttach: $('#opt-auto-attach'),
      autoAttachState: $('#auto-attach-state'),
      multi: $('#opt-multi'),
      multiState: $('#multi-state'),
      fpsRow: $('#row-fps'),
      fpsState: $('#fps-state'),
      fpsNote: $('#fps-note'),
      fpsUncap: $('#btn-fps-uncap'),
      fpsLock: $('#opt-fps-lock'),
      fpsLockState: $('#fps-lock-state'),
      streamproofState: $('#streamproof-state'),
      fuzzyState: $('#fuzzy-state'),
      guardState: $('#guard-state'),
      limitsState: $('#limits-state'),

      attach: $('#btn-attach'),
      attachLabel: $('#btn-attach-label'),
      attachNote: $('#btn-attach-note'),
      inject: $('#btn-inject'),
      uninject: $('#btn-uninject-main'),
      monitor: $('#opt-monitor'),
      monitorRow: $('#row-monitor'),
      cancel: $('#btn-cancel'),

      progress: $('#progress'),
      progressLabel: $('#progress-label'),
      progressPct: $('#progress-pct'),
      progressFill: $('#progress-fill'),
      progressOk: $('#progress-ok'),
      progressFail: $('#progress-fail'),
      progressTotal: $('#progress-total'),

      streamproof: $('#opt-streamproof'),
      fuzzy: $('#opt-fuzzy'),
      guard: $('#opt-guard'),
      limits: $('#opt-limits'),
      interval: $('#opt-monitor-interval'),

      reinjections: $('#metric-reinjections'),
      offsets: $('#metric-offsets'),
      applied: $('#metric-applied'),
      engine: $('#metric-engine'),

      log: $('#main-log'),
      statusPill: $('#status-pill'),
      statusText: $('#status-text')
    })
  }

  function render (status) {
    const injecting = window.Store.injecting

    const phase = injecting ? 'busy' : status.monitoring ? 'watch' : status.connected ? 'ready' : 'idle'
    els.strip.className = `strip is-${phase}`
    els.tileStatus.textContent = injecting
      ? 'Injecting'
      : status.monitoring ? 'Live' : status.connected ? 'Ready' : 'Idle'

    els.tilePid.textContent = status.pid ? `PID ${status.pid}` : 'no process'
    els.tileBuild.textContent = status.connected
      ? (status.clientBuild || status.version || 'unknown build')
      : 'Not attached'
    els.tileOffsets.textContent = `${num(status.offsets)} offsets`

    els.tileFlags.textContent = num(status.flags)
    els.reinjections.textContent = num(status.reinjections)
    els.offsets.textContent = num(status.offsets)
    els.applied.textContent = num(status.injected)

    els.attach.classList.toggle('btn-accent', !status.connected)
    els.attach.classList.toggle('btn-danger-ghost', Boolean(status.connected))
    els.attachLabel.textContent = status.connected ? 'Detach' : 'Attach'
    els.attachNote.textContent = status.connected
      ? 'Strip every flag and let go of the client'
      : 'Open the running client and read its offsets'
    els.attach.disabled = attachBusy

    els.inject.disabled = !status.connected || injecting
    els.uninject.disabled = !status.connected || injecting || !status.injected

    els.monitor.disabled = monitorBusy
    if (status.monitorArmed !== undefined) els.monitor.checked = Boolean(status.monitorArmed)
    paintMonitorRow(status)

    if (status.autoAttach !== undefined) els.autoAttach.checked = Boolean(status.autoAttach)
    paintRow(els.autoAttach, els.autoAttachState)

    els.fuzzy.checked = Boolean(status.fuzzy)
    paintRow(els.fuzzy, els.fuzzyState)

    els.guard.checked = status.guard !== false
    paintRow(els.guard, els.guardState)

    els.limits.checked = status.limits !== false
    paintRow(els.limits, els.limitsState)

    if (status.connected && status.buildMatch === false) {
      els.tileBuild.textContent = `${status.clientBuild || 'unknown build'} — offsets are for ${status.version || 'another build'}`
      els.tileBuild.classList.add('is-warn')
    } else if (status.connected && status.buildMatch === null && status.buildCheckable) {
      els.tileBuild.textContent = 'build unreadable — injection blocked'
      els.tileBuild.classList.add('is-warn')
    } else {
      els.tileBuild.classList.remove('is-warn')
    }

    els.statusPill.classList.toggle('is-live', status.connected && !injecting)
    els.statusPill.classList.toggle('is-busy', injecting)
    els.statusText.textContent = injecting
      ? 'Injecting'
      : status.connected ? (status.monitoring ? 'Live Monitor' : 'Attached') : 'Disconnected'
  }

  function paintRow (input, chip) {
    chip.textContent = input.checked ? 'On' : 'Off'
    const row = input.closest('.rack-row')
    row?.classList.toggle('is-on', input.checked)
    row?.classList.toggle('is-off', !input.checked)
    row?.classList.remove('is-waiting')
  }

  function paintMonitorRow (status) {
    const armed = els.monitor.checked
    const running = armed && Boolean(status.monitoring)
    const waiting = armed && !running

    els.monitorState.textContent = !armed ? 'Off' : running ? 'On' : 'Waiting'
    els.monitorRow.classList.toggle('is-on', running)
    els.monitorRow.classList.toggle('is-waiting', waiting)
    els.monitorRow.classList.toggle('is-off', !armed)
  }

  function showProgress (visible) {
    els.progress.hidden = !visible
    if (visible) return
    els.progressFill.style.width = '0%'
    els.progressPct.textContent = '0%'
    els.progressOk.textContent = '0 applied'
    els.progressFail.textContent = '0 failed'
    els.progressTotal.textContent = 'of 0'
  }

  function onProgress (event) {
    const pct = event.total ? Math.round((event.current / event.total) * 100) : 0
    els.progressFill.style.width = `${pct}%`
    els.progressPct.textContent = `${pct}%`
    els.progressOk.textContent = `${num(event.success)} applied`
    els.progressFail.textContent = `${num(event.failed)} failed`
    els.progressTotal.textContent = `of ${num(event.total)}`
  }

  function paintFps (state) {
    if (!state) return
    fpsState = state

    if (!state.ok) {
      els.fpsState.textContent = 'N/A'
      els.fpsNote.textContent = state.error || 'Roblox settings file not found'
      els.fpsUncap.disabled = true
      els.fpsRow.classList.remove('is-on')
      els.fpsRow.classList.add('is-off')
      return
    }

    const capped = state.cap !== null && !state.uncapped
    els.fpsState.textContent = state.cap === null ? 'Not set' : state.uncapped ? 'Unlimited' : String(state.cap)
    els.fpsNote.textContent = capped
      ? `Roblox's own frame rate cap is ${num(state.cap)} — that ceiling wins no matter what the flags say`
      : "Roblox's own frame rate cap is already unlimited"
    els.fpsUncap.disabled = Boolean(state.uncapped)
    els.fpsRow.classList.toggle('is-on', Boolean(state.uncapped))
    els.fpsRow.classList.toggle('is-waiting', capped)
    els.fpsRow.classList.toggle('is-off', !state.uncapped && !capped)

    els.fpsLock.checked = Boolean(state.locked)
    paintRow(els.fpsLock, els.fpsLockState)
  }

  async function uncapFps () {
    els.fpsUncap.disabled = true
    try {
      const client = await Engine.probe().catch(() => null)
      if (client?.running && !els.fpsLock.checked) {
        const agreed = await ask({
          title: 'Roblox is open right now',
          body: 'Roblox writes this settings file back out when it closes, so the cap you set here goes away the moment you quit the game.',
          note: 'Turn "Hold the uncap" on instead and it gets put back every time — or close Roblox first.',
          confirmLabel: 'Set it anyway',
          cancelLabel: 'Cancel'
        })
        if (!agreed) return
      }

      const reply = await Fps.uncap()
      if (!reply.ok) {
        toast(reply.error || 'Could not write the Roblox settings file', 'error')
        return
      }
      paintFps(reply)
      toast(reply.changed
        ? `Frame rate cap lifted — ${reply.previous === null ? 'it was not set' : num(reply.previous)} → unlimited`
        : 'Frame rate cap was already unlimited', reply.changed ? 'success' : 'info')
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      paintFps(fpsState)
    }
  }

  async function toggleFpsLock (event) {
    const on = event.target.checked
    paintRow(els.fpsLock, els.fpsLockState)
    try {
      const reply = await Fps.lock(on)
      if (!reply.ok) {
        els.fpsLock.checked = !on
        paintRow(els.fpsLock, els.fpsLockState)
        toast(reply.error || 'Could not start the FPS lock', 'error')
        return
      }
      paintFps(reply)
      toast(on
        ? 'Holding the uncap — the in-game frame rate setting cannot lower it while this is on'
        : 'Lock off — you are still uncapped until you change it in Roblox yourself',
      on ? 'success' : 'info')
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  async function toggleAttach () {
    if (attachBusy) return

    const wasConnected = window.Store.status.connected
    const live = window.Store.status.injected

    if (wasConnected && live > 0) {
      const agreed = await ask({
        title: 'Detach and strip every flag?',
        body: `${num(live)} flag${live === 1 ? ' is' : 's are'} live in Roblox right now. Detaching takes all of them back out — every byte we overwrote goes back to the client's own value, and the game runs stock again.`,
        note: 'Detaching while you are mid-round means the flags stop applying immediately. Uninject leaves you attached if you only want to pull the flags.',
        confirmLabel: 'Detach and strip',
        cancelLabel: 'Stay attached',
        danger: true
      })
      if (!agreed) return
    }

    attachBusy = true
    render(window.Store.status)

    try {
      const reply = wasConnected ? await Engine.detach() : await Engine.attach()
      if (!wasConnected) {
        toast(reply.ok ? 'Attached to Roblox' : 'Could not attach — check the log',
          reply.ok ? 'success' : 'error')
      } else if (live > 0) {
        toast(reply.residue
          ? `Detached, but ${num(reply.residue)} flag${reply.residue === 1 ? '' : 's'} would not go back — restart Roblox`
          : `Detached — ${num(reply.restored)} flags stripped, nothing left behind`,
        reply.residue ? 'warning' : 'success')
      } else {
        toast('Detached', 'info')
      }
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      attachBusy = false
      const status = await Engine.status()
      window.Store.applyStatus(status.status || {})
    }
  }

  async function inject () {
    if (!window.Store.status.flags) {
      toast('No flags loaded — add some on the Fast Flags page', 'warning')
      return
    }
    window.Store.setInjecting(true)
    showProgress(true)
    els.progressLabel.textContent = 'Injecting'
    render(window.Store.status)

    try {
      const result = await Engine.inject()
      if (result.ok) {
        els.progressLabel.textContent = result.aborted ? 'Stopped' : 'Complete'
        const rate = result.total ? Math.round((result.success / result.total) * 100) : 0
        toast(`${num(result.success)} of ${num(result.total)} flags applied (${rate}%)`,
          rate >= 90 ? 'success' : 'info')
      } else {
        toast(result.error || 'Injection failed', 'error')
      }
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      window.Store.setInjecting(false)
      setTimeout(() => showProgress(false), 2200)
      const status = await Engine.status()
      window.Store.applyStatus(status.status || {})
    }
  }

  async function uninject () {
    const applied = window.Store.status.injected
    els.uninject.disabled = true
    try {
      const reply = await Engine.restore('defaults')
      if (!reply.ok) {
        toast(reply.error || 'Uninject failed', 'error')
        return
      }
      if (reply.residue) {
        toast(`${num(reply.restored)} of ${num(applied)} stripped — ${num(reply.residue)} would not go back, restart Roblox`, 'warning')
      } else {
        toast(`${num(reply.restored)} flags stripped — the client is back to stock`, 'success')
      }
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      const status = await Engine.status()
      window.Store.applyStatus(status.status || {})
    }
  }

  async function toggleMonitor () {
    if (monitorBusy) return
    const on = els.monitor.checked
    const interval = Number(els.interval.value) || 20

    monitorBusy = true
    render(window.Store.status)
    try {
      const reply = await Engine.monitor(on, interval)
      if (!reply.ok) {
        toast(reply.error || 'Live Monitor failed', 'warning')
      } else if (!on) {
        toast('Live Monitor off', 'info')
      } else {
        toast(reply.monitoring
          ? 'Live Monitor on — Save config on the Fast Flags page writes your list in'
          : 'Live Monitor on, waiting for a client — it starts by itself once you attach',
        reply.monitoring ? 'success' : 'info')
      }
      Settings.write({ monitor: on })
      window.Store.applyStatus({
        monitoring: Boolean(reply.monitoring),
        monitorArmed: Boolean(reply.armed)
      })
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      monitorBusy = false
      const status = await Engine.status()
      window.Store.applyStatus(status.status || {})
    }
  }

  function init () {
    cache()

    els.attach.addEventListener('click', toggleAttach)
    els.inject.addEventListener('click', inject)
    els.uninject.addEventListener('click', uninject)
    els.monitor.addEventListener('change', toggleMonitor)
    els.cancel.addEventListener('click', () => Engine.cancel())

    els.multi.addEventListener('change', async event => {
      const wanted = event.target.checked
      paintRow(els.multi, els.multiState)
      const reply = await Multi.set(wanted)
      if (!reply?.ok) {
        els.multi.checked = !wanted
        paintRow(els.multi, els.multiState)
        toast(reply?.error || 'Multi-Instance could not start', 'error')
        return
      }
      toast(wanted
        ? 'Multi-Instance on — open as many Roblox windows as you want'
        : 'Multi-Instance off — Roblox is back to one window', wanted ? 'success' : 'info')
    })

    els.fpsUncap.addEventListener('click', uncapFps)
    els.fpsLock.addEventListener('change', toggleFpsLock)

    Fps.onEvent(event => {
      if (event.kind !== 'relocked') return
      Bus.emit('log', {
        level: 'info',
        msg: `[*] Roblox put the frame rate cap back to ${event.previous} - lifted it again`
      })
      Fps.read().then(paintFps)
    })

    Fps.read().then(paintFps)

    els.autoAttach.addEventListener('change', async event => {
      const on = event.target.checked
      paintRow(els.autoAttach, els.autoAttachState)
      await Engine.settings({ autoAttach: on })
      Settings.write({ autoAttach: on })
      toast(on
        ? 'Auto Attach on — Roblox gets picked up as soon as it is running'
        : 'Auto Attach off', on ? 'success' : 'info')
    })

    els.streamproof.addEventListener('change', event => {
      Win.setStreamproof(event.target.checked)
      paintRow(els.streamproof, els.streamproofState)
      toast(event.target.checked ? 'Hidden from screen capture' : 'Visible to screen capture',
        event.target.checked ? 'success' : 'info')
    })

    els.fuzzy.addEventListener('change', async event => {
      paintRow(els.fuzzy, els.fuzzyState)
      await Engine.settings({ fuzzy: event.target.checked })
      Settings.write({ fuzzy: event.target.checked })
    })

    els.guard.addEventListener('change', async event => {
      paintRow(els.guard, els.guardState)
      await Engine.settings({ guard: event.target.checked })
      Settings.write({ guard: event.target.checked })
      if (!event.target.checked) {
        toast('Safe writes off — every offset is now trusted as written', 'warning')
      }
    })

    els.limits.addEventListener('change', async event => {
      paintRow(els.limits, els.limitsState)
      await Engine.settings({ limits: event.target.checked })
      Settings.write({ limits: event.target.checked })
      if (!event.target.checked) {
        toast('Sane limits off — a 2 GB cache or an unbounded preload goes in as written', 'warning')
      }
    })

    els.interval.addEventListener('change', async () => {
      const value = Math.max(5, Math.min(120, Number(els.interval.value) || 20))
      els.interval.value = value
      Settings.write({ monitorInterval: value })
      if (window.Store.status.monitorArmed) await Engine.monitor(true, value)
    })

    Bus.on('log', event => {
      const line = el('div', { class: `log-line is-${event.level || 'info'}` }, [
        el('span', { class: 'muted', text: clockTime() }),
        el('span', { class: 'log-text', text: event.msg || '' })
      ])
      els.log.prepend(line)
      while (els.log.children.length > MAIN_LOG_LINES) els.log.lastChild.remove()
    })

    Bus.on('status', render)
    Bus.on('injecting', () => render(window.Store.status))
    Bus.on('progress', onProgress)
    Bus.on('engine-state', state => { els.engine.textContent = state })

    Multi.state().then(reply => {
      els.multi.checked = Boolean(reply?.running)
      paintRow(els.multi, els.multiState)
    })

    Bus.on('config', config => {
      els.multi.checked = Boolean(config.multiInstance)
      paintRow(els.multi, els.multiState)
      els.streamproof.checked = Boolean(config.streamproof)
      els.fuzzy.checked = Boolean(config.fuzzy)
      els.guard.checked = config.guard !== false
      els.limits.checked = config.limits !== false
      els.interval.value = config.monitorInterval || 20
      if (window.Store.status.autoAttach === undefined) {
        els.autoAttach.checked = Boolean(config.autoAttach)
      }
      if (window.Store.status.monitorArmed === undefined) {
        els.monitor.checked = Boolean(config.monitor)
      }
      paintRow(els.autoAttach, els.autoAttachState)
      paintMonitorRow(window.Store.status)
      paintRow(els.streamproof, els.streamproofState)
      paintRow(els.fuzzy, els.fuzzyState)
      paintRow(els.guard, els.guardState)
      paintRow(els.limits, els.limitsState)
    })

    showProgress(false)
    render(window.Store.status)
  }

  function onShow () {
    Fps.read().then(paintFps)
  }

  window.Views = window.Views || {}
  window.Views.dashboard = { init, onShow }
})()
