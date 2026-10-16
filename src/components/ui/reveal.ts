import type { CSSProperties } from 'react'

/**
 * Пропсы для появления при прокрутке (RevealOnScroll): `{...reveal(i)}` на элементе.
 * `i` — место в лесенке (задержка 70 мс на шаг, не больше 8 шагов).
 */
export const reveal = (i = 0) => ({
  'data-reveal': '',
  style: { '--reveal-i': i } as CSSProperties,
})
