import type { MetadataRoute } from 'next'

import { IS_PREVIEW, SITE_URL } from '@/lib/site'

export const dynamic = 'force-static'

/** Превью закрыто целиком; на сайте — закрыты кабинет, оформление заказа, вход и админка. */
export default function robots(): MetadataRoute.Robots {
  if (IS_PREVIEW) return { rules: { userAgent: '*', disallow: '/' } }
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api', '/account', '/checkout', '/login', '/register'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
