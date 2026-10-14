import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Театр «Турдус»',
  // Превью на GitHub Pages не должно индексироваться вместо сайта театра.
  ...(process.env.PAGES_EXPORT === '1' && { robots: { index: false, follow: false } }),
}

export default function FrontendLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <main>{children}</main>
      </body>
    </html>
  )
}
