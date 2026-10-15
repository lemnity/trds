import { describe, expect, it } from 'vitest'

import { aboutTheatre, legalDocuments, news, partners } from '../../src/modules/content'
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

describe('legalDocuments', () => {
  it('has unique, URL-safe slugs and titles for every footer document', () => {
    const slugs = legalDocuments.map((d) => d.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const doc of legalDocuments) {
      expect(doc.slug).toMatch(/^[a-z0-9-]+$/)
      expect(doc.title.length).toBeGreaterThan(0)
    }
  })
})
