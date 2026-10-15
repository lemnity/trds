'use client'

import { useEffect, useState, type CSSProperties } from 'react'

import { LOGO_VIEWBOX, TAGLINE_CONTOURS, WORDMARK_CONTOURS } from './logoOutline'
import styles from './PageLoader.module.css'

const FADE_MS = 500

/**
 * Заставка до события window.load: видна только при первой загрузке документа.
 * По контурам «TURDUS» бегут штрихи (приём stroke-dasharray из triangle/, «Triangle SVG
 * loading», Willian Justen); «модный театр» — неподвижно.
 */
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
        <svg className={styles.logo} viewBox={LOGO_VIEWBOX}>
          <path className={styles.fill} fillRule="evenodd" d={WORDMARK_CONTOURS.join(' ')} />
          <g className={styles.trace}>
            {WORDMARK_CONTOURS.map((d, i) => (
              // pathLength=100 — одинаковое число штрихов на любом контуре.
              <path key={i} d={d} pathLength={100} style={{ '--i': i } as CSSProperties} />
            ))}
          </g>
          <path className={styles.tagline} fillRule="evenodd" d={TAGLINE_CONTOURS.join(' ')} />
        </svg>
        <span className={styles.label}>Загрузка</span>
      </div>
    </div>
  )
}
