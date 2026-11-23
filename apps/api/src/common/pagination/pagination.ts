import { z } from 'zod';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  buildPageMeta,
  type PageMeta,
  type PageQuery,
} from '@flux/shared';

/** Query-string schema for every paginated grid: `?page=1&pageSize=20`. */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

/** Prisma `skip`/`take` for a page query. */
export function toSkipTake(query: PageQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

/**
 * Return this from a list handler; the envelope interceptor renders it as
 * `{ data: items, meta: { page, pageSize, total, totalPages } }`.
 */
export class Paginated<T> {
  readonly meta: PageMeta;

  constructor(
    readonly items: T[],
    total: number,
    query: PageQuery,
  ) {
    this.meta = buildPageMeta(query, total);
  }
}
