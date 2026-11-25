import { RichText, type JSXConvertersFunction } from '@payloadcms/richtext-lexical/react'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageCrumbs } from '@/components/ui/PageCrumbs'
import { videoEmbedUrl } from '@/modules/content'
import { getSiteContent, staticExportOnly, staticSiteContent } from '@/app/(frontend)/site-data'

import head from '../../page-head.module.css'
import styles from './article.module.css'

type Params = { slug: string }

// Статическая сборка — новости демо-набора со своим текстом (их нет); на сервере — из CMS.
export const generateStaticParams = staticExportOnly((): Params[] =>
  (staticSiteContent()?.news ?? []).filter((n) => n.body).map((n) => ({ slug: n.id })),
)

const findNews = async (slug: string) =>
  (await getSiteContent()).news.find((n) => n.id === slug && n.body)

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params
  const item = await findNews(slug)
  if (!item) notFound()
  return {
    title: item.title,
    description: item.summary,
    alternates: { canonical: `/news/${slug}` },
    openGraph: { title: item.title, description: item.summary, images: [item.imageUrl] },
  }
}

type UploadValue = { url?: string | null; mimeType?: string | null; alt?: string | null }

/** Видео из «Медиа» — плеером (стандартный вывод показал бы ссылку на файл). */
const converters: JSXConvertersFunction = ({ defaultConverters }) => ({
  ...defaultConverters,
  upload: (args) => {
    const value = args.node.value as UploadValue | number | string
    if (typeof value === 'object' && value?.url && value.mimeType?.startsWith('video/'))
      return (
        <video
          className={styles.video}
          src={value.url}
          controls
          preload="metadata"
          playsInline
          aria-label={value.alt ?? undefined}
        />
      )
    const fallback = defaultConverters.upload
    return typeof fallback === 'function' ? fallback(args) : null
  },
  blocks: {
    // Видео по ссылке: адрес плеера собирается из id (modules/content/embed), не из ввода как есть.
    videoEmbed: ({ node }: { node: { fields: { url?: string; caption?: string | null } } }) => {
      const src = node.fields.url ? videoEmbedUrl(node.fields.url) : null
      if (!src) return null
      return (
        <figure className={styles.embed}>
          <div className={styles.embedFrame}>
            <iframe
              src={src}
              title={node.fields.caption || 'Видео'}
              loading="lazy"
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
              allowFullScreen
            />
          </div>
          {node.fields.caption && <figcaption>{node.fields.caption}</figcaption>}
        </figure>
      )
    },
    button: ({ node }: { node: { fields: { label?: string; href?: string } } }) => {
      const { label, href } = node.fields
      if (!label || !href || !/^(\/[^\s]*|https:\/\/[^\s]+)$/.test(href)) return null
      return (
        <p className={styles.buttonRow}>
          {href.startsWith('/') ? (
            <Link href={href} className={styles.button}>
              {label}
            </Link>
          ) : (
            <a href={href} className={styles.button} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          )}
        </p>
      )
    },
  },
})

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Yekaterinburg',
})

/** Страница новости: обложка, метка, дата и текст из визуального редактора CMS. */
export default async function NewsPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const item = await findNews(slug)
  if (!item?.body) notFound()

  return (
    <article className="container">
      <header className={head.head}>
        <PageCrumbs
          items={[
            { label: 'Главная', href: '/' },
            { label: 'Новости', href: '/news' },
            { label: item.title },
          ]}
        />
        <p className={styles.meta}>
          <span className={styles.tag}>{item.tag}</span>
          {item.publishedAt && (
            <time dateTime={item.publishedAt}>
              {dateFormat.format(new Date(`${item.publishedAt}T12:00:00+05:00`))}
            </time>
          )}
        </p>
        <h1 className={head.title}>{item.title}</h1>
        <p className={head.lead}>{item.summary}</p>
      </header>

      <div className={styles.cover}>
        <Image src={item.imageUrl} alt="" fill sizes="(max-width: 960px) 100vw, 960px" priority />
      </div>

      <RichText
        className={styles.body}
        converters={converters}
        data={item.body as unknown as SerializedEditorState}
      />
    </article>
  )
}
