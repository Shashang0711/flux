import { HttpStatus } from '@nestjs/common';
import {
  Prisma,
  type BottleType,
  type RegistrationField,
  type TestParameter,
} from '@prisma/client';
import {
  ErrorCode,
  type BottleLineDto,
  type CustomFieldOption,
  type ProductDto,
  type ProductSummaryDto,
  type RegistrationFieldDto,
  type ServiceTypeDto,
  type ServiceTypeSummaryDto,
  type TestParameterDto,
} from '@flux/shared';
import { AppException } from '../../common/errors/app.exception';

export function fieldError(path: string, message: string): AppException {
  return new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    'Request validation failed',
    [{ path, message }],
  );
}

/** Runs a write; a unique violation (duplicate code or key) becomes a field error. */
export async function uniqueCode<T>(
  fn: () => Promise<T>,
  message = 'This code is already in use',
  path = 'code',
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw fieldError(path, message);
    }
    throw error;
  }
}

const REF = { select: { id: true, code: true, name: true, isActive: true } } as const;

// ─── Registration fields ────────────────────────────────────────────────────

/** Batch fields first, then sample fields; each by sort order, then label. */
export const FIELD_ORDER: Prisma.RegistrationFieldOrderByWithRelationInput[] = [
  { scope: 'asc' },
  { sortOrder: 'asc' },
  { label: 'asc' },
];

export function toFieldDto(f: RegistrationField): RegistrationFieldDto {
  return {
    id: f.id,
    key: f.key,
    label: f.label,
    type: f.type,
    scope: f.scope,
    required: f.required,
    helpText: f.helpText,
    options: f.options as unknown as CustomFieldOption[],
    sortOrder: f.sortOrder,
    isActive: f.isActive,
  };
}

// ─── Test parameters ────────────────────────────────────────────────────────

export const PARAMETER_ORDER: Prisma.TestParameterOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { name: 'asc' },
];

export function toParameterDto(p: TestParameter): TestParameterDto {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    unit: p.unit,
    type: p.type,
    decimals: p.decimals,
    method: p.method,
    options: p.options as string[],
    cautionMin: p.cautionMin,
    cautionMax: p.cautionMax,
    criticalMin: p.criticalMin,
    criticalMax: p.criticalMax,
    required: p.required,
    sortOrder: p.sortOrder,
    isActive: p.isActive,
  };
}

// ─── Service types ──────────────────────────────────────────────────────────

export const SERVICE_TYPE_SUMMARY_INCLUDE = {
  category: REF,
  _count: { select: { fields: { where: { isActive: true } }, products: true } },
} satisfies Prisma.ServiceTypeInclude;

export const SERVICE_TYPE_DETAIL_INCLUDE = {
  ...SERVICE_TYPE_SUMMARY_INCLUDE,
  fields: { orderBy: FIELD_ORDER },
  parameters: { orderBy: PARAMETER_ORDER },
  products: { include: { product: REF }, orderBy: { product: { name: 'asc' } } },
} satisfies Prisma.ServiceTypeInclude;

type ServiceTypeSummaryRow = Prisma.ServiceTypeGetPayload<{
  include: typeof SERVICE_TYPE_SUMMARY_INCLUDE;
}>;
type ServiceTypeDetailRow = Prisma.ServiceTypeGetPayload<{
  include: typeof SERVICE_TYPE_DETAIL_INCLUDE;
}>;

export function toServiceTypeSummaryDto(s: ServiceTypeSummaryRow): ServiceTypeSummaryDto {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    category: s.category,
    sortOrder: s.sortOrder,
    isActive: s.isActive,
    vesselRequired: s.vesselRequired,
    fieldCount: s._count.fields,
    productCount: s._count.products,
  };
}

export function toServiceTypeDto(s: ServiceTypeDetailRow): ServiceTypeDto {
  return {
    ...toServiceTypeSummaryDto(s),
    description: s.description,
    fields: s.fields.map(toFieldDto),
    parameters: s.parameters.map(toParameterDto),
    products: s.products.map((p) => p.product),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// ─── Kits ───────────────────────────────────────────────────────────────────

const BOTTLE_LINES = {
  include: {
    bottleType: { select: { id: true, code: true, name: true, volumeMl: true, isActive: true } },
  },
  orderBy: { bottleType: { volumeMl: 'desc' } },
} as const;

export const PRODUCT_SUMMARY_INCLUDE = {
  serviceTypes: { include: { serviceType: REF }, orderBy: { serviceType: { name: 'asc' } } },
  _count: { select: { variants: { where: { isActive: true } } } },
} satisfies Prisma.ProductInclude;

export const PRODUCT_DETAIL_INCLUDE = {
  ...PRODUCT_SUMMARY_INCLUDE,
  bottles: BOTTLE_LINES,
  variants: {
    include: { bottles: BOTTLE_LINES },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  },
} satisfies Prisma.ProductInclude;

type ProductSummaryRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_SUMMARY_INCLUDE }>;
type ProductDetailRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_DETAIL_INCLUDE }>;

function toLines(
  rows: { quantity: number; bottleType: BottleLineDto['bottleType'] }[],
): BottleLineDto[] {
  return rows.map((r) => ({ bottleType: r.bottleType, quantity: r.quantity }));
}

export function toProductSummaryDto(p: ProductSummaryRow): ProductSummaryDto {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    isActive: p.isActive,
    serviceTypes: p.serviceTypes.map((s) => s.serviceType),
    variantCount: p._count.variants,
  };
}

export function toProductDto(p: ProductDetailRow): ProductDto {
  const kitBottles = toLines(p.bottles);
  return {
    ...toProductSummaryDto(p),
    description: p.description,
    bottles: kitBottles,
    variants: p.variants.map((v) => {
      const own = toLines(v.bottles);
      return {
        id: v.id,
        code: v.code,
        name: v.name,
        isActive: v.isActive,
        bottles: own,
        effectiveBottles: own.length > 0 ? own : kitBottles,
      };
    }),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** "2 × 250 ml PET bottle" lines, for audit entries. */
export function describeBottles(
  lines: { quantity: number; bottleType: Pick<BottleType, 'name'> }[],
): string[] {
  return lines.map((l) => `${l.quantity} × ${l.bottleType.name}`);
}
