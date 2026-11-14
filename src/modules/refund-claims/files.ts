import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Подтверждающие документы заявок — медицинские персональные данные. Лежат вне публичной папки
 * медиа (`PRIVATE_FILES_DIR`, по умолчанию ./private-files), имя файла на диске случайное, отдаются
 * только сотрудникам через проверку прав. Тип определяется по содержимому, а не по имени.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_FILES_PER_CLAIM = 5

const SIGNATURES: { mime: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    test: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    test: (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  {
    // HEIC/HEIF — фото с iPhone: «ftyp» + бренд heic/heix/mif1/msf1.
    mime: 'image/heic',
    test: (b) =>
      b.subarray(4, 8).toString('latin1') === 'ftyp' &&
      ['heic', 'heix', 'mif1', 'msf1', 'heim', 'heis'].includes(
        b.subarray(8, 12).toString('latin1'),
      ),
  },
]

/** MIME по содержимому; null — тип не разрешён. */
export const sniffMime = (bytes: Buffer) => SIGNATURES.find((s) => s.test(bytes))?.mime ?? null

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
}
export const extensionFor = (mime: string) => EXT[mime] ?? 'bin'

export interface ClaimFileStorage {
  save(bytes: Buffer, mime: string): Promise<string>
  read(storageKey: string): Promise<Buffer>
}

const KEY = /^[a-f0-9]{32}\.(pdf|jpg|png|webp|heic)$/

export function diskClaimFileStorage(
  dir = process.env.PRIVATE_FILES_DIR ?? path.resolve(process.cwd(), 'private-files'),
): ClaimFileStorage {
  const root = path.join(dir, 'refund-claims')
  return {
    async save(bytes, mime) {
      await mkdir(root, { recursive: true, mode: 0o700 })
      const key = `${randomBytes(16).toString('hex')}.${extensionFor(mime)}`
      await writeFile(path.join(root, key), bytes, { mode: 0o600, flag: 'wx' })
      return key
    },
    async read(storageKey) {
      // Ключ — только наш формат: никакого обхода каталогов через «../».
      if (!KEY.test(storageKey)) throw new Error('invalid storage key')
      return readFile(path.join(root, storageKey))
    },
  }
}

export function memoryClaimFileStorage(): ClaimFileStorage {
  const files = new Map<string, Buffer>()
  return {
    async save(bytes, mime) {
      const key = `${randomBytes(16).toString('hex')}.${extensionFor(mime)}`
      files.set(key, Buffer.from(bytes))
      return key
    },
    async read(storageKey) {
      const f = files.get(storageKey)
      if (!f) throw new Error('not found')
      return f
    },
  }
}
