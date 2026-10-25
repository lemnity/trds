import { closeSync, openSync, writeSync } from 'node:fs'

import { getWallet, MAX_CERTIFICATES_PER_BATCH } from '@/modules/wallet'

/**
 * Выпуск подарочных сертификатов (T-066), пока нет ролей админки (T-023):
 *
 *   pnpm -s certificates:issue amount=3000 count=20 by="Иванова" [valid-until=2027-12-31] \
 *     [comment="…"] [out=batch.csv]
 *
 * amount — номинал в рублях. В stdout — CSV `serial,code,amount_rub,valid_until`: это единственный
 * момент, когда полный номер существует (в базе — только хеш и последние 4 символа). Сохраните
 * файл в защищённом месте и не пересылайте его открытыми каналами. Payload пишет свои сообщения
 * в тот же stdout, поэтому надёжнее `out=<файл>`: CSV пишется только туда (права 0600, без перезаписи).
 */

const USAGE = `usage: pnpm certificates:issue amount=<рубли> count=<1..${MAX_CERTIFICATES_PER_BATCH}> by=<кто выпускает> [valid-until=YYYY-MM-DD] [comment=<текст>] [out=<файл.csv>]\n`

const fail = (message: string): never => {
  process.stderr.write(`${message}\n${USAGE}`)
  process.exit(1)
}

const args = new Map<string, string>()
for (const arg of process.argv.slice(2)) {
  const at = arg.indexOf('=')
  if (at <= 0) fail(`unknown argument: ${arg}`)
  args.set(arg.slice(0, at), arg.slice(at + 1))
}

const integer = (name: string) => {
  const raw = args.get(name)
  if (!raw || !/^\d+$/.test(raw)) return fail(`${name} must be a positive integer`)
  return Number(raw)
}

const rubles = integer('amount')
const count = integer('count')
const issuedBy = args.get('by')?.trim() || fail('by is required')
const comment = args.get('comment') ?? null
const rawValidUntil = args.get('valid-until')
let validUntil: Date | null = null
if (rawValidUntil) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawValidUntil)) fail('valid-until must be YYYY-MM-DD')
  // Сертификат действует до конца указанного дня по Москве.
  validUntil = new Date(`${rawValidUntil}T23:59:59.999+03:00`)
  if (Number.isNaN(validUntil.getTime())) fail('valid-until is not a date')
}
if (process.env.ACCOUNTS_STORE === 'memory')
  fail('ACCOUNTS_STORE=memory: сертификаты из отдельного процесса не попадут в память сервера')

// Файл открываем до выпуска: если он уже есть, ничего не выпускаем (иначе номера бы потерялись).
const out = args.get('out')
const fd = out ? openSync(out, 'wx', 0o600) : null

const wallet = await getWallet()
const issued = await wallet.issueCertificates({
  amountKopecks: rubles * 100,
  count,
  validUntil,
  comment,
  issuedBy,
})
const csv = [
  'serial,code,amount_rub,valid_until',
  ...issued.map(({ serial, code }) => `${serial},${code},${rubles},${rawValidUntil ?? ''}`),
].join('\n')
if (fd === null) process.stdout.write(`${csv}\n`)
else {
  writeSync(fd, `${csv}\n`)
  closeSync(fd)
}
process.stderr.write(`issued ${issued.length} certificate(s)\n`)
process.exit(0)
