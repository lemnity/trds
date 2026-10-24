import type { StaticImageData } from 'next/image'

import aleksandrBorisov from '@/assets/people/aleksandr-borisov.jpg'
import aleksandraProtasova from '@/assets/people/aleksandra-protasova.jpg'
import alekseyPinigin from '@/assets/people/aleksey-pinigin.jpg'
import annaSlepykh from '@/assets/people/anna-slepykh.jpg'
import artemAksenov from '@/assets/people/artem-aksenov.jpg'
import irinaPavlova from '@/assets/people/irina-pavlova.jpg'
import larisaVavilova from '@/assets/people/larisa-vavilova.jpg'
import marinaShuranova from '@/assets/people/marina-shuranova.jpg'
import mariyaVikulina from '@/assets/people/mariya-vikulina.jpg'
import nataliyaKuznetsova from '@/assets/people/nataliya-kuznetsova.jpg'
import nikitaDidkovskiy from '@/assets/people/nikita-didkovskiy.jpg'

/**
 * Портреты людей театра, 3:4 (600×800), кадрированы по лицу. Источники: фотосессия, переданная
 * театром 24.10.2026 (файлы по именам), и подписанные снимки с teatrturdus.ru/theatre-school
 * (Вавилова, Шуранова). Остальным — инициалы, пока театр не передаст фото.
 */
export const personPhotos: Record<string, StaticImageData> = {
  'aleksandr-borisov': aleksandrBorisov,
  'aleksandra-protasova': aleksandraProtasova,
  'aleksey-pinigin': alekseyPinigin,
  'anna-slepykh': annaSlepykh,
  'artem-aksenov': artemAksenov,
  'irina-pavlova': irinaPavlova,
  'larisa-vavilova': larisaVavilova,
  'marina-shuranova': marinaShuranova,
  'mariya-vikulina': mariyaVikulina,
  'nataliya-kuznetsova': nataliyaKuznetsova,
  'nikita-didkovskiy': nikitaDidkovskiy,
}
