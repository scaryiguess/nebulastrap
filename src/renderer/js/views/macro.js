'use strict'

;(function () {
  const { $, el, num, toast, ask, askText, askChoice, menu, Bus } = window.UI
  const { Engine, Macros, Keys, Settings } = window.API

  const STEP_LIMIT = 400

  const VK_NAMES = {
    8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'Shift', 17: 'Ctrl', 18: 'Alt',
    19: 'Pause', 20: 'CapsLock', 27: 'Esc', 32: 'Space', 33: 'PageUp', 34: 'PageDown',
    35: 'End', 36: 'Home', 37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down',
    45: 'Insert', 46: 'Delete', 91: 'Win', 93: 'Menu',
    186: ';', 187: '=', 188: ',', 189: '-', 190: '.', 191: '/', 192: '`',
    219: '[', 220: '\\', 221: ']', 222: "'"
  }

  const ACTION_LABELS = {
    attach: 'Attach / Detach',
    inject: 'Inject flags',
    save: 'Save config',
    uninject: 'Uninject',
    flush: 'RAM Flush now',
    record: 'Start / stop recording',
    stopAll: 'Stop everything'
  }

  const els = {}
  const view = {
    rows: [],
    current: null,
    steps: [],
    playingId: null,
    selected: new Set(),
    anchor: null,
    clip: [],
    dirty: false,
    recording: false,
    playing: false,
    capturing: false
  }

  function cache () {
    Object.assign(els, {
      record: $('#macro-record'),
      recordLabel: $('#macro-record-label'),
      stop: $('#macro-stop'),
      moves: $('#macro-moves'),
      quick: $('#macro-quick'),
      hotkeys: $('#macro-hotkeys'),
      hint: $('#macro-hint'),

      list: $('#macro-list'),
      empty: $('#macro-empty'),
      count: $('#macro-count'),
      navBadge: $('#nav-macro-badge'),

      title: $('#macro-title'),
      meta: $('#macro-meta'),
      controls: $('#macro-controls'),
      repeat: $('#macro-repeat'),
      speed: $('#macro-speed'),
      hotkey: $('#macro-hotkey'),
      play: $('#macro-play'),
      rename: $('#macro-rename'),
      duplicate: $('#macro-duplicate'),
      remove: $('#macro-delete'),

      stepsHead: $('#macro-steps-head'),
      steps: $('#macro-steps'),
      add: $('#macro-add'),
      addKind: $('#macro-add-kind'),
      addAt: $('#macro-add-at'),
      addValue: $('#macro-add-value'),
      addDown: $('#macro-add-down'),
      addGo: $('#macro-add-go'),
      save: $('#macro-save')
    })
  }

  function keyName (code) {
    if (VK_NAMES[code]) return VK_NAMES[code]
    if (code >= 48 && code <= 57) return String.fromCharCode(code)
    if (code >= 65 && code <= 90) return String.fromCharCode(code)
    if (code >= 96 && code <= 105) return `Num${code - 96}`
    if (code >= 112 && code <= 123) return `F${code - 111}`
    return `VK ${code}`
  }

  function describe (step) {
    if (step.kind === 'key') {
      return { what: step.down ? 'Key down' : 'Key up', detail: keyName(step.code) }
    }
    if (step.kind === 'mouse') {
      return { what: step.down ? 'Click down' : 'Click up', detail: step.button }
    }
    if (step.kind === 'move') return { what: 'Move', detail: `${step.x}, ${step.y}` }
    if (step.kind === 'wait') return { what: 'Wait', detail: 'holds the timing, sends nothing' }
    if (step.kind === 'wheel') {
      return { what: 'Wheel', detail: step.delta > 0 ? `up ${step.delta}` : `down ${Math.abs(step.delta)}` }
    }
    return { what: step.kind || '?', detail: '' }
  }

  function humanTime (ms) {
    if (ms < 1000) return `${ms}ms`
    const seconds = ms / 1000
    if (seconds < 60) return `${seconds.toFixed(1)}s`
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  }

  function paintHint () {
    els.hint.classList.toggle('is-dirty', view.dirty)
    els.hint.classList.toggle('is-on', view.recording || view.playing)

    if (view.recording) {
      els.hint.textContent = 'Recording — every key and click is being written down. Press Stop (or your Record hotkey) when you are done.'
    } else if (view.playing) {
      els.hint.textContent = 'Playing — Stop everything halts it right now and lets go of anything it was holding down.'
    } else if (view.dirty) {
      els.hint.textContent = 'Steps edited — press Save changes or they are lost when you pick another macro.'
    } else if (view.current) {
      els.hint.textContent = 'Right-click a step to clone, copy or retime it — Ctrl+click and Shift+click take several at once.'
    } else {
      els.hint.textContent = 'Press Record, do the thing, press Stop. Nothing is sent anywhere until you play it back.'
    }

    els.recordLabel.textContent = view.recording ? 'Stop recording' : 'Record'
    els.record.classList.toggle('btn-danger', view.recording)
    els.record.classList.toggle('btn-accent', !view.recording)
    els.record.disabled = view.playing
    els.stop.disabled = !view.recording && !view.playing
    els.play.disabled = view.recording || view.playing || !view.steps.length
    els.moves.disabled = view.recording
  }

  async function refresh () {
    view.rows = await Macros.list()
    const live = view.rows.filter(row => row.active !== false).length
    els.count.textContent = `${num(live)} of ${num(view.rows.length)} active`
    els.navBadge.textContent = num(live)
    els.empty.hidden = view.rows.length > 0
    paintRows()
    applyHotkeys()
  }

  function paintRows () {
    els.list.replaceChildren(...view.rows.map(buildRow))
  }

  function buildRow (row) {
    const live = row.active !== false
    const running = view.playing && view.playingId === row.id
    return el('div', {
      class: `macro-row${row.id === view.current ? ' is-active' : ''}${live ? '' : ' is-off'}${running ? ' is-running' : ''}`,
      role: 'button',
      onclick: () => select(row.id)
    }, [
      el('span', { class: 'macro-row-name', text: row.name }),
      el('span', { class: 'macro-row-meta', text: `${num(row.count)} steps · ${humanTime(row.duration)}` }),
      row.hotkey ? el('span', { class: 'macro-row-key', text: row.hotkey }) : null,
      el('button', {
        class: `macro-row-live${live ? ' is-on' : ''}${running ? ' is-running' : ''}`,
        title: live
          ? 'Active — its hotkey is registered and it is ready to play'
          : 'Off — its hotkey is released and nothing can trigger it',
        onclick: event => {
          event.stopPropagation()
          toggleActive(row)
        }
      }, [
        el('span', { class: 'live-dot' }),
        el('span', { text: running ? 'RUNNING' : (live ? 'ACTIVE' : 'OFF') })
      ])
    ].filter(Boolean))
  }

  async function toggleActive (row) {
    const next = row.active === false
    const reply = await Macros.setActive(row.id, next)
    if (!reply.ok) {
      toast(reply.error || 'Could not change that', 'error')
      return
    }
    row.active = next
    await refresh()
    if (next) toast(`"${row.name}" is active${row.hotkey ? ` — ${row.hotkey} plays it` : ''}`, 'success')
    else toast(`"${row.name}" is off — its hotkey is released`, 'info')
  }

  async function select (id) {
    if (view.dirty && view.current && id !== view.current) {
      const keep = await ask({
        title: 'Leave without saving?',
        body: 'The steps you edited on this macro have not been saved yet.',
        confirmLabel: 'Discard the edits',
        cancelLabel: 'Stay here',
        danger: true
      })
      if (!keep) return
    }

    const reply = await Macros.read(id)
    if (!reply.ok) {
      toast(reply.error || 'Could not open that macro', 'error')
      return
    }

    view.current = id
    view.steps = reply.macro.steps
    view.dirty = false
    clearPicks()
    els.title.textContent = reply.macro.name
    els.repeat.value = reply.macro.repeat
    els.speed.value = reply.macro.speed
    els.hotkey.value = reply.macro.hotkey || ''
    els.controls.hidden = false
    els.add.hidden = false
    els.stepsHead.hidden = false
    paintSteps()
    for (const node of els.list.children) node.classList.remove('is-active')
    const index = view.rows.findIndex(row => row.id === id)
    if (index >= 0) els.list.children[index]?.classList.add('is-active')
  }

  function paintSteps () {
    els.meta.textContent = view.steps.length
      ? `${num(view.steps.length)} steps · ${humanTime(view.steps[view.steps.length - 1].t)}`
      : 'empty'

    const shown = view.steps.slice(0, STEP_LIMIT)
    els.steps.replaceChildren(...shown.map((step, index) => {
      const info = describe(step)
      return el('div', {
        class: `macro-step${view.selected.has(step) ? ' is-selected' : ''}`,
        onmousedown: event => {
          if (event.button !== 0) return
          if (event.target.closest('input, button')) return
          pick(step, event)
        },
        oncontextmenu: event => {
          if (event.target.closest('input')) return
          event.preventDefault()
          if (!view.selected.has(step)) pick(step, {})
          openStepMenu(step, event.clientX, event.clientY)
        }
      }, [
        el('span', { class: 'muted', text: String(index + 1) }),
        el('input', {
          class: 'cell-input',
          type: 'number',
          value: String(step.t),
          onchange: event => {
            step.t = Math.max(0, Math.round(Number(event.target.value) || 0))
            view.steps.sort((a, b) => a.t - b.t)
            markDirty()
            paintSteps()
          }
        }),
        el('span', { text: info.what }),
        el('span', { class: 'mono', text: info.detail }),
        el('button', {
          class: 'row-del',
          title: 'Remove this step',
          onclick: () => {
            view.selected.delete(step)
            view.steps.splice(view.steps.indexOf(step), 1)
            markDirty()
            paintSteps()
          }
        }, [el('span', { text: '✕' })])
      ])
    }))

    if (view.steps.length > STEP_LIMIT) {
      els.steps.append(el('p', {
        class: 'empty',
        text: `Showing the first ${num(STEP_LIMIT)} of ${num(view.steps.length)} steps — the rest still play.`
      }))
    }
    paintHint()
  }

  function markDirty () {
    view.dirty = true
    paintHint()
  }

  function pick (step, event) {
    const index = view.steps.indexOf(step)
    if (index < 0) return

    if (event.shiftKey && view.anchor && view.steps.includes(view.anchor)) {
      const from = view.steps.indexOf(view.anchor)
      const [start, end] = from < index ? [from, index] : [index, from]
      view.selected.clear()
      for (let at = start; at <= end; at += 1) view.selected.add(view.steps[at])
      paintSteps()
      return
    }

    if (event.ctrlKey || event.metaKey) {
      if (view.selected.has(step)) view.selected.delete(step)
      else view.selected.add(step)
    } else {
      view.selected.clear()
      view.selected.add(step)
    }
    view.anchor = step
    paintSteps()
  }

  function chosen () {
    return view.steps.filter(step => view.selected.has(step))
  }

  function clearPicks () {
    view.selected.clear()
    view.anchor = null
  }

  function landAfter (made, index) {
    view.steps.splice(index + 1, 0, ...made)
    view.steps.sort((a, b) => a.t - b.t)
    view.selected = new Set(made)
    view.anchor = made[made.length - 1]
    markDirty()
    paintSteps()
  }

  function cloneSelection (times = 1, gap = 0) {
    const picked = chosen()
    if (!picked.length) return 0
    const made = []
    for (let pass = 1; pass <= times; pass += 1) {
      for (const step of picked) made.push({ ...step, t: Math.max(0, step.t + gap * pass) })
    }
    landAfter(made, view.steps.indexOf(picked[picked.length - 1]))
    return made.length
  }

  function spanOf (steps) {
    if (steps.length < 2) return 0
    return steps[steps.length - 1].t - steps[0].t
  }

  async function cloneManyTimes () {
    const picked = chosen()
    if (!picked.length) return
    const countText = await askText({
      title: 'Duplicate a few times',
      body: `${num(picked.length)} step${picked.length === 1 ? '' : 's'} will be copied that many times over.`,
      label: 'How many copies',
      value: '5'
    })
    if (!countText) return
    const times = Math.min(500, Math.max(1, Math.round(Number(countText) || 1)))

    const suggested = spanOf(picked) || 100
    const gapText = await askText({
      title: 'How far apart?',
      body: 'Milliseconds between one copy and the next. 0 stacks them all on the same moment.',
      label: 'Gap (ms)',
      value: String(suggested)
    })
    if (gapText === null) return
    const gap = Math.max(0, Math.round(Number(gapText) || 0))

    const made = cloneSelection(times, gap)
    toast(`${num(made)} step${made === 1 ? '' : 's'} added`, 'success')
  }

  function copySelection () {
    const picked = chosen()
    if (!picked.length) return
    view.clip = picked.map(step => ({ ...step }))
    toast(`Copied ${num(view.clip.length)} step${view.clip.length === 1 ? '' : 's'}`, 'info')
  }

  function pasteAt (step) {
    if (!view.clip.length) return
    const base = step ? step.t : (view.steps.length ? view.steps[view.steps.length - 1].t : 0)
    const offset = base - view.clip[0].t
    const made = view.clip.map(entry => ({ ...entry, t: Math.max(0, entry.t + offset) }))
    const index = step ? view.steps.indexOf(step) : view.steps.length - 1
    landAfter(made, index)
    toast(`Pasted ${num(made.length)} step${made.length === 1 ? '' : 's'}`, 'success')
  }

  function flipDown () {
    const picked = chosen().filter(step => step.kind === 'key' || step.kind === 'mouse')
    if (!picked.length) return
    for (const step of picked) step.down = !step.down
    markDirty()
    paintSteps()
  }

  async function editValue (step) {
    const picked = chosen().filter(entry => entry.kind === step.kind)
    if (!picked.length) return

    if (step.kind === 'key') {
      const code = await captureKey('Press the key it should send')
      if (!code) return
      for (const entry of picked) entry.code = code
    } else if (step.kind === 'mouse') {
      const button = await askChoice({
        title: 'Which button?',
        choices: [
          { id: 'left', name: 'Left', note: '' },
          { id: 'right', name: 'Right', note: '' },
          { id: 'middle', name: 'Middle', note: '' }
        ]
      })
      if (!button) return
      for (const entry of picked) entry.button = button
    } else if (step.kind === 'move') {
      const raw = await askText({
        title: 'Move to',
        body: 'Screen position, as x,y.',
        label: 'Position',
        value: `${step.x},${step.y}`
      })
      if (!raw) return
      const parts = raw.split(/[ ,]+/).map(Number)
      if (parts.length !== 2 || parts.some(Number.isNaN)) {
        toast('Write the position as x,y', 'warning')
        return
      }
      for (const entry of picked) {
        entry.x = Math.round(parts[0])
        entry.y = Math.round(parts[1])
      }
    } else if (step.kind === 'wheel') {
      const raw = await askText({
        title: 'Wheel amount',
        body: '120 is one notch up, -120 one notch down.',
        label: 'Delta',
        value: String(step.delta)
      })
      if (!raw) return
      for (const entry of picked) entry.delta = Math.round(Number(raw) || 0)
    }

    markDirty()
    paintSteps()
  }

  async function shiftTime () {
    const picked = chosen()
    if (!picked.length) return
    const raw = await askText({
      title: 'Shift the timing',
      body: 'Milliseconds to move these steps by. A minus sign pulls them earlier.',
      label: 'Offset (ms)',
      value: '100'
    })
    if (!raw) return
    const offset = Math.round(Number(raw) || 0)
    if (!offset) return
    for (const step of picked) step.t = Math.max(0, step.t + offset)
    view.steps.sort((a, b) => a.t - b.t)
    markDirty()
    paintSteps()
  }

  function removeSelection () {
    const picked = chosen()
    if (!picked.length) return
    view.steps = view.steps.filter(step => !view.selected.has(step))
    clearPicks()
    markDirty()
    paintSteps()
    toast(`Removed ${num(picked.length)} step${picked.length === 1 ? '' : 's'}`, 'info')
  }

  async function openStepMenu (step, x, y) {
    const picked = chosen()
    const kinds = new Set(picked.map(entry => entry.kind))
    const oneKind = kinds.size === 1
    const editLabel = {
      key: 'Change the key…',
      mouse: 'Change the button…',
      move: 'Change the position…',
      wheel: 'Change the amount…'
    }[step.kind]

    const items = [
      { id: 'clone', label: picked.length > 1 ? `Duplicate these ${num(picked.length)}` : 'Duplicate', hint: 'Ctrl+D' },
      { id: 'cloneMany', label: 'Duplicate a few times…' },
      { separator: true },
      { id: 'copy', label: 'Copy', hint: 'Ctrl+C' },
      {
        id: 'paste',
        label: view.clip.length ? `Paste ${num(view.clip.length)} here` : 'Paste here',
        hint: 'Ctrl+V',
        disabled: !view.clip.length
      },
      { separator: true }
    ]

    if (oneKind && (step.kind === 'key' || step.kind === 'mouse')) {
      items.push({ id: 'flip', label: step.down ? 'Turn into a release' : 'Turn into a press' })
    }
    if (oneKind && editLabel) items.push({ id: 'edit', label: editLabel })
    items.push({ id: 'shift', label: 'Shift the timing…' })
    items.push({ separator: true })
    items.push({ id: 'remove', label: picked.length > 1 ? `Delete these ${num(picked.length)}` : 'Delete', hint: 'Del', danger: true })

    const choice = await menu({
      x,
      y,
      title: picked.length > 1 ? `${num(picked.length)} steps selected` : describe(step).what,
      items
    })

    if (choice === 'clone') {
      const made = cloneSelection(1, 0)
      toast(`${num(made)} step${made === 1 ? '' : 's'} cloned`, 'success')
    } else if (choice === 'cloneMany') await cloneManyTimes()
    else if (choice === 'copy') copySelection()
    else if (choice === 'paste') pasteAt(step)
    else if (choice === 'flip') flipDown()
    else if (choice === 'edit') await editValue(step)
    else if (choice === 'shift') await shiftTime()
    else if (choice === 'remove') removeSelection()
  }

  function onStepKey (event) {
    if (document.documentElement.dataset.view !== 'macro') return
    if (!view.current) return
    if (document.querySelector('.dialog-veil') || document.querySelector('.ctx-menu')) return
    const tag = (event.target.tagName || '').toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return

    const key = String(event.key || '').toLowerCase()
    if ((event.ctrlKey || event.metaKey) && key === 'a') {
      event.preventDefault()
      view.selected = new Set(view.steps)
      view.anchor = view.steps[view.steps.length - 1] || null
      paintSteps()
      return
    }
    if ((event.ctrlKey || event.metaKey) && key === 'd') {
      event.preventDefault()
      const made = cloneSelection(1, 0)
      if (made) toast(`${num(made)} step${made === 1 ? '' : 's'} cloned`, 'success')
      return
    }
    if ((event.ctrlKey || event.metaKey) && key === 'c') {
      event.preventDefault()
      copySelection()
      return
    }
    if ((event.ctrlKey || event.metaKey) && key === 'v') {
      event.preventDefault()
      const picked = chosen()
      pasteAt(picked[picked.length - 1] || null)
      return
    }
    if (event.key === 'Delete' && view.selected.size) {
      event.preventDefault()
      removeSelection()
      return
    }
    if (event.key === 'Escape' && view.selected.size) {
      clearPicks()
      paintSteps()
    }
  }

  async function toggleRecord () {
    if (view.playing) return

    if (!view.recording) {
      const reply = await Engine.macroRecord(true, els.moves.checked)
      if (!reply.ok) {
        toast(reply.error || 'Could not start recording', 'error')
        return
      }
      view.recording = true
      paintHint()
      return
    }

    const reply = await Engine.macroRecord(false)
    view.recording = false
    paintHint()
    if (!reply.ok) {
      toast(reply.error || 'Recording failed', 'error')
      return
    }
    if (!reply.count) {
      toast('Nothing was recorded', 'warning')
      return
    }

    const name = await askText({
      title: 'Name this macro',
      body: `${num(reply.count)} steps recorded, ${humanTime(reply.steps[reply.steps.length - 1].t)} long.`,
      label: 'Name',
      value: `Macro ${view.rows.length + 1}`
    })
    if (!name) return

    const saved = await Macros.write({ name, steps: reply.steps, repeat: 1, speed: 1 })
    if (!saved.ok) {
      toast(saved.error || 'Could not save it', 'error')
      return
    }
    await refresh()
    await select(saved.id)
    toast(`Saved "${name}" — ${num(saved.count)} steps`, 'success')
  }

  async function play () {
    if (!view.steps.length) return
    const repeat = Math.max(0, Math.round(Number(els.repeat.value) || 1))
    const speed = Math.min(10, Math.max(0.1, Number(els.speed.value) || 1))

    const reply = await Engine.macroPlay(view.steps, repeat, speed)
    if (!reply.ok) {
      toast(reply.error || 'Could not play that', 'error')
      return
    }
    view.playing = true
    view.playingId = view.current
    paintHint()
    paintRows()
    toast(repeat === 0
      ? 'Playing on a loop — Stop everything ends it'
      : `Playing ${num(repeat)}x`, 'info')
  }

  async function stopAll () {
    await Engine.macroStop()
    view.recording = false
    view.playing = false
    view.playingId = null
    paintHint()
    paintRows()
  }

  async function saveChanges () {
    if (!view.current) return
    const row = view.rows.find(entry => entry.id === view.current)
    const saved = await Macros.write({
      id: view.current,
      name: row?.name || view.current,
      steps: view.steps,
      repeat: Math.max(0, Math.round(Number(els.repeat.value) || 1)),
      speed: Math.min(10, Math.max(0.1, Number(els.speed.value) || 1)),
      hotkey: els.hotkey.value,
      active: row?.active !== false
    })
    if (!saved.ok) {
      toast(saved.error || 'Could not save', 'error')
      return
    }
    view.dirty = false
    await refresh()
    paintHint()
    toast(`Saved — ${num(saved.count)} steps`, 'success')
  }

  function addStep () {
    const kind = els.addKind.value
    const at = Math.max(0, Math.round(Number(els.addAt.value) || 0))
    const raw = els.addValue.value.trim()
    const down = els.addDown.checked
    let step = null

    if (kind === 'key') {
      const code = Number(els.addValue.dataset.code || 0)
      if (!code) {
        toast('Click the value box and press the key you want', 'warning')
        return
      }
      step = { t: at, kind: 'key', code, down }
    } else if (kind === 'mouse') {
      const button = raw.toLowerCase() || 'left'
      if (!['left', 'right', 'middle', 'x1', 'x2'].includes(button)) {
        toast('Use left, right, middle, x1 or x2', 'warning')
        return
      }
      step = { t: at, kind: 'mouse', button, down }
    } else if (kind === 'move') {
      const parts = raw.split(/[ ,]+/).map(Number)
      if (parts.length !== 2 || parts.some(Number.isNaN)) {
        toast('Write the position as x,y — or leave it blank to use the cursor', 'warning')
        return
      }
      step = { t: at, kind: 'move', x: parts[0], y: parts[1] }
    } else if (kind === 'wheel') {
      const delta = Number(raw) || 120
      step = { t: at, kind: 'wheel', delta }
    } else if (kind === 'wait') {
      step = { t: at, kind: 'wait' }
    }

    if (!step) return
    view.steps.push(step)
    view.steps.sort((a, b) => a.t - b.t)
    markDirty()
    paintSteps()
  }

  async function quickClicker () {
    const button = await askChoice({
      title: 'Auto-clicker',
      body: 'Builds a one-step macro that repeats forever until you stop it.',
      choices: [
        { id: 'left', name: 'Left click', note: 'the usual one' },
        { id: 'right', name: 'Right click', note: '' },
        { id: 'key', name: 'A keyboard key', note: 'you pick it next' }
      ]
    })
    if (!button) return

    const intervalText = await askText({
      title: 'How fast?',
      body: 'Milliseconds between each press. 100 is ten a second; below 20 is faster than most games read.',
      label: 'Interval (ms)',
      value: '100'
    })
    if (!intervalText) return
    const interval = Math.max(5, Math.round(Number(intervalText) || 100))

    let steps
    if (button === 'key') {
      const code = await captureKey('Press the key it should spam')
      if (!code) return
      steps = [
        { t: 0, kind: 'key', code, down: true },
        { t: Math.max(1, Math.round(interval / 2)), kind: 'key', code, down: false }
      ]
    } else {
      steps = [
        { t: 0, kind: 'mouse', button, down: true },
        { t: Math.max(1, Math.round(interval / 2)), kind: 'mouse', button, down: false }
      ]
    }
    steps.push({ t: interval, kind: 'wait' })

    const name = await askText({
      title: 'Name this auto-clicker',
      label: 'Name',
      value: button === 'key' ? 'Key spam' : `${button} auto-click`
    })
    if (!name) return

    const saved = await Macros.write({ name, steps, repeat: 0, speed: 1 })
    if (!saved.ok) {
      toast(saved.error || 'Could not save it', 'error')
      return
    }
    await refresh()
    await select(saved.id)
    toast(`"${name}" ready — press Play, it loops until you stop it`, 'success')
  }

  function captureKey (title) {
    return new Promise(resolve => {
      const done = event => {
        event.preventDefault()
        window.removeEventListener('keydown', done, true)
        toast('Key captured', 'info')
        resolve(event.keyCode || 0)
      }
      toast(title, 'info')
      window.addEventListener('keydown', done, true)
    })
  }

  function accelFor (event) {
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

  function bindHotkeyBox (input, onSet) {
    input.addEventListener('keydown', event => {
      event.preventDefault()
      if (event.key === 'Backspace' || event.key === 'Delete') {
        input.value = ''
        onSet('')
        return
      }
      const accelerator = accelFor(event)
      if (!accelerator) return
      input.value = accelerator
      onSet(accelerator)
    })
  }

  function applyHotkeys () {
    const macroKeys = {}
    for (const row of view.rows) {
      if (row.hotkey && row.active !== false) macroKeys[row.id] = row.hotkey
    }
    const bindings = window.Store.config?.hotkeys || {}
    Keys.apply(bindings, macroKeys).then(reply => {
      if (reply?.failed?.length) {
        toast(`Windows would not give us ${reply.failed.join(', ')} — something else owns it`, 'warning')
      }
    })
  }

  async function editHotkeys () {
    const config = window.Store.config?.hotkeys || {}
    const rows = Object.entries(ACTION_LABELS).map(([action, label]) => ({
      action, label, value: config[action] || ''
    }))
    const result = await window.UI.askHotkeys({ title: 'App hotkeys', rows })
    if (!result) return
    await Settings.write({ hotkeys: result })
    window.Store.setConfig({ ...(window.Store.config || {}), hotkeys: result })
    applyHotkeys()
    toast('Hotkeys saved', 'success')
  }

  async function onHotkey (payload) {
    if (payload.kind === 'macro') {
      const row = view.rows.find(entry => entry.id === payload.id)
      if (!row) return
      if (view.playing) {
        await stopAll()
        return
      }
      const reply = await Macros.read(payload.id)
      if (!reply.ok) return
      const played = await Engine.macroPlay(reply.macro.steps, reply.macro.repeat, reply.macro.speed)
      if (played.ok) {
        view.playing = true
        view.playingId = payload.id
        paintHint()
        paintRows()
        toast(`Playing "${row.name}"`, 'info')
      }
      return
    }

    switch (payload.action) {
      case 'stopAll':
        await stopAll()
        toast('Stopped', 'info')
        break
      case 'record':
        await toggleRecord()
        break
      case 'attach':
        $('#btn-attach').click()
        break
      case 'inject':
        if (!$('#btn-inject').disabled) $('#btn-inject').click()
        break
      case 'save':
        if (!$('#ff-save').disabled) $('#ff-save').click()
        break
      case 'uninject':
        if (!$('#btn-uninject-main').disabled) $('#btn-uninject-main').click()
        break
      case 'flush':
        Bus.emit('flush-now')
        break
    }
  }

  function init () {
    cache()

    els.record.addEventListener('click', toggleRecord)
    els.stop.addEventListener('click', stopAll)
    els.play.addEventListener('click', play)
    els.save.addEventListener('click', saveChanges)
    els.addGo.addEventListener('click', addStep)
    els.quick.addEventListener('click', quickClicker)
    els.hotkeys.addEventListener('click', editHotkeys)

    els.repeat.addEventListener('change', markDirty)
    els.speed.addEventListener('change', markDirty)

    els.addValue.addEventListener('keydown', event => {
      if (els.addKind.value !== 'key') return
      event.preventDefault()
      els.addValue.dataset.code = String(event.keyCode || 0)
      els.addValue.value = keyName(event.keyCode || 0)
    })

    els.addKind.addEventListener('change', () => {
      const kind = els.addKind.value
      els.addDown.parentElement.hidden = kind !== 'key' && kind !== 'mouse'
      els.addValue.hidden = kind === 'wait'
      els.addValue.placeholder = {
        key: 'press a key',
        mouse: 'left / right / middle / x1 / x2',
        move: '500,300',
        wheel: '120 up, -120 down',
        wait: ''
      }[kind]
      els.addValue.readOnly = kind === 'key'
      els.addValue.value = ''
      delete els.addValue.dataset.code
    })

    bindHotkeyBox(els.hotkey, () => markDirty())

    els.rename.addEventListener('click', async () => {
      if (!view.current) return
      const row = view.rows.find(entry => entry.id === view.current)
      const name = await askText({ title: 'Rename macro', label: 'Name', value: row?.name || '' })
      if (!name) return
      const reply = await Macros.rename(view.current, name)
      if (!reply.ok) {
        toast(reply.error || 'Rename failed', 'error')
        return
      }
      els.title.textContent = name
      await refresh()
    })

    els.duplicate.addEventListener('click', async () => {
      if (!view.current) return
      const reply = await Macros.duplicate(view.current)
      if (!reply.ok) {
        toast(reply.error || 'Copy failed', 'error')
        return
      }
      await refresh()
      await select(reply.id)
      toast(`Copied as "${reply.name}"`, 'success')
    })

    els.remove.addEventListener('click', async () => {
      if (!view.current) return
      const row = view.rows.find(entry => entry.id === view.current)
      const agreed = await ask({
        title: `Delete "${row?.name || view.current}"?`,
        body: 'The recorded steps go with it.',
        confirmLabel: 'Delete it',
        danger: true
      })
      if (!agreed) return
      const reply = await Macros.remove(view.current)
      if (!reply.ok) {
        toast(reply.error || 'Delete failed', 'error')
        return
      }
      view.current = null
      view.steps = []
      view.dirty = false
      clearPicks()
      els.controls.hidden = true
      els.add.hidden = true
      els.stepsHead.hidden = true
      els.steps.replaceChildren()
      els.title.textContent = 'No macro selected'
      els.meta.textContent = ''
      await refresh()
    })

    document.addEventListener('keydown', onStepKey, true)

    Keys.onFired(onHotkey)

    Bus.on('macro', state => {
      view.recording = Boolean(state.recording)
      view.playing = Boolean(state.playing)
      if (!view.playing) view.playingId = null
      paintHint()
      paintRows()
    })

    Bus.on('config', () => applyHotkeys())

    refresh()
    paintHint()
  }

  function onShow () {
    refresh()
    Engine.macroState().then(state => {
      view.recording = Boolean(state.recording)
      view.playing = Boolean(state.playing)
      if (!view.playing) view.playingId = null
      paintHint()
      paintRows()
    })
  }

  window.Views = window.Views || {}
  window.Views.macro = { init, onShow }
})()
