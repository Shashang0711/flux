import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ModuleKey,
  PageQuery,
  TenantDto,
  TenantListFilter,
  UpdateTenantRequest,
} from '@flux/shared';
import type { z } from 'zod';
import type { createTenantSchema } from '@flux/shared';
import { AppException } from '../../common/errors/app.exception';
import { Paginated, toSkipTake } from '../../common/pagination/pagination';
import { PrismaService } from '../../database/prisma.service';
import { compactChanges, fieldChanges, listChange, recordAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth.types';
import { hashPassword } from '../auth/password';
import { SessionService } from '../auth/session.service';
import { toTenantDto } from './tenant.mapper';

const WITH_MODULES = { modules: { select: { moduleKey: true } } } as const;

function uniqueTarget(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return String(error.meta?.target ?? '');
  }
  return undefined;
}

/**
 * Platform-level tenant management. Uses the system PrismaService (RLS bypass) by design:
 * only platform administrators reach this service.
 */
@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async list(query: PageQuery & TenantListFilter): Promise<Paginated<TenantDto>> {
    const where: Prisma.TenantWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { slug: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [tenants, total] = await this.prisma.$transaction([
      this.prisma.tenant.findMany({
        where,
        include: WITH_MODULES,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      this.prisma.tenant.count({ where }),
    ]);
    return new Paginated(tenants.map(toTenantDto), total, query);
  }

  async get(id: string): Promise<TenantDto> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id }, include: WITH_MODULES });
    if (!tenant) throw AppException.notFound('Tenant', id);
    return toTenantDto(tenant);
  }

  /** Creates the tenant, its licensed modules and its first administrator in one transaction. */
  async create(input: z.output<typeof createTenantSchema>, actor: AuthUser): Promise<TenantDto> {
    const passwordHash = await hashPassword(input.admin.password);
    try {
      const tenant = await this.prisma.$transaction(async (tx) => {
        const created = await tx.tenant.create({
          data: {
            slug: input.slug,
            name: input.name,
            modules: { create: input.modules.map((moduleKey) => ({ moduleKey })) },
          },
        });
        // Every tenant gets the built-in Administrator role; its first user holds it.
        const adminRole = await tx.role.create({
          data: {
            tenantId: created.id,
            name: 'Administrator',
            description:
              'Built-in role with full access to every module licensed to the organisation',
            defaultPortal: 'ADMIN',
            isSystem: true,
          },
        });
        const admin = await tx.user.create({
          data: {
            tenantId: created.id,
            email: input.admin.email,
            name: input.admin.name,
            passwordHash,
            // tenant_id comes from the user through the composite relation.
            userRoles: { create: { roleId: adminRole.id } },
          },
        });
        await recordAudit(tx, {
          tenantId: created.id,
          actor,
          action: 'tenant.created',
          entity: { type: 'tenant', id: created.id, label: created.name },
          relatedIds: [admin.id],
          changes: compactChanges({
            ...fieldChanges(null, created, ['name', 'slug']),
            modules: listChange([], input.modules),
          }),
        });
        await recordAudit(tx, {
          tenantId: created.id,
          actor,
          action: 'user.created',
          entity: { type: 'user', id: admin.id, label: admin.name },
          relatedIds: [adminRole.id],
          changes: compactChanges({
            ...fieldChanges(null, admin, ['name', 'email']),
            roles: listChange([], [adminRole.name]),
          }),
        });
        return tx.tenant.findUniqueOrThrow({ where: { id: created.id }, include: WITH_MODULES });
      });
      return toTenantDto(tenant);
    } catch (error) {
      const target = uniqueTarget(error);
      if (target?.includes('slug')) {
        throw AppException.conflict('A tenant with this slug already exists', {
          fields: [{ path: 'slug', message: 'Slug is already in use' }],
        });
      }
      if (target?.includes('email')) {
        throw AppException.conflict('A user with this email already exists', {
          fields: [{ path: 'admin.email', message: 'Email is already in use' }],
        });
      }
      throw error;
    }
  }

  /** Suspending a tenant signs out all of its users immediately. */
  async update(id: string, input: UpdateTenantRequest, actor: AuthUser): Promise<TenantDto> {
    const tenant = await this.prisma.$transaction(async (tx) => {
      const before = await tx.tenant.findUnique({ where: { id } });
      if (!before) throw AppException.notFound('Tenant', id);
      const updated = await tx.tenant.update({ where: { id }, data: input, include: WITH_MODULES });
      if (input.status === 'SUSPENDED') await this.sessions.revokeAllForTenant(id, tx);

      const changes = fieldChanges(before, updated, ['name', 'status']);
      if (Object.keys(changes).length > 0) {
        await recordAudit(tx, {
          tenantId: id,
          actor,
          action: changes.status
            ? updated.status === 'SUSPENDED'
              ? 'tenant.suspended'
              : 'tenant.reactivated'
            : 'tenant.updated',
          entity: { type: 'tenant', id, label: updated.name },
          changes,
        });
      }
      return updated;
    });
    return toTenantDto(tenant);
  }

  /** Replaces the tenant's licensed optional modules. */
  async setModules(id: string, modules: ModuleKey[], actor: AuthUser): Promise<TenantDto> {
    const tenant = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.tenant.findUnique({ where: { id }, include: WITH_MODULES });
      if (!existing) throw AppException.notFound('Tenant', id);
      const change = listChange(
        existing.modules.map((m) => m.moduleKey),
        modules,
      );
      if (change) {
        await recordAudit(tx, {
          tenantId: id,
          actor,
          action: 'tenant.modules_changed',
          entity: { type: 'tenant', id, label: existing.name },
          changes: { modules: change },
        });
      }
      await tx.tenantModule.deleteMany({ where: { tenantId: id, moduleKey: { notIn: modules } } });
      await tx.tenantModule.createMany({
        data: modules.map((moduleKey) => ({ tenantId: id, moduleKey })),
        skipDuplicates: true,
      });
      // Touch updatedAt so the change is visible in listings.
      return tx.tenant.update({
        where: { id },
        data: { updatedAt: new Date() },
        include: WITH_MODULES,
      });
    });
    return toTenantDto(tenant);
  }
}
