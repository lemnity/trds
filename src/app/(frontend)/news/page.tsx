import type { Metadata } from 'next'

import { NewsList } from '@/components/home/NewsCard'
import { PageCrumbs } from '@/components/ui/PageCrumbs'
import { news } from '@/modules/content'

import head from '../page-head.module.css'

export const metadata: Metadata = {
  alternates: { canonical: '/news' },
  title: 'Архив новостей',
  description: 'Премьеры и анонсы модного театра TURDUS.',
}

/** Архив новостей: все опубликованные анонсы театра (до CMS — из modules/content). */
export default function NewsArchivePage() {
  return (
    <div className="container">
      <header className={head.head}>
        <PageCrumbs items={[{ label: 'Главная', href: '/' }, { label: 'Архив новостей' }]} />
        <h1 className={head.title}>Архив новостей</h1>
        <p className={head.lead}>Премьеры и анонсы театра.</p>
      </header>
      <NewsList items={news} />
    </div>
  )
}
