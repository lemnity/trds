'use client'

import { useEffect } from 'react'

/** После какой прокрутки шапка становится компактной. */
const COMPACT_AFTER_PX = 24

/**
 * Ставит `data-scrolled` на <html>, когда страницу начали прокручивать, — по нему шапка
 * плавно уменьшается (SiteHeader.module.css). Ничего не рисует.
 */
export function HeaderScrollState() {
  useEffect(() => {
    const root = document.documentElement
    const update = () => {
      if (window.scrollY > COMPACT_AFTER_PX) root.dataset.scrolled = '1'
      else delete root.dataset.scrolled
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => {
      window.removeEventListener('scroll', update)
      delete root.dataset.scrolled
    }
  }, [])
  return null
}
