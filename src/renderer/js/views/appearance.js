'use strict'

;(function () {
  const { $, $$, el, Bus } = window.UI
  const { Settings } = window.API

  const els = {}
  let current = { ...window.Theme.DEFAULTS }

  function cache () {
    Object.assign(els, {
      swatches: $('#accent-swatches'),
      accent: $('#ap-accent'),
      accentAlt: $('#ap-accent-alt'),
      base: $('#ap-base'),
      glow: $('#ap-glow'),
      radius: $('#ap-radius'),
      density: $('#ap-density'),
      motion: $('#ap-motion'),
      ambient: $('#ap-ambient'),
      snow: $('#ap-snow'),
      reset: $('#ap-reset')
    })
  }

  function change (patch, { persist = true } = {}) {
    current = window.Theme.apply({ ...current, ...patch })
    reflect()
    if (persist) Settings.write({ appearance: current })
  }

  function reflect () {
    els.accent.value = current.accent
    els.accentAlt.value = current.accentAlt
    els.base.value = current.base
    els.glow.value = current.glow
    els.radius.value = current.radius
    els.density.value = current.density
    els.motion.checked = current.motion
    els.ambient.checked = current.ambient
    els.snow.checked = current.snow

    $$('.swatch', els.swatches).forEach(swatch => {
      swatch.classList.toggle('is-on', swatch.dataset.accent === current.accent)
    })
  }

  function buildSwatches () {
    els.swatches.replaceChildren(...window.Theme.PRESETS.map(preset => el('button', {
      class: 'swatch',
      title: preset.name,
      dataset: { accent: preset.accent },
      style: `background: linear-gradient(140deg, ${preset.accent}, ${preset.accentAlt})`,
      onClick: () => change({ accent: preset.accent, accentAlt: preset.accentAlt })
    })))
  }

  function init () {
    cache()
    buildSwatches()

    els.accent.addEventListener('input', event => change({ accent: event.target.value }))
    els.accentAlt.addEventListener('input', event => change({ accentAlt: event.target.value }))
    els.base.addEventListener('change', event => change({ base: event.target.value }))
    els.glow.addEventListener('input', event => change({ glow: Number(event.target.value) }))
    els.radius.addEventListener('input', event => change({ radius: Number(event.target.value) }))
    els.density.addEventListener('change', event => change({ density: event.target.value }))
    els.motion.addEventListener('change', event => change({ motion: event.target.checked }))
    els.ambient.addEventListener('change', event => change({ ambient: event.target.checked }))
    els.snow.addEventListener('change', event => change({ snow: event.target.checked }))
    els.reset.addEventListener('click', () => change({ ...window.Theme.DEFAULTS }))

    Bus.on('config', config => {
      current = { ...window.Theme.DEFAULTS, ...(config.appearance || {}) }
      window.Theme.apply(current)
      reflect()
    })

    reflect()
  }

  window.Views = window.Views || {}
  window.Views.appearance = { init }
})()
