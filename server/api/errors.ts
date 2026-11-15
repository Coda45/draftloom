import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';

export type ApiErrorBody = {
    error: {
        code: string;
        message: string;
        retryable: boolean;
    };
};

export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly retryable = false,
    ) {
        super(message);
    }
}

export function asyncRoute(handler: RequestHandler): RequestHandler {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export const notFound: RequestHandler = (_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'The requested resource was not found.'));

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    let apiError: ApiError;
    if (error instanceof ApiError) apiError = error;
    else if (error instanceof multer.MulterError) {
        apiError = new ApiError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, `UPLOAD_${error.code}`, error.code === 'LIMIT_FILE_SIZE' ? 'The image exceeds the upload size limit.' : error.message);
    } else {
        console.error(error instanceof Error ? error.message : 'Unknown server error');
        apiError = new ApiError(500, 'INTERNAL_ERROR', 'The server could not complete the request.', true);
    }
    const body: ApiErrorBody = { error: { code: apiError.code, message: apiError.message, retryable: apiError.retryable } };
    res.status(apiError.status).json(body);
};
