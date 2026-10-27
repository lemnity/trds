import * as migration_20261025_195018_initial from './20261025_195018_initial'
import * as migration_20261027_104849_people_works_catalog from './20261027_104849_people_works_catalog'

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
]
