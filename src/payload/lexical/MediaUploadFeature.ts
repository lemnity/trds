import { createServerFeature } from '@payloadcms/richtext-lexical'

/**
 * «Загрузить фото или видео» в визуальном редакторе: сразу открывает выбор файлов на компьютере
 * (можно несколько), загружает их в «Медиа» и вставляет в текст. Стандартный пункт UploadFeature
 * («Выбрать из «Медиа»») остаётся для уже загруженных файлов. Узлы и вывод — у UploadFeature,
 * поэтому подключать вместе с ним.
 */
export const MediaUploadFeature = createServerFeature({
  feature: {
    ClientFeature: '/payload/lexical/MediaUploadFeature.client#MediaUploadFeatureClient',
  },
  key: 'turdusMediaUpload',
})
