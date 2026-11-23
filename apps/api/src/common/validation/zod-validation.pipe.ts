import { HttpStatus, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ErrorCode, type FieldIssue } from '@flux/shared';
import { AppException } from '../errors/app.exception';

/**
 * Validates and parses a request part against a Zod schema.
 * Usage: `@Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery`
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const details: FieldIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
      'Request validation failed',
      details,
    );
  }
}
