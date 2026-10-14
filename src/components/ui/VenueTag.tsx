import { Chip } from '@heroui/react'

import { VENUE_KIND_LABELS, type VenueKind } from '@/modules/shows'

export function VenueTag({ kind }: { kind: VenueKind }) {
  return (
    <Chip size="sm" variant="soft">
      {VENUE_KIND_LABELS[kind]}
    </Chip>
  )
}
