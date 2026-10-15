import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PageCrumbs } from '@/components/ui/PageCrumbs'
import { cardClass } from '@/components/ui/card'
import { legalDocuments } from '@/modules/content'

import head from '../../page-head.module.css'
import styles from '../documents.module.css'

type Params = { slug: string }

export const dynamicParams = false

export function generateStaticParams(): Params[] {
  return legalDocuments.map(({ slug }) => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params
  const doc = legalDocuments.find((d) => d.slug === slug)
  return doc ? { title: doc.title, robots: { index: false, follow: true } } : {}
}

/** Документ ещё не утверждён театром — честная страница-заглушка, без выдуманного текста. */
export default async function DocumentPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const doc = legalDocuments.find((d) => d.slug === slug)
  if (!doc) notFound()

  return (
    <div className="container">
      <header className={head.head}>
        <PageCrumbs items={[{ label: 'Главная', href: '/' }, { label: doc.title }]} />
        <h1 className={head.title}>{doc.title}</h1>
      </header>
      <div className={cardClass(styles.card)} role="status">
        <p className={styles.title}>Документ готовится</p>
        <p>
          Текст появится здесь после согласования с театром. Если он нужен вам сейчас, напишите на{' '}
          <a href="mailto:rechevik@inbox.ru">rechevik@inbox.ru</a> или позвоните{' '}
          <a href="tel:+79826575426">+7 982 657-54-26</a>.
        </p>
      </div>
    </div>
  )
}
