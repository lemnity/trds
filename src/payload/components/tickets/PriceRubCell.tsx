import { formatRub } from '@/lib/money'

/** Ячейка списка «Цена» — рубли из копеек. */
export function PriceRubCell({ cellData }: { cellData?: unknown }) {
  return <span>{Number.isSafeInteger(cellData) ? formatRub(cellData as number) : '—'}</span>
}
