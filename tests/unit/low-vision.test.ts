import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { LOW_VISION_KEY } from '../../src/components/site/lowVision'

describe('low-vision init script', () => {
  it('takes the storage key from a server-safe module, not from a client component', () => {
    // Экспорт из 'use client'-модуля на сервере — client reference: во встроенный скрипт
    // попадал текст функции вместо ключа (SyntaxError на каждой странице).
    expect(typeof LOW_VISION_KEY).toBe('string')
    expect(readFileSync('src/components/site/lowVision.ts', 'utf8')).not.toMatch(
      /^['"]use client['"]/m,
    )
    const layout = readFileSync('src/app/(frontend)/layout.tsx', 'utf8')
    expect(layout).toMatch(/import \{ LOW_VISION_KEY \} from '@\/components\/site\/lowVision'/)
  })
})
