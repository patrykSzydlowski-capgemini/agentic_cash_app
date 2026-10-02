/**
 * Standardized Enterprise Application Error
 * Provides structured error codes, HTTP status, and cause context for CAP OData requests.
 */
export class ApplicationError extends Error {
    public readonly code: string;
    public readonly statusCode: number;
    public readonly cause?: unknown;
    public readonly args?: unknown[] | Record<string, unknown>;

    constructor(
        message: string,
        code: string = 'APPLICATION_ERROR',
        statusCode: number = 400,
        cause?: unknown,
        args?: unknown[] | Record<string, unknown>
    ) {
        super(message);
        this.name = 'ApplicationError';
        this.code = code;
        this.statusCode = statusCode;
        if (cause) this.cause = cause;
        if (args) this.args = args;
        Object.setPrototypeOf(this, ApplicationError.prototype);
    }

    /**
     * Rejects a CDS request with appropriate status and code
     */
    public rejectRequest(req: { reject: (code: number, message: string) => void }): void {
        req.reject(this.statusCode, this.message);
    }
}

export default ApplicationError;
