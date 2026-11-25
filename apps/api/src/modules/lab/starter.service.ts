import { Injectable } from '@nestjs/common';
import type { StarterImportResultDto } from '@flux/shared';
import { TenantDb } from '../../database/tenant-db.service';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { labAudit } from './catalogue.service';
import {
  STARTER_BOTTLE_TYPES,
  STARTER_CATEGORIES,
  STARTER_PARAMETERS,
  STARTER_PRODUCTS,
  STARTER_SERVICE_TYPES,
} from './starter-catalogue';

/**
 * Copies the FLUX starter catalogue into the organisation. Items are matched by code: existing
 * ones (even if edited or deactivated) are left untouched, so importing again is safe.
 */
@Injectable()
export class StarterService {
  constructor(private readonly db: TenantDb) {}

  import(ctx: TenantContext, actor: AuthUser): Promise<StarterImportResultDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const tenantId = ctx.tenantId;
      const created = {
        categories: 0,
        serviceTypes: 0,
        parameters: 0,
        bottleTypes: 0,
        products: 0,
      };
      let skipped = 0;

      const categories = new Map<string, string>();
      for (const c of STARTER_CATEGORIES) {
        const found = await tx.labCategory.findUnique({
          where: { tenantId_code: { tenantId, code: c.code } },
        });
        if (found) {
          skipped++;
          categories.set(c.code, found.id);
          continue;
        }
        const row = await tx.labCategory.create({ data: { tenantId, ...c } });
        categories.set(c.code, row.id);
        created.categories++;
      }

      const serviceTypes = new Map<string, string>();
      for (const s of STARTER_SERVICE_TYPES) {
        const found = await tx.serviceType.findUnique({
          where: { tenantId_code: { tenantId, code: s.code } },
        });
        if (found) {
          skipped++;
          serviceTypes.set(s.code, found.id);
          continue;
        }
        const row = await tx.serviceType.create({
          data: {
            tenantId,
            categoryId: categories.get(s.category)!,
            code: s.code,
            name: s.name,
            sortOrder: s.sortOrder,
            vesselRequired: s.vesselRequired,
            fields: {
              // Nested rows take tenant_id from their parent (composite relations).
              create: s.fields.map((f, i) => ({
                key: f.key,
                label: f.label,
                type: f.type,
                scope: f.scope,
                required: f.required ?? false,
                helpText: f.helpText ?? null,
                options: f.options ?? [],
                sortOrder: (i + 1) * 10,
              })),
            },
          },
        });
        serviceTypes.set(s.code, row.id);
        created.serviceTypes++;
      }

      // Test parameters: missing ones are added, also to service types that already existed.
      for (const [code, params] of Object.entries(STARTER_PARAMETERS)) {
        const serviceTypeId = serviceTypes.get(code);
        if (!serviceTypeId) continue;
        const have = await tx.testParameter.findMany({
          where: { serviceTypeId },
          select: { key: true },
        });
        for (const [i, p] of params.entries()) {
          if (have.some((h) => h.key === p.key)) {
            skipped++;
            continue;
          }
          await tx.testParameter.create({
            data: {
              tenantId,
              serviceTypeId,
              key: p.key,
              name: p.name,
              unit: p.unit ?? null,
              type: p.type,
              decimals: p.decimals ?? null,
              method: p.method ?? null,
              options: p.options ?? [],
              cautionMin: p.cautionMin ?? null,
              cautionMax: p.cautionMax ?? null,
              criticalMin: p.criticalMin ?? null,
              criticalMax: p.criticalMax ?? null,
              required: p.required ?? false,
              sortOrder: (i + 1) * 10,
            },
          });
          created.parameters++;
        }
      }

      const bottles = new Map<string, string>();
      for (const b of STARTER_BOTTLE_TYPES) {
        const found = await tx.bottleType.findUnique({
          where: { tenantId_code: { tenantId, code: b.code } },
        });
        if (found) {
          skipped++;
          bottles.set(b.code, found.id);
          continue;
        }
        const row = await tx.bottleType.create({ data: { tenantId, ...b } });
        bottles.set(b.code, row.id);
        created.bottleTypes++;
      }

      for (const p of STARTER_PRODUCTS) {
        const found = await tx.product.findUnique({
          where: { tenantId_code: { tenantId, code: p.code } },
        });
        if (found) {
          skipped++;
          continue;
        }
        const lines = (l: { bottle: string; quantity: number }[]) =>
          l.map((x) => ({ bottleTypeId: bottles.get(x.bottle)!, quantity: x.quantity }));
        await tx.product.create({
          data: {
            tenantId,
            code: p.code,
            name: p.name,
            serviceTypes: {
              create: p.serviceTypes.map((code) => ({
                serviceTypeId: serviceTypes.get(code)!,
              })),
            },
            bottles: { create: lines(p.bottles) },
            variants: {
              create: p.variants.map((v) => ({
                code: v.code,
                name: v.name,
                bottles: { create: lines(v.bottles ?? []) },
              })),
            },
          },
        });
        created.products++;
      }

      const total = Object.values(created).reduce((a, b) => a + b, 0);
      if (total > 0) {
        await labAudit(
          tx,
          ctx,
          actor,
          'lab.starter_imported',
          { type: 'tenant', id: tenantId, label: 'FLUX starter catalogue' },
          {
            categories: { from: null, to: created.categories },
            serviceTypes: { from: null, to: created.serviceTypes },
            parameters: { from: null, to: created.parameters },
            bottleTypes: { from: null, to: created.bottleTypes },
            kits: { from: null, to: created.products },
          },
        );
      }
      return { created, skipped };
    });
  }
}
