'use client'

import {
  $createUploadNode,
  createClientFeature,
  INSERT_BLOCK_COMMAND,
  slashMenuBasicGroupWithItems,
  toolbarAddDropdownGroupWithItems,
} from '@payloadcms/richtext-lexical/client'
import {
  $getPreviousSelection,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type LexicalEditor,
} from '@payloadcms/richtext-lexical/lexical'
import { $insertNodeToNearestRoot } from '@payloadcms/richtext-lexical/lexical/utils'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { toast, useConfig, useFormFields } from '@payloadcms/ui'
import { useEffect, useRef } from 'react'

import type { Media } from '@/payload-types'

/** Открыть выбор файлов (кнопка в «＋» и пункт «/»-меню). */
const OPEN_MEDIA_PICKER_COMMAND = createCommand<void>('TURDUS_OPEN_MEDIA_PICKER')

/** Форматы — как разрешено в коллекции «Медиа» (src/payload/collections/Media.ts). */
const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm,video/quicktime'

type MediaDoc = Media

function Icon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path
        d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5M4 13v2.5h12V13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Скрытое поле выбора файлов: загрузка в «Медиа» и вставка в текст по одному файлу. */
function MediaUploadPlugin() {
  const [editor] = useLexicalComposerContext()
  const input = useRef<HTMLInputElement>(null)
  const {
    config: {
      serverURL,
      routes: { api },
    },
  } = useConfig()
  const title = useFormFields(([fields]) => fields.title?.value)

  useEffect(
    () =>
      editor.registerCommand(
        OPEN_MEDIA_PICKER_COMMAND,
        () => {
          input.current?.click()
          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    [editor],
  )

  const uploadOne = async (file: File): Promise<MediaDoc> => {
    const form = new FormData()
    form.append('file', file)
    const kind = file.type.startsWith('video/') ? 'видео' : 'фото'
    const alt = typeof title === 'string' && title ? `«${title}» — ${kind}` : kind
    form.append('_payload', JSON.stringify({ alt }))
    const res = await fetch(`${serverURL}${api}/media`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    })
    const body = (await res.json().catch(() => null)) as {
      doc?: MediaDoc
      errors?: { message?: string }[]
    } | null
    if (!res.ok || !body?.doc)
      throw new Error(body?.errors?.[0]?.message ?? `«${file.name}» не загрузился`)
    return body.doc
  }

  const onFiles = async (list: FileList | null) => {
    const files = [...(list ?? [])]
    for (const [i, file] of files.entries()) {
      const id = toast.loading(
        files.length > 1 ? `Загрузка ${i + 1} из ${files.length}…` : 'Загрузка…',
      )
      try {
        const doc = await uploadOne(file)
        // Вставка как у UploadFeature: блок файла у курсора (фокус мог уйти в окно выбора
        // файлов — тогда прежняя позиция курсора, а без неё — в конец текста).
        editor.update(() => {
          const current = $getSelection() ?? $getPreviousSelection()
          const selection = $isRangeSelection(current) ? current : $getRoot().selectEnd()
          const focusNode = selection.focus.getNode()
          $insertNodeToNearestRoot(
            $createUploadNode({
              data: { fields: {}, relationTo: 'media', value: doc.id },
            }),
          )
          // Пустой абзац, в котором стоял курсор, не оставляем.
          if ($isParagraphNode(focusNode) && !focusNode.getFirstChild()) focusNode.remove()
        })
        toast.success(`«${file.name}» добавлен`, { id })
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `«${file.name}» не загрузился`, { id })
      }
    }
  }

  return (
    <input
      ref={input}
      type="file"
      accept={ACCEPT}
      multiple
      hidden
      onChange={(e) => {
        void onFiles(e.target.files)
        e.target.value = ''
      }}
    />
  )
}

const item = {
  ChildComponent: Icon,
  Icon,
  key: 'turdusMediaUpload',
  // Первым в «＋»: самый частый пункт (пункты с order Payload ставит выше остальных).
  order: 1,
  keywords: ['загрузить', 'фото', 'видео', 'картинка', 'upload', 'image', 'video'],
  label: 'Загрузить фото или видео',
  onSelect: ({ editor }: { editor: LexicalEditor }) => {
    editor.dispatchCommand(OPEN_MEDIA_PICKER_COMMAND, undefined)
  },
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <rect
        x="3"
        y="4.5"
        width="14"
        height="11"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M8.5 7.8v4.4l3.8-2.2z" fill="currentColor" />
    </svg>
  )
}

function ButtonIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <rect
        x="2.5"
        y="6"
        width="15"
        height="8"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M7 10h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Блоки «Видео по ссылке» и «Кнопка-ссылка» (BlocksFeature в News.ts) — пунктами в «＋»,
 * рядом с файлами; отдельная кнопка блоков в панели скрыта (custom.scss).
 */
const blockItem = (
  key: string,
  blockType: string,
  label: string,
  Glyph: () => React.JSX.Element,
  keywords: string[],
) => ({
  ChildComponent: Glyph,
  Icon: Glyph,
  key,
  keywords,
  label,
  onSelect: ({ editor }: { editor: LexicalEditor }) => {
    editor.dispatchCommand(INSERT_BLOCK_COMMAND, { blockName: '', blockType })
  },
})

const videoItem = blockItem(
  'turdusVideoEmbed',
  'videoEmbed',
  'Видео по ссылке (YouTube, VK, Rutube)',
  PlayIcon,
  ['видео', 'youtube', 'ютуб', 'вк', 'vk', 'rutube', 'ссылка'],
)
const buttonItem = blockItem('turdusButton', 'button', 'Кнопка-ссылка', ButtonIcon, [
  'кнопка',
  'ссылка',
  'купить',
  'button',
])

export const MediaUploadFeatureClient = createClientFeature({
  plugins: [{ Component: MediaUploadPlugin, position: 'normal' }],
  slashMenu: { groups: [slashMenuBasicGroupWithItems([item, videoItem, buttonItem])] },
  toolbarFixed: { groups: [toolbarAddDropdownGroupWithItems([item, videoItem, buttonItem])] },
})
