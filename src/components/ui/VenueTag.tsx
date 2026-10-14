import { VENUE_KIND_LABELS, type VenueKind } from '@/modules/shows'

import styles from './VenueTag.module.css'

export function VenueTag({ kind }: { kind: VenueKind }) {
  return <span className={styles.tag}>{VENUE_KIND_LABELS[kind]}</span>
}
