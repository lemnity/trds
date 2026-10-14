import { Onest } from 'next/font/google'

// Onest — гротеск с полноценной кириллицей, близкий к утверждённому визуальному референсу.
// next/font хостит файлы локально (без запросов к Google из браузера).
export const onest = Onest({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-onest',
  display: 'swap',
})
