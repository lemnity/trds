import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Статический превью публичных страниц для GitHub Pages (scripts/build-pages.sh).
// Production — standalone-сервер; Pages не умеет запускать Next.js/Payload.
const pagesExport = process.env.PAGES_EXPORT === '1'

const basePath = pagesExport ? (process.env.PAGES_BASE_PATH ?? '') : ''

// Отдельный каталог сборки для e2e (tests/e2e/global-setup.ts): `next dev` держит lock в своём
// distDir, и второй сервер в том же каталоге (рядом с dev-сервером разработчика) не стартует.
// tsconfig.e2e.json уже содержит пути типов этого каталога — Next не переписывает tsconfig.json.
const distDir = process.env.NEXT_DIST_DIR || undefined

const nextConfig: NextConfig = {
  ...(distDir && { distDir, typescript: { tsconfigPath: 'tsconfig.e2e.json' } }),
  // Префикс адресов для ссылок react-aria/HeroUI (RouterProvider.useHref) на GitHub Pages.
  // NEXT_PUBLIC_STATIC_PREVIEW — превью без сервера: вход и кабинет работают в демо-режиме.
  env: { NEXT_PUBLIC_BASE_PATH: basePath, NEXT_PUBLIC_STATIC_PREVIEW: pagesExport ? '1' : '' },
  ...(pagesExport
    ? {
        output: 'export',
        basePath,
        trailingSlash: true,
      }
    : { output: 'standalone' }),
  images: {
    unoptimized: pagesExport,
    // Афиши пока лежат на CDN текущего сайта театра; после T-020 — медиа из CMS/S3.
    remotePatterns: [{ protocol: 'https', hostname: 'static.tildacdn.com' }],
  },
  poweredByHeader: false,
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }
    return webpackConfig
  },
  turbopack: {
    root: path.resolve(dirname),
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
