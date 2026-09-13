export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }

  toBody(): Record<string, unknown> {
    return { error: this.code, ...(this.details ?? {}) };
  }
}

export function notFound(code = 'not_found'): HttpError {
  return new HttpError(404, code);
}

export function conflict(code: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(409, code, details);
}

export function badRequest(code: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(400, code, details);
}
