import { demoShowsData } from './demo-data'
import type { ShowsData } from './types'

/** Единая точка получения данных афиши. После T-021 читает опубликованное из Payload. */
export const getShowsData = (): ShowsData => demoShowsData
