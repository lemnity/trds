/**
 * Детерминированное распределение суммы в копейках по весам методом наибольшего остатка (T-041).
 * Используется, чтобы разложить бонусы заказа по позициям, а позиции — по билетам: доля каждого
 * билета записывается при выпуске и потом определяет частичный возврат (architecture.md §7).
 *
 * Свойства: доли — целые неотрицательные копейки; сумма долей ровно `total`; при `total <= Σw`
 * ни одна доля не больше своего веса; одинаковый вход — одинаковый выход (лишние копейки
 * получают наибольшие остатки, при равенстве — позиции с меньшим индексом). Без float: доля
 * считается в BigInt, произведение `total × weight` не теряет точность.
 */
export const allocate = (totalKopecks: number, weights: readonly number[]): number[] => {
  if (!Number.isSafeInteger(totalKopecks) || totalKopecks < 0)
    throw new RangeError('totalKopecks must be non-negative integer kopecks')
  for (const w of weights)
    if (!Number.isSafeInteger(w) || w < 0)
      throw new RangeError('weights must be non-negative safe integers')
  if (totalKopecks === 0) return weights.map(() => 0)
  const sum = weights.reduce((acc, w) => acc + BigInt(w), 0n)
  if (sum === 0n) throw new RangeError('cannot allocate a positive total over zero weights')

  const total = BigInt(totalKopecks)
  const shares = weights.map((w) => (total * BigInt(w)) / sum)
  const remainders = weights.map((w, index) => ({ index, rest: (total * BigInt(w)) % sum }))
  let left = Number(total - shares.reduce((acc, s) => acc + s, 0n))
  remainders.sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1))
  // Остаток меньше числа позиций с ненулевым остатком — каждая получает не больше одной копейки.
  for (const { index } of remainders) {
    if (left === 0) break
    shares[index]! += 1n
    left -= 1
  }
  return shares.map(Number)
}
