'use strict'

;(function () {
  const { $, el, icon, num, toast, ask, askChoice, askFlags, debounce, coerce, Bus } = window.UI
  const { Engine, Files } = window.API

  const PAGE_SIZE = 150

  const els = {}
  const view = { query: '', loaded: 0, matched: 0, total: 0, editing: false, dirty: false }

  function cache () {
    Object.assign(els, {
      search: $('#ff-search'),
      add: $('#ff-add'),
      edit: $('#ff-edit'),
      export: $('#ff-export'),
      clear: $('#ff-clear'),
      save: $('#ff-save'),
      live: $('#ff-live'),
      table: $('#ff-table'),
      rows: $('#ff-rows'),
      count: $('#ff-count'),
      more: $('#ff-more'),
      navBadge: $('#nav-flag-count')
    })
  }

  async function fetchPage (offset) {
    const reply = await Engine.page(view.query, offset, PAGE_SIZE)
    return reply.ok ? reply : { rows: [], total: 0, matched: 0 }
  }

  async function refresh () {
    const page = await fetchPage(0)
    view.total = page.total
    view.matched = page.matched
    view.loaded = page.rows.length
    els.rows.replaceChildren(...page.rows.map(buildRow))
    paint()
  }

  async function loadMore () {
    const page = await fetchPage(view.loaded)
    view.loaded += page.rows.length
    els.rows.append(...page.rows.map(buildRow))
    paint()
  }

  function paint () {
    const label = view.query
      ? `${num(view.matched)} of ${num(view.total)} flags match`
      : `${num(view.total)} flags`
    els.count.textContent = label
    els.more.hidden = view.loaded >= view.matched
    els.navBadge.textContent = num(view.total)
  }

  function paintLive (status) {
    const armed = Boolean(status.monitorArmed)
    const on = armed && Boolean(status.connected)
    els.live.classList.toggle('is-on', on && !view.dirty)
    els.live.classList.toggle('is-dirty', armed && view.dirty)

    if (!armed) {
      els.live.textContent = 'Live Monitor is off — turn it on from Main, then Save config writes the list into the client'
    } else if (!on) {
      els.live.textContent = 'Live Monitor is on and waiting — attach to Roblox, then Save config writes this list in'
    } else if (view.dirty) {
      els.live.textContent = 'Changes not saved yet — press Save config to write them into the client'
    } else {
      els.live.textContent = 'Live Monitor is on — saved, and it keeps rewriting anything the client resets'
    }

    els.save.disabled = !on
    els.save.classList.toggle('is-waiting', on && view.dirty)
    els.save.title = on
      ? 'Write this list into Roblox now, and take out anything you removed'
      : armed
        ? 'Attach to Roblox from the Main page — Live Monitor is already on'
        : 'Turn Live Monitor on from the Main page to use this'
  }

  function markDirty () {
    view.dirty = true
    paintLive(window.Store.status)
  }

  function buildRow (row) {
    const name = el('input', {
      class: 'cell-input cell-name',
      value: row.name,
      spellcheck: 'false',
      'data-name': row.name
    })
    const value = el('input', {
      class: 'cell-input',
      value: row.value === null || row.value === undefined ? '' : String(row.value),
      spellcheck: 'false'
    })

    const commit = async () => {
      const nextName = name.value.trim()
      const previous = name.dataset.name
      if (!nextName) {
        name.value = previous
        return
      }
      if (nextName === previous && String(value.value) === String(row.value ?? '')) return
      const reply = await Engine.setFlag(nextName, coerce(value.value), previous)
      if (!reply.ok) {
        toast(reply.error || 'Could not save that flag', 'error')
        return
      }
      name.dataset.name = nextName
      row.name = nextName
      row.value = value.value
      view.total = reply.total
      paint()
      markDirty()
      Bus.emit('flags-changed', { total: reply.total })
    }

    for (const input of [name, value]) {
      input.addEventListener('change', commit)
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') input.blur()
      })
    }

    const remove = el('button', {
      class: 'row-del',
      title: 'Remove this flag',
      onClick: async () => {
        const reply = await Engine.removeFlags([name.dataset.name])
        view.total = reply.total
        view.matched = Math.max(0, view.matched - 1)
        view.loaded = Math.max(0, view.loaded - 1)
        rowNode.remove()
        paint()
        Bus.emit('flags-changed', { total: reply.total })
      }
    }, [icon('i-win-close', '')])

    const known = row.known === null
      ? el('span', { class: 'known-tag', text: '—', title: 'Attach to check this flag against the client build' })
      : el('span', {
          class: `known-tag ${row.known ? 'is-yes' : 'is-no'}`,
          text: row.known ? 'known' : 'unknown',
          title: row.known ? 'This build has an offset for the flag' : 'No offset on this build — it will be skipped'
        })

    const rowNode = el('div', { class: 'table-row' }, [
      name,
      value,
      el('span', { class: 'kind-tag', text: row.kind }),
      known,
      remove
    ])
    return rowNode
  }

  async function commitAdd (payload) {
    if (payload.kind === 'single') {
      const reply = await Engine.setFlag(payload.name, payload.value, '')
      return reply.ok ? { ok: true, added: 1 } : { ok: false, error: reply.error }
    }

    if (payload.kind === 'text') {
      const reply = await Engine.addText(payload.text, payload.merge, payload.keep)
      if (!reply.ok) return { ok: false, error: reply.error || 'No FFlags in that text' }
      return { ok: true, added: reply.added, skipped: reply.skipped, replaced: !payload.merge }
    }

    const parsed = await Engine.parseFile(payload.path)
    if (!parsed.ok) return { ok: false, error: parsed.error || 'No FFlags in that file' }
    const reply = await Engine.replaceFlags(parsed.flags, payload.merge, payload.keep)
    if (!reply.ok) return { ok: false, error: reply.error }
    return { ok: true, added: reply.added ?? parsed.count, skipped: reply.skipped, replaced: !payload.merge }
  }

  async function addNewFlags () {
    let result = null
    try {
      result = await askFlags({
        title: 'Add flags',
        suggest: (query, limit) => Engine.suggest(query, limit),
        parseText: text => Engine.parseText(text),
        pickFile: () => Files.importDialog(),
        parseFile: path => Engine.parseFile(path),
        onAdd: commitAdd
      })
    } catch (error) {
      toast(`Add New broke: ${error.message}`, 'error')
      return
    }

    if (!result?.added) return

    els.search.value = ''
    view.query = ''
    await refresh()
    markDirty()
    Bus.emit('flags-changed', { total: view.total })
    toast(window.Store.status.monitoring
      ? `${num(result.added)} flag${result.added === 1 ? '' : 's'} added — press Save config to put them in the client`
      : `${num(result.added)} flag${result.added === 1 ? '' : 's'} added`, 'success')
  }

  function toggleEdit () {
    view.editing = !view.editing
    els.table.classList.toggle('is-edit', view.editing)
    els.edit.classList.toggle('is-on', view.editing)
    toast(view.editing
      ? 'Edit mode — type and build columns are showing, rows are editable inline'
      : 'Edit mode off', 'info')
  }

  async function importFrom (path) {
    const reply = await Engine.loadFile(path)
    if (!reply.ok) {
      toast('No FFlags found in that file', 'error')
      return
    }
    toast(`Imported ${num(reply.count)} flags`, 'success')
    await refresh()
    markDirty()
    Bus.emit('flags-changed', { total: reply.count })
  }

  async function exportFile () {
    const all = await Engine.allFlags()
    if (!all.ok || !all.total) {
      toast('Nothing to export', 'warning')
      return
    }

    const how = await askChoice({
      title: `Export ${num(all.total)} flags`,
      body: 'Both give you the same JSON — one goes to a file, the other straight onto your clipboard.',
      choices: [
        { id: 'file', name: 'Save as a file', note: 'Pick where to put a .json you can share or re-import' },
        { id: 'clipboard', name: 'Copy to clipboard', note: 'Paste it into Discord, a text box, another injector' }
      ]
    })
    if (!how) return

    if (how === 'clipboard') {
      try {
        await navigator.clipboard.writeText(JSON.stringify(all.flags, null, 2))
        toast(`${num(all.total)} flags copied to the clipboard`, 'success')
      } catch (error) {
        toast(`Could not reach the clipboard: ${error.message}`, 'error')
      }
      return
    }

    const saved = await Files.exportDialog(all.flags, 'fflags.json')
    if (saved.ok) toast(`Exported ${num(saved.count)} flags`, 'success')
    else if (!saved.canceled) toast(saved.error || 'Export failed', 'error')
  }

  async function clearAll () {
    if (!view.total) return
    const live = window.Store.status.monitoring
    const agreed = await ask({
      title: 'Delete every flag in the list?',
      body: live
        ? `All ${num(view.total)} flags go out of the list, and Live Monitor takes every one of them back out of Roblox as well.`
        : `All ${num(view.total)} flags go out of the list. Anything already injected stays live in the client until you uninject or detach.`,
      note: 'Export first if you want them back later, or save them as a preset.',
      confirmLabel: 'Delete them all',
      danger: true
    })
    if (!agreed) return
    await Engine.clearFlags()
    await refresh()
    markDirty()
    toast(live
      ? 'Flag list cleared — press Save config to take them out of the client'
      : 'Flag list cleared', 'info')
    Bus.emit('flags-changed', { total: 0 })
  }

  async function saveConfig () {
    if (els.save.disabled) return
    document.activeElement?.blur?.()

    els.save.disabled = true
    window.Store.setInjecting(true)
    try {
      const result = await Engine.sync()
      if (!result.ok) {
        toast(result.error === 'not attached'
          ? 'Attach to Roblox first — there is nothing to save into'
          : (result.error || 'Could not save the config'), 'error')
        return
      }
      view.dirty = false
      const pulled = result.removed
        ? `, ${num(result.removed)} taken back out`
        : ''
      if (!result.total) {
        toast(`Saved — the list is empty${pulled || ', nothing left in the client'}`, 'info')
      } else {
        const rate = Math.round((result.success / result.total) * 100)
        toast(`Saved — ${num(result.success)} of ${num(result.total)} flags live in the client (${rate}%)${pulled}`,
          rate >= 90 ? 'success' : 'info')
      }
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      window.Store.setInjecting(false)
      const status = await Engine.status()
      window.Store.applyStatus(status.status || {})
    }
  }

  function init () {
    cache()

    els.search.addEventListener('input', debounce(() => {
      view.query = els.search.value.trim()
      refresh()
    }, 200))

    els.add.addEventListener('click', addNewFlags)
    els.edit.addEventListener('click', toggleEdit)
    els.save.addEventListener('click', saveConfig)
    els.export.addEventListener('click', exportFile)
    els.clear.addEventListener('click', clearAll)
    els.more.addEventListener('click', loadMore)

    Bus.on('import-path', importFrom)
    Bus.on('flags-replaced', async () => {
      await refresh()
      markDirty()
    })
    Bus.on('status', status => {
      paintLive(status)
      if (status.flags !== view.total) refresh()
    })

    paintLive(window.Store.status)
    refresh()
  }

  window.Views = window.Views || {}
  window.Views.fastflags = { init, refresh }
})()
