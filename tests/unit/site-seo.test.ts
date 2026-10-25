import { describe, expect, it } from 'vitest'

import { seoFromCms } from '../../src/modules/content/cms'
import { DEFAULT_SEO, resolveSiteSeo } from '../../src/modules/site-data/seo'

// T-022: SEO по умолчанию — из «Настроек сайта», незаполненное — значения по умолчанию.
describe('site SEO defaults', () => {
  it('falls back to defaults without CMS settings (demo, static export, empty global)', () => {
    expect(resolveSiteSeo(null)).toEqual({
      title: DEFAULT_SEO.title,
      description: DEFAULT_SEO.description,
      imageUrl: '/og-default.jpg',
    })
    expect(resolveSiteSeo({ title: '  ', description: '' })).toEqual(resolveSiteSeo(null))
  })

  it('uses title, description and image from site settings', () => {
    const seo = seoFromCms({
      seo: {
        title: 'TURDUS — театр в барах',
        description: 'Описание из CMS',
        image: { url: '/api/media/file/og.jpg' },
      },
    } as never)
    expect(resolveSiteSeo(seo)).toEqual({
      title: 'TURDUS — театр в барах',
      description: 'Описание из CMS',
      imageUrl: '/api/media/file/og.jpg',
    })
  })

  it('ignores unsafe image URLs', () => {
    for (const imageUrl of ['javascript:alert(1)', '//evil.test/x.jpg', 'http://plain.test/x.jpg'])
      expect(resolveSiteSeo({ imageUrl }).imageUrl).toBe(DEFAULT_SEO.imageUrl)
    expect(resolveSiteSeo({ imageUrl: 'https://cdn.test/og.jpg' }).imageUrl).toBe(
      'https://cdn.test/og.jpg',
    )
  })
})
