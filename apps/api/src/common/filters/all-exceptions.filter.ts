import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ErrorCode, type ErrorBody, type ErrorEnvelope } from '@flux/shared';
import { AppException } from '../errors/app.exception';

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
};

interface Mapped {
  status: number;
  body: Omit<ErrorBody, 'requestId'>;
}

/** Converts every thrown error into the standard error envelope. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: string }>();
    const response = http.getResponse<Response>();

    const { status, body } = this.map(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    const envelope: ErrorEnvelope = {
      error: { ...body, requestId: request.id === undefined ? undefined : String(request.id) },
    };
    response.status(status).json(envelope);
  }

  private map(exception: unknown): Mapped {
    if (exception instanceof AppException) {
      return {
        status: exception.status,
        body: { code: exception.code, message: exception.message, details: exception.details },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Unique constraint violation (e.g. duplicate IMO number, client code, batch number).
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          body: {
            code: ErrorCode.CONFLICT,
            message: 'A record with the same unique value already exists',
            details: { target: exception.meta?.target },
          },
        };
      }
      // Record required for the operation was not found.
      if (exception.code === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          body: { code: ErrorCode.NOT_FOUND, message: 'The requested record was not found' },
        };
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        body: {
          code:
            STATUS_TO_CODE[status] ??
            (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST),
          message: status >= 500 ? 'An unexpected error occurred' : exception.message,
        },
      };
    }

    // Never leak internals for unknown errors.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: ErrorCode.INTERNAL_ERROR, message: 'An unexpected error occurred' },
    };
  }
}
