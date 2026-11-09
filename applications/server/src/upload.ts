import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import multer from 'multer'

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

function sanitizeExtension(originalName: string): string {
  const ext = extname(originalName).toLowerCase()
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ''
}

export function createUploadMiddleware(uploadDir: string) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) =>
      cb(null, `${randomUUID()}${sanitizeExtension(file.originalname)}`),
  })
  return multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024, files: 10 },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
        cb(null, true)
      } else {
        cb(new Error(`Unsupported file type ${file.mimetype}`))
      }
    },
  })
}
