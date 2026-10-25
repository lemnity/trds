import * as migration_20261025_185548_initial from './20261025_185548_initial'

export const migrations = [
  {
    up: migration_20261025_185548_initial.up,
    down: migration_20261025_185548_initial.down,
    name: '20261025_185548_initial',
  },
]
