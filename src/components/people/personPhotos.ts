import type { StaticImageData } from 'next/image'

import artemAksenov from '@/assets/people/artem-aksenov.jpg'
import larisaVavilova from '@/assets/people/larisa-vavilova.jpg'
import marinaShuranova from '@/assets/people/marina-shuranova.jpg'

/**
 * Портреты людей театра — только подписанные снимки с teatrturdus.ru/theatre-school
 * (кадрированы по лицу). Остальным — инициалы, пока театр не передаст фото.
 */
export const personPhotos: Record<string, StaticImageData> = {
  'artem-aksenov': artemAksenov,
  'larisa-vavilova': larisaVavilova,
  'marina-shuranova': marinaShuranova,
}
