'use strict'

;(function () {
  const COUNT = 22
  const SNOW_COUNT = 34

  const between = (low, high) => low + Math.random() * (high - low)

  function mote (index) {
    const span = document.createElement('span')
    span.className = 'ambient-mote'

    const size = between(2, 4.5)
    const duration = between(11, 22)

    span.style.setProperty('--lane', `${between(-2, 100)}%`)
    span.style.setProperty('--size', `${size.toFixed(1)}px`)
    span.style.setProperty('--dur', `${duration.toFixed(2)}s`)
    span.style.setProperty('--rise', `${between(46, 86).toFixed(0)}vh`)
    span.style.setProperty('--drift', `${between(-40, 40).toFixed(0)}px`)
    span.style.setProperty('--spin', `${between(-120, 120).toFixed(0)}deg`)
    span.style.setProperty('--peak', (0.14 + (size - 2) / 2.5 * 0.24).toFixed(2))
    span.style.setProperty('--delay', `${(-duration * (index / COUNT)).toFixed(2)}s`)
    return span
  }

  function flake (index) {
    const span = document.createElement('span')
    span.className = 'snowflake'

    const size = between(1.6, 4)
    const duration = between(14, 30)

    span.style.setProperty('--lane', `${between(-2, 100)}%`)
    span.style.setProperty('--size', `${size.toFixed(1)}px`)
    span.style.setProperty('--dur', `${duration.toFixed(2)}s`)
    span.style.setProperty('--sway', `${between(12, 46).toFixed(0) * (Math.random() < 0.5 ? -1 : 1)}px`)
    span.style.setProperty('--peak', (0.2 + (size - 1.6) / 2.4 * 0.4).toFixed(2))
    span.style.setProperty('--delay', `${(-duration * (index / SNOW_COUNT)).toFixed(2)}s`)
    span.style.setProperty('--resting', `${between(4, 92).toFixed(0)}vh`)
    return span
  }

  function fill (id, count, make, marker) {
    const layer = document.getElementById(id)
    if (!layer || layer.querySelector(marker)) return
    const children = []
    for (let index = 0; index < count; index += 1) children.push(make(index))
    layer.append(...children)
  }

  function build () {
    fill('ambient', COUNT, mote, '.ambient-mote')
    fill('snow', SNOW_COUNT, flake, '.snowflake')
  }

  window.Ambient = { build }
  document.addEventListener('DOMContentLoaded', build)
})()
