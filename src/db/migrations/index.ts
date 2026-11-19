import * as migration_20261025_195018_initial from './20261025_195018_initial'
import * as migration_20261027_104849_people_works_catalog from './20261027_104849_people_works_catalog'
import * as migration_20261114_200415_refund_claims from './20261114_200415_refund_claims'
import * as migration_20261119_063001_seat_pricing_templates from './20261119_063001_seat_pricing_templates'
import * as migration_20261119_064005_belinskogo_hall from './20261119_064005_belinskogo_hall'
import * as migration_20261119_085320_performance_title from './20261119_085320_performance_title'
import * as migration_20261119_184512_show_seats_per_performance from './20261119_184512_show_seats_per_performance'

export const migrations = [
  {
    up: migration_20261025_195018_initial.up,
    down: migration_20261025_195018_initial.down,
    name: '20261025_195018_initial',
  },
  {
    up: migration_20261027_104849_people_works_catalog.up,
    down: migration_20261027_104849_people_works_catalog.down,
    name: '20261027_104849_people_works_catalog',
  },
  {
    up: migration_20261114_200415_refund_claims.up,
    down: migration_20261114_200415_refund_claims.down,
    name: '20261114_200415_refund_claims',
  },
  {
    up: migration_20261119_063001_seat_pricing_templates.up,
    down: migration_20261119_063001_seat_pricing_templates.down,
    name: '20261119_063001_seat_pricing_templates',
  },
  {
    up: migration_20261119_064005_belinskogo_hall.up,
    down: migration_20261119_064005_belinskogo_hall.down,
    name: '20261119_064005_belinskogo_hall',
  },
  {
    up: migration_20261119_085320_performance_title.up,
    down: migration_20261119_085320_performance_title.down,
    name: '20261119_085320_performance_title',
  },
  {
    up: migration_20261119_184512_show_seats_per_performance.up,
    down: migration_20261119_184512_show_seats_per_performance.down,
    name: '20261119_184512_show_seats_per_performance',
  },
]
