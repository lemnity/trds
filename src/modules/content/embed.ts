/**
 * Видео по ссылке в тексте новости: адрес страницы с видео → адрес встраиваемого плеера.
 * Только https и только известные площадки (YouTube, VK Видео, Rutube) — в iframe попадает
 * адрес, собранный здесь из id, а не то, что вставил редактор.
 */

const YOUTUBE_ID = /^[\w-]{11}$/
const VK_ID = /^video(-?\d+)_(\d+)$/
const RUTUBE_ID = /^[0-9a-f]{32}$/

const parse = (raw: string): URL | null => {
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

const host = (url: URL) => url.hostname.replace(/^(www|m)\./, '')

export function videoEmbedUrl(raw: string): string | null {
  const url = parse(raw)
  if (!url) return null
  const parts = url.pathname.split('/').filter(Boolean)

  switch (host(url)) {
    case 'youtube.com': {
      const id =
        parts[0] === 'shorts' || parts[0] === 'embed' ? parts[1] : url.searchParams.get('v')
      return id && YOUTUBE_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null
    }
    case 'youtu.be': {
      const id = parts[0]
      return id && YOUTUBE_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null
    }
    case 'vk.com':
    case 'vkvideo.ru': {
      const match = VK_ID.exec(parts[0] ?? '')
      return match ? `https://vkvideo.ru/video_ext.php?oid=${match[1]}&id=${match[2]}` : null
    }
    case 'rutube.ru': {
      const id = parts[0] === 'video' ? parts[1] : null
      return id && RUTUBE_ID.test(id) ? `https://rutube.ru/play/embed/${id}` : null
    }
    default:
      return null
  }
}
