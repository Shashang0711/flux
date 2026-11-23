import { HttpStatus } from '@nestjs/common';
import { ErrorCode, type ErrorBody } from '@flux/shared';

/**
 * The one exception type domain code should throw. The global filter turns it into
 * `{ error: { code, message, details, requestId } }` with the given HTTP status.
 */
export class AppException extends Error {
  constructor(
    readonly status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorBody['details'],
  ) {
    super(message);
    this.name = 'AppException';
  }

  static notFound(entity: string, id?: string): AppException {
    return new AppException(
      HttpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
      id ? `${entity} '${id}' was not found` : `${entity} was not found`,
    );
  }

  static conflict(message: string, details?: ErrorBody['details']): AppException {
    return new AppException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, message, details);
  }

  static unauthenticated(message = 'You must be signed in'): AppException {
    return new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED, message);
  }

  static forbidden(message = 'You do not have permission to perform this action'): AppException {
    return new AppException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, message);
  }

  static badRequest(message: string, details?: ErrorBody['details']): AppException {
    return new AppException(HttpStatus.BAD_REQUEST, ErrorCode.BAD_REQUEST, message, details);
  }
}
