import type { Metadata } from 'next'

import { RolesLab } from '@/components/lab/RolesLab'
import { getPersonProfile } from '@/modules/people'
import { getShowsData } from '@/modules/shows'

export const metadata: Metadata = {
  title: 'Превью блока «Роли в спектаклях»',
  robots: { index: false, follow: false },
}

/** Три варианта блока «Роли в спектаклях» на живых данных (выбор заказчика). Не в меню. */
export default function RolesLabPage() {
  const profile = getPersonProfile(getShowsData(), 'tatyana-usova', new Date())
  if (!profile) return null
  return (
    <div className="container">
      <RolesLab name={profile.person.name} shows={profile.shows} archive={profile.archive} />
    </div>
  )
}
