import type {
  Document as CmsDocument,
  Media as CmsMedia,
  News as CmsNews,
  Page as CmsPage,
  Partner as CmsPartner,
  Person as CmsPerson,
  Review as CmsReview,
  SiteSetting as CmsSettings,
} from '@/payload-types'

import { imageOf, mediaUrl, paragraphs } from '../shows/cms'

import type {
  AboutPage,
  Contacts,
  CorporatePage,
  Leader,
  LegalDocument,
  NewsItem,
  Partner,
  PersonBio,
  Portrait,
  Review,
  SiteContent,
  SiteSeo,
} from './index'

/**
 * Документы Payload → редакционный read model (те же типы, что у демо-набора). Чистые функции;
 * запросы — в @/modules/site-data. Чего в CMS нет (страница не создана, настройки пусты) —
 * берётся из демо-набора `fallback`, чтобы сайт не терял блоки при частичном наполнении.
 */

export type CmsContentDocs = {
  news: CmsNews[]
  reviews: CmsReview[]
  partners: CmsPartner[]
  documents: CmsDocument[]
  people: CmsPerson[]
  pages: CmsPage[]
  settings: CmsSettings | null
}

export const newsFromCms = (doc: CmsNews): NewsItem | null => {
  const imageUrl = imageOf(doc.cover, doc.coverUrl)
  if (!doc.slug || !imageUrl) return null
  return {
    id: doc.slug,
    tag: doc.tag,
    title: doc.title,
    summary: doc.summary,
    href: doc.href,
    imageUrl,
  }
}

export const reviewFromCms = (doc: CmsReview): Review => ({
  id: doc.slug ?? String(doc.id),
  quote: doc.quote,
  lead: doc.lead,
  author: doc.author,
  role: doc.role,
})

export const partnerFromCms = (doc: CmsPartner): Partner => ({ name: doc.name, role: doc.role })

export const documentFromCms = (doc: CmsDocument): LegalDocument | null => {
  if (!doc.slug) return null
  const body = paragraphs(doc.body)
  return { slug: doc.slug, title: doc.title, ...(body.length && { paragraphs: body }) }
}

export const portraitOf = (media: number | CmsMedia | null | undefined): Portrait | null => {
  const m = media && typeof media === 'object' ? media : null
  return m?.url && m.width && m.height ? { src: m.url, width: m.width, height: m.height } : null
}

export const bioFromCms = (doc: CmsPerson): PersonBio | null => {
  const body = paragraphs(doc.bio)
  if (!body.length) return null
  const works = (doc.works ?? []).map((w) => w.title)
  return {
    title: doc.bioTitle || doc.position || '',
    paragraphs: body,
    ...(works.length && { works }),
    source: doc.source ?? '',
  }
}

export const leaderFromCms = (doc: CmsPerson): Leader => ({
  name: doc.name,
  position: doc.position ?? '',
  source: doc.source ?? '',
  ...(doc.quote?.text && { quote: { text: doc.quote.text, about: doc.quote.about ?? '' } }),
})

const sorted = <T extends { sortOrder?: number | null }>(docs: T[]) =>
  [...docs].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))

const pageBy = (pages: CmsPage[], slug: string) => pages.find((p) => p.slug === slug)

const photosOf = (page: CmsPage) =>
  (page.photos ?? []).map((p) => imageOf(p.image, p.imageUrl)).filter((u): u is string => !!u)

export const aboutFromCms = (page: CmsPage | undefined, fallback: AboutPage): AboutPage =>
  page
    ? {
        title: page.title,
        lead: page.lead ?? fallback.lead,
        paragraphs: paragraphs(page.body),
        photos: photosOf(page),
      }
    : fallback

export const corporateFromCms = (
  page: CmsPage | undefined,
  fallback: CorporatePage,
): CorporatePage =>
  page
    ? {
        ...fallback,
        title: page.title,
        slogan: page.lead ?? fallback.slogan,
        paragraphs: paragraphs(page.body),
        photos: photosOf(page),
      }
    : fallback

export const contactsFromCms = (settings: CmsSettings | null, fallback: Contacts): Contacts => {
  const c = settings?.contacts
  if (!c?.phone || !c.email) return fallback
  const digits = c.phone.replace(/\D/g, '').replace(/^8/, '7')
  return {
    phone: { display: c.phone, href: `tel:+${digits}` },
    email: c.email,
    office: {
      address: c.officeAddress,
      short: c.officeShort,
      hours: c.hours,
      mapUrl: c.mapUrl || 'https://yandex.ru/maps/?text=' + encodeURIComponent(c.officeAddress),
    },
    social: (settings?.social ?? []).map(({ name, handle, href }) => ({ name, handle, href })),
  }
}

export const seoFromCms = (settings: CmsSettings | null): SiteSeo => {
  const imageUrl = mediaUrl(settings?.seo?.image)
  return {
    ...(settings?.seo?.title && { title: settings.seo.title }),
    ...(settings?.seo?.description && { description: settings.seo.description }),
    ...(imageUrl && { imageUrl }),
  }
}

export const siteContentFromCms = (docs: CmsContentDocs, fallback: SiteContent): SiteContent => {
  const people = docs.people.filter((p) => p.slug)
  const portraits: Record<string, Portrait> = {}
  const personBios: Record<string, PersonBio> = {}
  for (const p of people) {
    const portrait = portraitOf(p.portrait)
    if (portrait) portraits[p.slug!] = portrait
    const bio = bioFromCms(p)
    if (bio) personBios[p.slug!] = bio
  }
  return {
    news: [...docs.news]
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .map(newsFromCms)
      .filter((n): n is NewsItem => n !== null),
    reviews: sorted(docs.reviews).map(reviewFromCms),
    partners: sorted(docs.partners).map(partnerFromCms),
    legalDocuments: sorted(docs.documents)
      .map(documentFromCms)
      .filter((d): d is LegalDocument => d !== null),
    contacts: contactsFromCms(docs.settings, fallback.contacts),
    aboutTheatre: aboutFromCms(pageBy(docs.pages, 'about'), fallback.aboutTheatre),
    corporate: corporateFromCms(pageBy(docs.pages, 'corporate'), fallback.corporate),
    personBios,
    leadership: sorted(people.filter((p) => p.leadership)).map(leaderFromCms),
    portraits,
    seo: seoFromCms(docs.settings),
  }
}
