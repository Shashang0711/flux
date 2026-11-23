import { Controller, Get, Query } from '@nestjs/common';
import {
  auditListFilterSchema,
  type AuditListFilter,
  type AuditLogDto,
  type PageQuery,
} from '@flux/shared';
import { Paginated, pageQuerySchema } from '../../common/pagination/pagination';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { TenantContext } from '../auth/auth.types';
import { CurrentTenant, RequirePermission } from '../auth/decorators';
import { AuditLogService } from './audit-log.service';

const listQuerySchema = pageQuerySchema.extend(auditListFilterSchema.shape);

/** Read-only: entries are written by the services that make the changes. */
@Controller('audit-logs')
@RequirePermission('audit.view')
export class AuditLogController {
  constructor(private readonly audit: AuditLogService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listQuerySchema)) query: PageQuery & AuditListFilter,
  ): Promise<Paginated<AuditLogDto>> {
    return this.audit.list(tenant, query);
  }
}
