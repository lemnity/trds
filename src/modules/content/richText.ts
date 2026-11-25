/**
 * Текст из визуального редактора (Lexical, Payload richText) — JSON-дерево узлов.
 * Пустой редактор — это не null, а корень с одним пустым абзацем, поэтому «есть ли текст»
 * проверяем по содержимому: хоть один текстовый узел с символами или картинка/разделитель.
 */

type Node = { type?: string; text?: string; children?: Node[] }

export type RichTextState = { root: Node }

const hasContent = (node: Node): boolean =>
  (typeof node.text === 'string' && node.text.trim().length > 0) ||
  node.type === 'upload' ||
  node.type === 'horizontalrule' ||
  (node.children ?? []).some(hasContent)

export const hasRichText = (value: unknown): value is RichTextState =>
  !!value &&
  typeof value === 'object' &&
  'root' in value &&
  !!value.root &&
  typeof value.root === 'object' &&
  hasContent(value.root as Node)
