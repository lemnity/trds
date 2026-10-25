import { AdminMfa, AdminMfaRecoveryCodes } from './AdminMfa'
import { AdminUsers } from './AdminUsers'
import { Archive } from './Archive'
import { Documents } from './Documents'
import { Media } from './Media'
import { News } from './News'
import { Pages } from './Pages'
import { Partners } from './Partners'
import { People } from './People'
import { Performances } from './Performances'
import { Reviews } from './Reviews'
import { Shows } from './Shows'
import { TicketTypes } from './TicketTypes'
import { Venues } from './Venues'

/** Порядок — порядок в меню админки внутри групп. */
export const collections = [
  Shows,
  Performances,
  Venues,
  Archive,
  TicketTypes,
  People,
  News,
  Reviews,
  Partners,
  Pages,
  Documents,
  Media,
  AdminUsers,
  AdminMfa,
  AdminMfaRecoveryCodes,
]
