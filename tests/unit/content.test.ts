import { describe, expect, it } from 'vitest'

import { aboutTheatre, news, partners } from '../../src/modules/content'
import { demoShowsData } from '../../src/modules/shows'

describe('home content', () => {
  it('links news only to existing shows or internal pages', () => {
    const slugs = new Set(demoShowsData.shows.map((s) => s.slug))
    for (const item of news) {
      expect(item.href.startsWith('/'), item.id).toBe(true)
      const show = /^\/shows\/([^/?#]+)/.exec(item.href)?.[1]
      if (show) expect(slugs.has(show), item.id).toBe(true)
    }
  })

  it('uses unique news ids and partner names', () => {
    expect(new Set(news.map((n) => n.id)).size).toBe(news.length)
    expect(new Set(partners.map((p) => p.name)).size).toBe(partners.length)
  })

  it('has about text and photos for the about page', () => {
    expect(aboutTheatre.paragraphs.length).toBeGreaterThan(0)
    expect(aboutTheatre.photos.every((u) => u.startsWith('https://static.tildacdn.com/'))).toBe(
      true,
    )
  })
})
