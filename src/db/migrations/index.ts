import * as migration_20261025_195018_initial from './20261025_195018_initial'

export const migrations = [
  {
    up: migration_20261025_195018_initial.up,
    down: migration_20261025_195018_initial.down,
    name: '20261025_195018_initial',
  },
]
