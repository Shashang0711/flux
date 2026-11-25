import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type BottleTypeDto,
  type LabListQuery,
  type ProductDto,
  type ProductSummaryDto,
  type bottleLinesSchema,
  type createBottleTypeSchema,
  type createProductSchema,
  type createVariantSchema,
  type updateBottleTypeSchema,
  type updateProductSchema,
  type updateVariantSchema,
} from '@flux/shared';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import { compactChanges, fieldChanges, listChange } from '../audit/audit';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { labAudit } from './catalogue.service';
import {
  PRODUCT_DETAIL_INCLUDE,
  PRODUCT_SUMMARY_INCLUDE,
  describeBottles,
  fieldError,
  toProductDto,
  toProductSummaryDto,
  uniqueCode,
} from './lab.mapper';

type Out<T extends z.ZodType> = z.output<T>;
type Lines = Out<typeof bottleLinesSchema>['bottles'];

const BOTTLE_TYPE_FIELDS = ['code', 'name', 'volumeMl', 'material', 'isActive'] as const;
const PRODUCT_FIELDS = ['code', 'name', 'description', 'isActive'] as const;
const VARIANT_FIELDS = ['code', 'name', 'isActive'] as const;

const label = (r: { code: string; name: string }) => `${r.code} ${r.name}`;

/** Bottle types, kits (products), their service types, variants and bottle configurations. */
@Injectable()
export class KitsService {
  constructor(private readonly db: TenantDb) {}

  // ─── Bottle types ─────────────────────────────────────────────────────────

  listBottleTypes(ctx: TenantContext, query: LabListQuery): Promise<BottleTypeDto[]> {
    return this.db.run(ctx.tenantId, (tx) => this.bottleTypes(tx, query.view === 'active'));
  }

  createBottleType(
    ctx: TenantContext,
    input: Out<typeof createBottleTypeSchema>,
    actor: AuthUser,
  ): Promise<BottleTypeDto[]> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const created = await uniqueCode(() =>
        tx.bottleType.create({
          data: { tenantId: ctx.tenantId, ...input, material: input.material ?? null },
        }),
      );
      await labAudit(
        tx,
        ctx,
        actor,
        'lab.bottle_type_created',
        { type: 'bottle-type', id: created.id, label: label(created) },
        fieldChanges(null, created, BOTTLE_TYPE_FIELDS),
      );
      return this.bottleTypes(tx);
    });
  }

  updateBottleType(
    ctx: TenantContext,
    id: string,
    input: Out<typeof updateBottleTypeSchema>,
    actor: AuthUser,
  ): Promise<BottleTypeDto[]> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const before = await tx.bottleType.findUnique({ where: { id } });
      if (!before) throw AppException.notFound('Bottle type', id);
      const after = await uniqueCode(() => tx.bottleType.update({ where: { id }, data: input }));
      const changes = fieldChanges(before, after, BOTTLE_TYPE_FIELDS);
      if (Object.keys(changes).length > 0) {
        await labAudit(
          tx,
          ctx,
          actor,
          'lab.bottle_type_updated',
          { type: 'bottle-type', id, label: label(after) },
          changes,
        );
      }
      return this.bottleTypes(tx);
    });
  }

  private async bottleTypes(tx: TenantTx, activeOnly = false): Promise<BottleTypeDto[]> {
    const rows = await tx.bottleType.findMany({
      where: activeOnly ? { isActive: true } : {},
      include: { _count: { select: { productBottles: true, variantBottles: true } } },
      orderBy: [{ isActive: 'desc' }, { volumeMl: 'desc' }, { name: 'asc' }],
    });
    return rows.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      volumeMl: b.volumeMl,
      material: b.material,
      isActive: b.isActive,
      usageCount: b._count.productBottles + b._count.variantBottles,
    }));
  }

  // ─── Kits ─────────────────────────────────────────────────────────────────

  listProducts(ctx: TenantContext, query: LabListQuery): Promise<ProductSummaryDto[]> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const where: Prisma.ProductWhereInput = {
        ...(query.view === 'active' ? { isActive: true } : {}),
        ...(query.serviceTypeId
          ? { serviceTypes: { some: { serviceTypeId: query.serviceTypeId } } }
          : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { code: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const rows = await tx.product.findMany({
        where,
        include: PRODUCT_SUMMARY_INCLUDE,
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      });
      return rows.map(toProductSummaryDto);
    });
  }

  getProduct(ctx: TenantContext, id: string): Promise<ProductDto> {
    return this.db.run(ctx.tenantId, (tx) => this.product(tx, id));
  }

  createProduct(
    ctx: TenantContext,
    input: Out<typeof createProductSchema>,
    actor: AuthUser,
  ): Promise<ProductDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const names = await this.assertServiceTypes(tx, input.serviceTypeIds, []);
      const created = await uniqueCode(() =>
        tx.product.create({
          data: {
            tenantId: ctx.tenantId,
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            serviceTypes: {
              // tenant_id comes from the parent kit (composite relation).
              create: input.serviceTypeIds.map((serviceTypeId) => ({ serviceTypeId })),
            },
          },
        }),
      );
      await labAudit(
        tx,
        ctx,
        actor,
        'lab.product_created',
        { type: 'product', id: created.id, label: label(created) },
        {
          ...fieldChanges(null, created, PRODUCT_FIELDS),
          serviceTypes: { added: names, removed: [] },
        },
        input.serviceTypeIds,
      );
      return this.product(tx, created.id);
    });
  }

  updateProduct(
    ctx: TenantContext,
    id: string,
    input: Out<typeof updateProductSchema>,
    actor: AuthUser,
  ): Promise<ProductDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const before = await tx.product.findUnique({
        where: { id },
        include: { serviceTypes: { include: { serviceType: true } } },
      });
      if (!before) throw AppException.notFound('Kit', id);
      const { serviceTypeIds, ...data } = input;
      const beforeNames = before.serviceTypes.map((s) => s.serviceType.name);
      let afterNames = beforeNames;
      if (serviceTypeIds) {
        const current = before.serviceTypes.map((s) => s.serviceTypeId);
        afterNames = await this.assertServiceTypes(tx, serviceTypeIds, current);
        await tx.productServiceType.deleteMany({
          where: { productId: id, serviceTypeId: { notIn: serviceTypeIds } },
        });
        await tx.productServiceType.createMany({
          data: serviceTypeIds
            .filter((s) => !current.includes(s))
            .map((serviceTypeId) => ({ tenantId: ctx.tenantId, productId: id, serviceTypeId })),
        });
      }
      const after = await uniqueCode(() => tx.product.update({ where: { id }, data }));
      const changes = compactChanges({
        ...fieldChanges(before, after, PRODUCT_FIELDS),
        serviceTypes: listChange(beforeNames, afterNames),
      });
      if (changes) {
        await labAudit(
          tx,
          ctx,
          actor,
          'lab.product_updated',
          { type: 'product', id, label: label(after) },
          changes,
          serviceTypeIds ?? [],
        );
      }
      return this.product(tx, id);
    });
  }

  setProductBottles(
    ctx: TenantContext,
    id: string,
    lines: Lines,
    actor: AuthUser,
  ): Promise<ProductDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const kit = await tx.product.findUnique({ where: { id }, include: PRODUCT_DETAIL_INCLUDE });
      if (!kit) throw AppException.notFound('Kit', id);
      await this.assertBottleTypes(
        tx,
        lines,
        kit.bottles.map((b) => b.bottleTypeId),
      );
      await tx.productBottle.deleteMany({ where: { productId: id } });
      await tx.productBottle.createMany({
        data: lines.map((l) => ({ tenantId: ctx.tenantId, productId: id, ...l })),
      });
      const after = await this.product(tx, id);
      const change = listChange(describeBottles(kit.bottles), describeBottles(after.bottles));
      if (change) {
        await labAudit(
          tx,
          ctx,
          actor,
          'lab.product_bottles_changed',
          { type: 'product', id, label: label(kit) },
          { bottles: change },
        );
      }
      return after;
    });
  }

  // ─── Variants ─────────────────────────────────────────────────────────────

  addVariant(
    ctx: TenantContext,
    productId: string,
    input: Out<typeof createVariantSchema>,
    actor: AuthUser,
  ): Promise<ProductDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const kit = await tx.product.findUnique({ where: { id: productId } });
      if (!kit) throw AppException.notFound('Kit', productId);
      const variant = await uniqueCode(
        () => tx.productVariant.create({ data: { tenantId: ctx.tenantId, productId, ...input } }),
        'This kit already has a variant with this code',
      );
      await labAudit(
        tx,
        ctx,
        actor,
        'lab.variant_added',
        { type: 'product', id: productId, label: label(kit) },
        { variant: { from: null, to: label(variant) } },
        [variant.id],
      );
      return this.product(tx, productId);
    });
  }

  updateVariant(
    ctx: TenantContext,
    variantId: string,
    input: Out<typeof updateVariantSchema>,
    actor: AuthUser,
  ): Promise<ProductDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const before = await tx.productVariant.findUnique({
        where: { id: variantId },
        include: { product: true },
      });
      if (!before) throw AppException.notFound('Variant', variantId);
      const after = await uniqueCode(
        () => tx.productVariant.update({ where: { id: variantId }, data: input }),
        'This kit already has a variant with this code',
      );
      const changes = fieldChanges(before, after, VARIANT_FIELDS);
      if (Object.keys(changes).length > 0) {
        await labAudit(
          tx,
          ctx,
          actor,
          'lab.variant_updated',
          { type: 'product', id: before.productId, label: label(before.product) },
          { variant: { from: null, to: label(after) }, ...changes },
          [variantId],
        );
      }
      return this.product(tx, before.productId);
    });
  }

  /** An empty list makes the variant use the kit's bottles again. */
  setVariantBottles(
    ctx: TenantContext,
    variantId: string,
    lines: Lines,
    actor: AuthUser,
  ): Promise<ProductDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
        include: { product: true, bottles: { include: { bottleType: true } } },
      });
      if (!variant) throw AppException.notFound('Variant', variantId);
      await this.assertBottleTypes(
        tx,
        lines,
        variant.bottles.map((b) => b.bottleTypeId),
      );
      await tx.variantBottle.deleteMany({ where: { variantId } });
      await tx.variantBottle.createMany({
        data: lines.map((l) => ({ tenantId: ctx.tenantId, variantId, ...l })),
      });
      const after = await this.product(tx, variant.productId);
      const now = after.variants.find((v) => v.id === variantId)!.bottles;
      const describe = (l: typeof variant.bottles | typeof now) =>
        l.length === 0 ? ['(kit bottles)'] : describeBottles(l);
      const change = listChange(describe(variant.bottles), describe(now));
      if (change) {
        await labAudit(
          tx,
          ctx,
          actor,
          'lab.variant_bottles_changed',
          { type: 'product', id: variant.productId, label: label(variant.product) },
          { variant: { from: null, to: label(variant) }, bottles: change },
          [variantId],
        );
      }
      return after;
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async product(tx: TenantTx, id: string): Promise<ProductDto> {
    const row = await tx.product.findUnique({ where: { id }, include: PRODUCT_DETAIL_INCLUDE });
    if (!row) throw AppException.notFound('Kit', id);
    return toProductDto(row);
  }

  /** Service types must exist; newly added ones must be active. Returns all names. */
  private async assertServiceTypes(
    tx: TenantTx,
    ids: string[],
    current: string[],
  ): Promise<string[]> {
    const rows = await tx.serviceType.findMany({ where: { id: { in: ids } } });
    if (rows.length !== ids.length)
      throw fieldError('serviceTypeIds', 'Choose existing service types');
    if (rows.some((r) => !r.isActive && !current.includes(r.id))) {
      throw fieldError('serviceTypeIds', 'Inactive service types cannot be added');
    }
    return rows.map((r) => r.name).sort();
  }

  /** Bottle types must exist; newly added ones must be active. */
  private async assertBottleTypes(tx: TenantTx, lines: Lines, current: string[]): Promise<void> {
    const ids = lines.map((l) => l.bottleTypeId);
    const rows = await tx.bottleType.findMany({ where: { id: { in: ids } } });
    if (rows.length !== ids.length) throw fieldError('bottles', 'Choose existing bottle types');
    if (rows.some((r) => !r.isActive && !current.includes(r.id))) {
      throw fieldError('bottles', 'Inactive bottle types cannot be added');
    }
  }
}
