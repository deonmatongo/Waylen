/**
 * Typed error hierarchy.
 *
 * `isOperational` distinguishes expected failures (bad input, missing record,
 * denied access) from genuine bugs. Only the former have their message shown
 * to the user.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly isOperational: boolean;
  readonly details?: unknown;

  constructor(message: string, statusCode = 500, isOperational = true, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Some of the details provided are not valid.', details?: unknown) {
    super(message, 422, true, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Please sign in to continue.') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that.') {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'We could not find what you were looking for.') {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'That conflicts with something that already exists.') {
    super(message, 409);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please slow down.') {
    super(message, 429);
  }
}

/** An upstream dependency failed — payment gateway, mail relay, Graph API. */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'That service is temporarily unavailable. Please try again shortly.') {
    super(message, 503);
  }
}
