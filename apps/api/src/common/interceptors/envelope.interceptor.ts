import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import type { SuccessEnvelope } from '@flux/shared';
import { RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator';
import { Paginated } from '../pagination/pagination';

/** Wraps every successful handler result in `{ data }` (and `meta` for paginated lists). */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) return next.handle();

    return next.handle().pipe(
      map((result): SuccessEnvelope<unknown> => {
        if (result instanceof Paginated) {
          return { data: result.items, meta: result.meta };
        }
        return { data: result ?? null };
      }),
    );
  }
}
