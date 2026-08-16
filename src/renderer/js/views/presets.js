'use strict'

;(function () {
  const { $, el, icon, num, toast, askText, Bus } = window.UI
  const { Engine, Presets, Files } = window.API

  const els = {}

  function cache () {
    Object.assign(els, {
      name: $('#preset-name'),
      save: $('#preset-save'),
      importer: $('#preset-import'),
      grid: $('#preset-grid'),
      empty: $('#preset-empty')
    })
  }

  function whenSaved (timestamp) {
    if (!timestamp) return 'never saved'
    const minutes = Math.round((Date.now() - timestamp) / 60000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes} min ago`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours} h ago`
    return new Date(timestamp).toLocaleDateString()
  }

  async function applyPreset (preset, merge) {
    const loaded = await Presets.read(preset.id)
    if (!loaded.ok) {
      toast(loaded.error || 'Could not read that preset', 'error')
      return
    }
    const reply = await Engine.replaceFlags(loaded.preset.flags, merge)
    if (!reply.ok) {
      toast(reply.error || 'Could not load the preset', 'error')
      return
    }
    toast(`${merge ? 'Merged' : 'Loaded'} ${preset.name} — ${num(reply.total)} flags`, 'success')
    Bus.emit('flags-replaced')
  }

  async function deletePreset (preset, card) {
    const reply = await Presets.remove(preset.id)
    if (!reply.ok) {
      toast(reply.error || 'Could not delete that preset', 'error')
      return
    }
    card.remove()
    toast(`Deleted ${preset.name}`, 'info')
    if (!els.grid.children.length) els.empty.hidden = false
  }

  async function renamePreset (preset) {
    const wanted = await askText({
      title: 'Rename this preset',
      body: `It is called ${preset.name} right now. The flags inside it do not change.`,
      label: 'Name',
      value: preset.name,
      placeholder: 'Low ping, FPS boost, my mix…',
      confirmLabel: 'Rename'
    })
    if (!wanted || wanted === preset.name) return

    const reply = await Presets.rename(preset.id, wanted)
    if (!reply.ok) {
      toast(reply.error || 'Could not rename that preset', 'error')
      return
    }
    toast(`Renamed to ${wanted}`, 'success')
    refresh()
  }

  async function duplicatePreset (preset) {
    const wanted = await askText({
      title: 'Save a copy',
      body: preset.locked
        ? `${preset.name} is built in, so it cannot be renamed — a copy is yours to name and edit.`
        : 'The copy holds the same flags and is completely separate from the original.',
      label: 'Name for the copy',
      value: `${preset.name} copy`,
      confirmLabel: 'Save copy'
    })
    if (!wanted) return

    const reply = await Presets.duplicate(preset.id, wanted)
    if (!reply.ok) {
      toast(reply.error || 'Could not copy that preset', 'error')
      return
    }
    toast(`Saved ${wanted} — ${num(reply.count)} flags`, 'success')
    refresh()
  }

  async function exportPreset (preset) {
    const loaded = await Presets.read(preset.id)
    if (!loaded.ok) {
      toast(loaded.error || 'Could not read that preset', 'error')
      return
    }
    const reply = await Files.exportDialog(loaded.preset.flags, `${preset.name}.json`)
    if (reply.canceled) return
    if (!reply.ok) {
      toast(reply.error || 'Could not write that file', 'error')
      return
    }
    toast(`Exported ${preset.name} — ${num(reply.count)} flags`, 'success')
  }

  function buildCard (preset) {
    const card = el('article', {
      class: `preset-card${preset.locked ? ' is-locked' : ''}${preset.danger ? ' is-danger' : ''}`
    })

    const heading = el('div', { class: 'preset-head' }, [
      el('p', { class: 'preset-name', text: preset.name })
    ])
    if (preset.danger) {
      heading.append(el('span', { class: 'preset-badge badge-danger', title: 'Unvetted flags — this set is known to crash clients' }, [
        icon('i-warn', 'preset-badge-icon'), el('span', { text: 'RISKY' })
      ]))
    }
    if (preset.locked) {
      heading.append(el('span', { class: 'preset-badge badge-lock', title: 'Built into the app — cannot be deleted' }, [
        icon('i-lock', 'preset-badge-icon'), el('span', { text: 'BUILT-IN' })
      ]))
    }

    const actions = [
      el('button', { class: 'btn btn-accent btn-sm', text: 'Load', onClick: () => applyPreset(preset, false) }),
      el('button', { class: 'btn btn-sm', text: 'Merge', title: 'Add these flags to the current list', onClick: () => applyPreset(preset, true) }),
      el('button', { class: 'btn btn-sm', text: 'Export', title: 'Write this preset out as a .json file', onClick: () => exportPreset(preset) }),
      el('button', { class: 'btn btn-sm', text: 'Copy', title: 'Save these flags as a second preset under a new name', onClick: () => duplicatePreset(preset) })
    ]
    if (!preset.locked) {
      actions.splice(3, 0, el('button', {
        class: 'btn btn-sm',
        text: 'Rename',
        title: 'Give this preset a different name',
        onClick: () => renamePreset(preset)
      }))
      actions.push(el('button', { class: 'btn btn-danger-ghost btn-sm', text: 'Delete', onClick: () => deletePreset(preset, card) }))
    }

    card.append(
      heading,
      el('p', { class: 'preset-meta', text: preset.locked
        ? `${num(preset.count)} flags · ${preset.note}`
        : `${num(preset.count)} flags · ${whenSaved(preset.updated)}` }),
      el('div', { class: 'preset-actions' }, actions)
    )
    return card
  }

  async function refresh () {
    const list = await Presets.list()
    els.grid.replaceChildren(...list.map(buildCard))
    els.empty.hidden = list.length > 0
  }

  async function saveCurrent () {
    const all = await Engine.allFlags()
    if (!all.ok || !all.total) {
      toast('No flags to save — load some first', 'warning')
      return
    }
    let name = els.name.value.trim()
    if (!name) {
      name = await askText({
        title: 'Name this preset',
        body: `${num(all.total)} flags are going in. The name is what you will see on the card.`,
        label: 'Name',
        placeholder: 'Low ping, FPS boost, my mix…',
        confirmLabel: 'Save preset'
      })
      if (!name) return
    }

    const reply = await Presets.write({ name, flags: all.flags })
    if (!reply.ok) {
      toast(reply.error || 'Could not save the preset', 'error')
      return
    }
    els.name.value = ''
    toast(`Saved ${name} — ${num(reply.count)} flags`, 'success')
    refresh()
  }

  async function importPreset () {
    const path = await Files.importDialog()
    if (!path) return

    const parsed = await Engine.parseFile(path)
    if (!parsed.ok) {
      toast(parsed.error || 'No FFlags in that file', 'error')
      return
    }
    const fileName = path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '')
    const name = els.name.value.trim() || fileName || 'Imported preset'
    const reply = await Presets.write({ name, flags: parsed.flags })
    if (!reply.ok) {
      toast(reply.error || 'Could not save that preset', 'error')
      return
    }
    els.name.value = ''
    toast(`Imported ${name} — ${num(reply.count)} flags`, 'success')
    refresh()
  }

  function init () {
    cache()
    els.save.addEventListener('click', saveCurrent)
    els.importer.addEventListener('click', importPreset)
    els.name.addEventListener('keydown', event => {
      if (event.key === 'Enter') saveCurrent()
    })
    refresh()
  }

  window.Views = window.Views || {}
  window.Views.presets = { init, refresh }
})()
