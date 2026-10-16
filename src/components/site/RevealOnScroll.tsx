'use client'

import { useEffect } from 'react'

const EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)'

/**
 * Появление элементов при прокрутке: всё с атрибутом `data-reveal` проявляется и поднимается,
 * когда попадает в экран. Порядок в группе (задержка 70 мс на шаг) задаёт `--reveal-i`.
 * Атрибуты элементов не меняем (иначе React ругается на гидратацию) — до показа их прячет
 * CSS по `html[data-reveal-ready]`, показ — Web Animations API с fill: forwards.
 * Новые элементы (переходы, догрузка) подхватывает MutationObserver. Без JS контент виден;
 * при reduced motion и в версии для слабовидящих — без анимации (globals.css).
 */
export function RevealOnScroll() {
  useEffect(() => {
    const root = document.documentElement
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (still || !('IntersectionObserver' in window) || !('animate' in root)) return

    const seen = new WeakSet<Element>()
    const show = (el: HTMLElement) => {
      const step = Math.min(Number(getComputedStyle(el).getPropertyValue('--reveal-i')) || 0, 8)
      el.animate(
        [
          { opacity: 0, transform: 'translateY(1.5rem)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 700, delay: step * 70, easing: EASE, fill: 'forwards' },
      )
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          io.unobserve(entry.target)
          show(entry.target as HTMLElement)
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.01 },
    )
    const observe = (el: Element) => {
      if (seen.has(el)) return
      seen.add(el)
      io.observe(el)
    }
    const watch = (scope: ParentNode) => scope.querySelectorAll('[data-reveal]').forEach(observe)

    watch(document)
    const mo = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue
          if (node.matches('[data-reveal]')) observe(node)
          watch(node)
        }
    })
    mo.observe(document.body, { childList: true, subtree: true })
    root.setAttribute('data-reveal-ready', '')

    return () => {
      mo.disconnect()
      io.disconnect()
      root.removeAttribute('data-reveal-ready')
    }
  }, [])

  return null
}
