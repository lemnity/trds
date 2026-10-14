import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Статический превью публичных страниц для GitHub Pages (scripts/build-pages.sh).
// Production — standalone-сервер; Pages не умеет запускать Next.js/Payload.
const pagesExport = process.env.PAGES_EXPORT === '1'

const nextConfig: NextConfig = {
  ...(pagesExport
    ? {
        output: 'export',
        basePath: process.env.PAGES_BASE_PATH ?? '',
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : { output: 'standalone' }),
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
