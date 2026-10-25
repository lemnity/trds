import { readFileSync } from 'node:fs'

import { rows, sql, withDb } from './db'
import { CERTIFICATE_COUNT, CERTIFICATES_FILE } from './env'

/**
 * Сертификаты выпускает global-setup командой `pnpm -s certificates:issue … out=<файл>` — тем же
 * путём, что и театр. CSV: `serial,code,amount_rub,valid_until`. За тестом закреплён свой класс
 * номеров (индекс по модулю), чтобы параллельные тесты не активировали один сертификат; внутри
 * класса берём первый ещё не активированный (повторный прогон на той же базе — E2E_BASE_URL).
 */
export const CERTIFICATE_SLOTS = { activation: 0, purchase: 1 } as const
const SLOT_COUNT = Object.keys(CERTIFICATE_SLOTS).length

export async function readCertificate(slot: keyof typeof CERTIFICATE_SLOTS) {
  const issued = readFileSync(CERTIFICATES_FILE, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('serial'))
    .map((l) => {
      const [serial, code, amountRub] = l.split(',')
      return { serial: serial!, code: code!, amountKopecks: Number(amountRub) * 100 }
    })
  if (issued.length !== CERTIFICATE_COUNT)
    throw new Error(`ожидалось ${CERTIFICATE_COUNT} сертификатов`)
  // Серийный номер «С-000007» — порядковый номер в базе (serial).
  const used = await withDb((db) =>
    rows<{ serial: number }>(
      db,
      sql`select serial from wallet_certificates where status <> 'issued'`,
    ),
  )
  const usedSerials = new Set(used.map((r) => Number(r.serial)))
  const free = issued.find(
    (c, i) =>
      i % SLOT_COUNT === CERTIFICATE_SLOTS[slot] &&
      !usedSerials.has(Number(c.serial.replace(/\D/g, ''))),
  )
  if (!free)
    throw new Error(`свободных сертификатов для «${slot}» не осталось — перезапустите setup`)
  return free
}
