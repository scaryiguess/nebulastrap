'use strict'

const DEFAULT_APPEARANCE = {
  accent: '#00d4ff',
  accentAlt: '#7c5cff',
  base: 'obsidian',
  glow: 0.6,
  radius: 14,
  density: 'comfortable',
  motion: true,
  ambient: false,
  snow: false
}

const ACCENT_PRESETS = [
  { accent: '#00d4ff', accentAlt: '#7c5cff', name: 'Signal' },
  { accent: '#97e6ff', accentAlt: '#5728cc', name: 'Node' },
  { accent: '#8841d5', accentAlt: '#4354bf', name: 'Violet' },
  { accent: '#4ade80', accentAlt: '#22d3ee', name: 'Mint' },
  { accent: '#fbbf24', accentAlt: '#f97316', name: 'Ember' },
  { accent: '#f472b6', accentAlt: '#8b5cf6', name: 'Orchid' },
  { accent: '#e2e8f0', accentAlt: '#94a3b8', name: 'Steel' }
]

const Theme = {
  DEFAULTS: DEFAULT_APPEARANCE,
  PRESETS: ACCENT_PRESETS,

  apply (appearance = {}) {
    const values = { ...DEFAULT_APPEARANCE, ...appearance }
    const root = document.documentElement

    root.style.setProperty('--accent', values.accent)
    root.style.setProperty('--accent-alt', values.accentAlt)
    root.style.setProperty('--glow', String(values.glow))
    root.style.setProperty('--radius', `${values.radius}px`)

    root.dataset.base = values.base
    root.dataset.density = values.density
    root.dataset.motion = values.motion ? 'on' : 'off'
    root.dataset.ambient = values.ambient ? 'on' : 'off'
    root.dataset.snow = values.snow ? 'on' : 'off'
    return values
  }
}

window.Theme = Theme
