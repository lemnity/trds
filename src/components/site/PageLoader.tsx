'use client'

import { useEffect, useState, type CSSProperties } from 'react'

import styles from './PageLoader.module.css'

// Кольцо из 72 точек по мотивам «Colorful Dissolving Loader» (colorful/, Amit Sheen).
// Смещения детерминированы: Math.random() дал бы расхождение SSR и гидрации.
const DOTS = Array.from({ length: 72 }, (_, i) => {
  const a = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1
  const b = Math.abs(Math.sin(i * 78.233) * 12543.8731) % 1
  return {
    '--rz': `${i * 5}deg`,
    '--delay': `${((4 / 72) * i - 4).toFixed(3)}s`,
    '--tx': `${(a * 4).toFixed(2)}em`,
    '--ty': `${(b * 8 - 2.5).toFixed(2)}em`,
    '--hue': i * 5,
  } as CSSProperties
})

const FADE_MS = 500

/** Заставка до события window.load: видна только при первой загрузке документа. */
export function PageLoader() {
  const [state, setState] = useState<'visible' | 'leaving' | 'gone'>('visible')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let frame: number | undefined
    const leave = () => {
      setState('leaving')
      timer = setTimeout(() => setState('gone'), FADE_MS)
    }
    if (document.readyState === 'complete') frame = requestAnimationFrame(leave)
    else window.addEventListener('load', leave, { once: true })
    return () => {
      window.removeEventListener('load', leave)
      if (frame !== undefined) cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [])

  if (state === 'gone') return null

  return (
    <div
      className={styles.overlay}
      data-leaving={state === 'leaving' || undefined}
      role="status"
      aria-live="polite"
    >
      <span className="visually-hidden">Загружаем страницу…</span>
      <div className={styles.stage} aria-hidden="true">
        <div className={styles.ring}>
          {DOTS.map((style, i) => (
            <i key={i} style={style} />
          ))}
        </div>
        <svg className={styles.logo} viewBox="0 0 200 84">
          <defs>
            <linearGradient id="page-loader-hue" x1="0" y1="0" x2="1" y2="0">
              {[0, 60, 120, 180, 240, 300, 360].map((hue, i) => (
                <stop key={hue} offset={i / 6} stopColor={`hsl(${hue} 75% 75%)`} />
              ))}
            </linearGradient>
          </defs>
          <text x="100" y="46" textAnchor="middle" className={styles.wordmark}>
            TURDUS
          </text>
          <text x="100" y="74" textAnchor="middle" className={styles.tagline}>
            модный театр
          </text>
        </svg>
      </div>
    </div>
  )
}
