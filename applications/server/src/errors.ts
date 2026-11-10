import type { NextFunction, Request, Response } from 'express';
import { ConflictError, ValidationError } from '@antiquary/database';
import { ZodError } from 'zod';

export class HttpError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'HttpError';
    }
}

export function errorHandler() {
    return (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
        if (err instanceof ZodError) {
            const first = err.issues[0];
            res.status(400).json({
                error: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid request body',
            });
            return;
        }
        if (err instanceof ValidationError) {
            res.status(400).json({ error: err.message });
            return;
        }
        if (err instanceof ConflictError) {
            res.status(409).json({ error: err.message });
            return;
        }
        if (err instanceof HttpError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
        if (err instanceof Error && err.message.startsWith('Unsupported file type')) {
            res.status(400).json({ error: err.message });
            return;
        }
        console.error('[antiquary] unhandled error:', err);
        res.status(500).json({ error: 'Internal server error' });
    };
}
