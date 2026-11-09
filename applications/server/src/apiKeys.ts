import type { NextFunction, Request, Response } from 'express'
import type { ApiKeyDto, Database } from '@antiquary/database'

declare module 'express-serve-static-core' {
  interface Request {
    apiKey?: ApiKeyDto
  }
}

/**
 * Extracts an MCP API key from `Authorization: Bearer mcp_…` or `X-Api-Key`
 * and attaches it to the request. Revoked or unknown keys get a 401.
 */
export function requireApiKey(db: Database) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization
    const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined
    const key =
      bearer ??
      (typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : undefined)
    if (!key) {
      res.status(401).json({ error: 'Missing API key (Authorization: Bearer mcp_…)' })
      return
    }
    const apiKey = await db.authenticateApiKey(key)
    if (!apiKey) {
      res.status(401).json({ error: 'Invalid or revoked API key' })
      return
    }
    db.touchApiKey(apiKey.id)
    req.apiKey = apiKey
    next()
  }
}
