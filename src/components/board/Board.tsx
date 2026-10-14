import type { PerformanceView } from '@/modules/shows'

import { BoardRow } from './BoardRow'
import { HideWhenStarted } from './HideWhenStarted'
import styles from './Board.module.css'

type Props = {
  items: PerformanceView[]
  label: string
  highlightFirst?: boolean
  showTitle?: boolean
}

export function Board({ items, label, highlightFirst = false, showTitle = true }: Props) {
  return (
    <div>
      <ol aria-label={label} className={styles.list}>
        {items.map((item, i) => (
          <HideWhenStarted key={item.id} startsAt={item.startsAt}>
            <li>
              <BoardRow item={item} highlight={highlightFirst && i === 0} showTitle={showTitle} />
            </li>
          </HideWhenStarted>
        ))}
      </ol>
    </div>
  )
}
