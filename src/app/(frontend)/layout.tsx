import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { CookieConsent } from '@/components/site/CookieConsent'
import { LOW_VISION_KEY } from '@/components/site/lowVision'
import { PageLoader } from '@/components/site/PageLoader'
import { RevealOnScroll } from '@/components/site/RevealOnScroll'
import { ScrollBuyButton } from '@/components/site/ScrollBuyButton'
import { SiteChrome } from '@/components/site/SiteChrome'
import { SiteFooter } from '@/components/site/SiteFooter'
import { SiteHeader } from '@/components/site/SiteHeader'

import { SITE_URL } from '@/lib/site'
import { resolveSiteSeo } from '@/modules/site-data'

import { onest } from './fonts'
import { Providers } from './providers'
import { getSiteContent } from './site-data'
import './globals.css'

/**
 * SEO по умолчанию (T-022): заголовок, описание и картинка для ссылок — из «Настроек сайта» в CMS,
 * незаполненное — из демо-значений (`@/modules/site-data`). Страницы переопределяют своё.
 */
export async function generateMetadata(): Promise<Metadata> {
  // Сбой CMS не должен ронять метаданные всех страниц: тогда — значения по умолчанию.
  const seo = resolveSiteSeo(
    await getSiteContent().then(
      (c) => c.seo,
      () => null,
    ),
  )
  return {
    metadataBase: new URL(SITE_URL),
    openGraph: {
      siteName: 'Модный театр TURDUS',
      locale: 'ru_RU',
      type: 'website',
      // Файла opengraph-image в сегменте нет намеренно: он перекрыл бы картинку из CMS.
      images: [{ url: seo.imageUrl }],
    },
    title: { default: seo.title, template: '%s — TURDUS' },
    description: seo.description,
    // Превью на GitHub Pages не должно индексироваться вместо сайта театра.
    ...(process.env.PAGES_EXPORT === '1' && { robots: { index: false, follow: false } }),
  }
}

export default function FrontendLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: data-low-vision ставит скрипт ниже до гидрации.
    <html lang="ru" className={onest.variable} suppressHydrationWarning>
      <head>
        {/* Версия для слабовидящих включается до первой отрисовки — без мигания. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('${LOW_VISION_KEY}')==='1')document.documentElement.dataset.lowVision='1'}catch(e){}`,
          }}
        />
      </head>
      <body>
        <PageLoader />
        <a className="skip-link" href="#main">
          К содержанию
        </a>
        <Providers>
          <SiteChrome header={<SiteHeader />} footer={<SiteFooter />} extras={<ScrollBuyButton />}>
            {children}
          </SiteChrome>
          <RevealOnScroll />
          <CookieConsent />
        </Providers>
      </body>
    </html>
  )
}
