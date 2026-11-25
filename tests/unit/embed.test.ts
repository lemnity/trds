import { describe, expect, it } from 'vitest'

import { videoEmbedUrl } from '../../src/modules/content/embed'

describe('videoEmbedUrl', () => {
  it.each([
    [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    [
      'https://youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ],
    ['https://vk.com/video-12345_67890', 'https://vkvideo.ru/video_ext.php?oid=-12345&id=67890'],
    [
      'https://vkvideo.ru/video-12345_67890?list=x',
      'https://vkvideo.ru/video_ext.php?oid=-12345&id=67890',
    ],
    [
      'https://rutube.ru/video/0123456789abcdef0123456789abcdef/',
      'https://rutube.ru/play/embed/0123456789abcdef0123456789abcdef',
    ],
  ])('%s → плеер', (url, embed) => {
    expect(videoEmbedUrl(url)).toBe(embed)
  })

  it.each([
    'https://example.com/video.mp4',
    'javascript:alert(1)',
    'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.ru/watch?v=dQw4w9WgXcQ',
    'не ссылка',
    '',
  ])('%s → null (не поддерживается)', (url) => {
    expect(videoEmbedUrl(url)).toBeNull()
  })
})
