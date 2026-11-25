import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ErrorCode,
  formatBatchCode,
  formatSampleCode,
  type BatchDto,
  type BatchSummaryDto,
  type FieldIssue,
  type PageQuery,
  type RegistrationDraftDto,
  type SampleDto,
  type SampleListQuery,
  type SampleSummaryDto,
  type batchListQuerySchema,
  type registerBatchSchema,
} from '@flux/shared';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import { Paginated, toSkipTake } from '../../common/pagination/pagination';
import { nextSequence } from '../../database/sequences';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import { recordAudit } from '../audit/audit';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { validateRegistration } from '../lab/catalogue.service';
import { FIELD_ORDER, toFieldDto } from '../lab/lab.mapper';
import { KIT_INCLUDE, toKitDto, type KitRow } from '../receiving/receiving.mapper';
import { ReceivingService } from '../receiving/receiving.service';
import {
  BATCH_SUMMARY_INCLUDE,
  SAMPLE_INCLUDE,
  toBatchSummaryDto,
  toSampleSummaryDto,
  values,
} from './samples.mapper';

type Out<T extends z.ZodType> = z.output<T>;

function invalid(message: string, details: FieldIssue[]): AppException {
  return new AppException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, message, details);
}

/**
 * Batch registration (design pack §8, §20) and the batch/sample records it creates. A batch has
 * one service type; each received kit becomes one sample. Registration is one transaction, and a
 * kit is claimed with a conditional update, so two users registering the same kit cannot both
 * succeed.
 */
@Injectable()
export class SamplesService {
  constructor(
    private readonly db: TenantDb,
    private readonly receiving: ReceivingService,
  ) {}

  // ─── Registration ─────────────────────────────────────────────────────────

  /** The chosen kits, the service types they can all be registered for, clients and vessels. */
  async draft(ctx: TenantContext, user: AuthUser, kitIds: string[]): Promise<RegistrationDraftDto> {
    const options = await this.receiving.options(ctx, user);
    return this.db.run(ctx.tenantId, async (tx) => {
      const kits = await this.loadKits(tx, kitIds);
      const unavailable = kits.filter((k) => k.status !== 'PENDING_REGISTRATION');
      if (unavailable.length > 0) {
        throw AppException.conflict(
          `${unavailable.map((k) => k.code).join(', ')} ${unavailable.length === 1 ? 'is' : 'are'} no longer waiting for registration`,
        );
      }
      // Service types every kit can take: its chosen one, or any active one of its kit type.
      const allowed = kits.map((k) =>
        k.serviceTypeId
          ? new Set([k.serviceTypeId])
          : new Set(
              k.product.serviceTypes
                .filter((s) => s.serviceType.isActive && s.serviceType.category.isActive)
                .map((s) => s.serviceTypeId),
            ),
      );
      const common = [...allowed[0]!].filter((id) => allowed.every((set) => set.has(id)));
      const serviceTypes = await tx.serviceType.findMany({
        where: { id: { in: common }, isActive: true, category: { isActive: true } },
        include: { fields: { where: { isActive: true }, orderBy: FIELD_ORDER } },
        orderBy: { name: 'asc' },
      });
      return {
        kits: kits.map(toKitDto),
        serviceTypes: serviceTypes.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          vesselRequired: s.vesselRequired,
          fields: s.fields.map(toFieldDto),
        })),
        clients: options.clients,
        vessels: options.vessels,
      };
    });
  }

  register(
    ctx: TenantContext,
    user: AuthUser,
    input: Out<typeof registerBatchSchema>,
  ): Promise<BatchDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const st = await tx.serviceType.findUnique({
        where: { id: input.serviceTypeId },
        include: { category: true, fields: { orderBy: FIELD_ORDER } },
      });
      if (!st || !st.isActive || !st.category.isActive) {
        throw invalid('Request validation failed', [
          { path: 'serviceTypeId', message: 'Choose an active service type' },
        ]);
      }
      const kits = await this.loadKits(
        tx,
        input.samples.map((s) => s.kitId),
      );
      const byId = new Map(kits.map((k) => [k.id, k]));

      const taken = kits.filter((k) => k.status !== 'PENDING_REGISTRATION');
      if (taken.length > 0) {
        throw AppException.conflict(
          `${taken.map((k) => k.code).join(', ')} ${taken.length === 1 ? 'is' : 'are'} no longer waiting for registration`,
        );
      }

      // Kit, client and vessel checks for every sample, reported together with value errors.
      const issues: FieldIssue[] = [];
      const links = await Promise.all(
        input.samples.map((s, i) =>
          this.resolveSample(tx, user, st, byId.get(s.kitId)!, s, i, issues),
        ),
      );
      let checked: { batch: Record<string, unknown>; samples: Record<string, unknown>[] } | null =
        null;
      try {
        checked = validateRegistration(st.fields.map(toFieldDto), {
          batch: input.values,
          samples: input.samples.map((s) => s.values),
        });
      } catch (error) {
        if (!(error instanceof AppException)) throw error;
        if (Array.isArray(error.details)) issues.push(...error.details);
      }
      if (issues.length > 0 || !checked) {
        throw invalid('Some registration details are missing or invalid', issues);
      }

      // Claim each kit: only a kit still waiting can be registered (row lock + condition).
      for (const [i, s] of input.samples.entries()) {
        const claimed = await tx.receivedKit.updateMany({
          where: { id: s.kitId, status: 'PENDING_REGISTRATION' },
          data: {
            status: 'REGISTERED',
            serviceTypeId: st.id,
            clientId: links[i]!.clientId,
            vesselId: links[i]!.vesselId,
          },
        });
        if (claimed.count !== 1) {
          throw AppException.conflict(
            `${byId.get(s.kitId)!.code} was registered by someone else in the meantime`,
          );
        }
      }

      const year = new Date().getUTCFullYear();
      const batch = await tx.registrationBatch.create({
        data: {
          tenantId: ctx.tenantId,
          code: formatBatchCode(year, await nextSequence(tx, ctx.tenantId, `batch:${year}`)),
          serviceTypeId: st.id,
          values: checked.batch as Prisma.InputJsonValue,
          notes: input.notes ?? null,
          registeredById: user.id,
        },
      });
      const sampleCodes: string[] = [];
      for (const [i, s] of input.samples.entries()) {
        const code = formatSampleCode(year, await nextSequence(tx, ctx.tenantId, `sample:${year}`));
        sampleCodes.push(code);
        await tx.sample.create({
          data: {
            tenantId: ctx.tenantId,
            code,
            batchId: batch.id,
            serviceTypeId: st.id,
            receivedKitId: s.kitId,
            clientId: links[i]!.clientId,
            vesselId: links[i]!.vesselId,
            values: checked.samples[i] as Prisma.InputJsonValue,
          },
        });
      }
      await recordAudit(tx, {
        tenantId: ctx.tenantId,
        actor: user,
        action: 'sample.batch_registered',
        entity: { type: 'batch', id: batch.id, label: batch.code },
        relatedIds: [
          ...kits.map((k) => k.id),
          ...links.flatMap((l) => [l.clientId, l.vesselId]).filter((x): x is string => Boolean(x)),
        ],
        changes: {
          serviceType: { from: null, to: st.name },
          samples: { added: sampleCodes, removed: [] },
          kits: { added: input.samples.map((s) => byId.get(s.kitId)!.code), removed: [] },
        },
      });
      return this.batch(tx, batch.id);
    });
  }

  // ─── Reading ──────────────────────────────────────────────────────────────

  listBatches(
    ctx: TenantContext,
    query: Out<typeof batchListQuerySchema>,
    page: PageQuery,
  ): Promise<Paginated<BatchSummaryDto>> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const where: Prisma.RegistrationBatchWhereInput = {
        ...(query.serviceTypeId ? { serviceTypeId: query.serviceTypeId } : {}),
        ...(query.q ? { code: { contains: query.q, mode: 'insensitive' } } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.registrationBatch.findMany({
          where,
          include: BATCH_SUMMARY_INCLUDE,
          orderBy: { registeredAt: 'desc' },
          ...toSkipTake(page),
        }),
        tx.registrationBatch.count({ where }),
      ]);
      return new Paginated(rows.map(toBatchSummaryDto), total, page);
    });
  }

  getBatch(ctx: TenantContext, id: string): Promise<BatchDto> {
    return this.db.run(ctx.tenantId, (tx) => this.batch(tx, id));
  }

  listSamples(
    ctx: TenantContext,
    query: SampleListQuery,
    page: PageQuery,
  ): Promise<Paginated<SampleSummaryDto>> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const where: Prisma.SampleWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.serviceTypeId ? { serviceTypeId: query.serviceTypeId } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.vesselId ? { vesselId: query.vesselId } : {}),
        ...(query.batchId ? { batchId: query.batchId } : {}),
        ...(query.q
          ? {
              OR: [
                { code: { contains: query.q, mode: 'insensitive' } },
                { batch: { code: { contains: query.q, mode: 'insensitive' } } },
                { receivedKit: { code: { contains: query.q, mode: 'insensitive' } } },
                { receivedKit: { serialNumber: { contains: query.q, mode: 'insensitive' } } },
                { vessel: { name: { contains: query.q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.sample.findMany({
          where,
          include: SAMPLE_INCLUDE,
          orderBy: [{ registeredAt: 'desc' }, { code: 'desc' }],
          ...toSkipTake(page),
        }),
        tx.sample.count({ where }),
      ]);
      return new Paginated(rows.map(toSampleSummaryDto), total, page);
    });
  }

  getSample(ctx: TenantContext, id: string): Promise<SampleDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const s = await tx.sample.findUnique({
        where: { id },
        include: {
          ...SAMPLE_INCLUDE,
          batch: {
            select: {
              id: true,
              code: true,
              values: true,
              registeredBy: { select: { name: true } },
            },
          },
        },
      });
      if (!s) throw AppException.notFound('Sample', id);
      const fields = await tx.registrationField.findMany({
        where: { serviceTypeId: s.serviceTypeId },
        orderBy: FIELD_ORDER,
      });
      return {
        ...toSampleSummaryDto({ ...s, batch: { id: s.batch.id, code: s.batch.code } }),
        values: values(s.values),
        batchValues: values(s.batch.values),
        fields: fields.map(toFieldDto),
        airwayBill: s.receivedKit.airwayBill,
        registeredBy: s.batch.registeredBy?.name ?? null,
      };
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async batch(tx: TenantTx, id: string): Promise<BatchDto> {
    const b = await tx.registrationBatch.findUnique({
      where: { id },
      include: {
        ...BATCH_SUMMARY_INCLUDE,
        samples: { include: SAMPLE_INCLUDE, orderBy: { code: 'asc' } },
      },
    });
    if (!b) throw AppException.notFound('Batch', id);
    const fields = await tx.registrationField.findMany({
      where: { serviceTypeId: b.serviceTypeId },
      orderBy: FIELD_ORDER,
    });
    return {
      ...toBatchSummaryDto(b),
      values: values(b.values),
      notes: b.notes,
      fields: fields.map(toFieldDto),
      samples: b.samples.map((s) => ({ ...toSampleSummaryDto(s), values: values(s.values) })),
    };
  }

  private async loadKits(tx: TenantTx, ids: string[]) {
    const kits = await tx.receivedKit.findMany({
      where: { id: { in: ids } },
      include: {
        ...KIT_INCLUDE,
        product: {
          select: {
            id: true,
            code: true,
            name: true,
            serviceTypes: { include: { serviceType: { include: { category: true } } } },
          },
        },
      },
    });
    if (kits.length !== ids.length) {
      throw invalid('Request validation failed', [
        { path: 'samples', message: 'Some kits were not found' },
      ]);
    }
    // Keep the order the kits were chosen in.
    return ids.map((id) => kits.find((k) => k.id === id)!);
  }

  /**
   * Final client and vessel of one sample: as sent, else as received. A vessel without a
   * client gets its primary client. Problems are added to `issues` with the sample's path.
   */
  private async resolveSample(
    tx: TenantTx,
    user: AuthUser,
    st: { id: string; name: string; vesselRequired: boolean },
    kit: KitRow & { product: { serviceTypes: { serviceTypeId: string }[] } },
    input: { clientId?: string | null; vesselId?: string | null },
    i: number,
    issues: FieldIssue[],
  ): Promise<{ clientId: string; vesselId: string | null }> {
    const path = (f: string) => `samples.${i}.${f}`;
    if (kit.serviceTypeId && kit.serviceTypeId !== st.id) {
      issues.push({
        path: path('kitId'),
        message: `${kit.code} was received for ${kit.serviceType?.name}`,
      });
    } else if (!kit.product.serviceTypes.some((s) => s.serviceTypeId === st.id)) {
      issues.push({
        path: path('kitId'),
        message: `${kit.product.name} is not used for ${st.name}`,
      });
    }
    const vesselId = input.vesselId !== undefined ? input.vesselId : kit.vesselId;
    let clientId = input.clientId !== undefined ? input.clientId : kit.clientId;

    if (vesselId) {
      const vessel = await tx.vessel.findUnique({
        where: { id: vesselId },
        include: { relationships: { where: { status: 'ACTIVE' } } },
      });
      if (!vessel || !user.modules.includes('vessels')) {
        issues.push({ path: path('vesselId'), message: 'Choose an existing vessel' });
      } else {
        if (vessel.status !== 'ACTIVE' && vesselId !== kit.vesselId) {
          issues.push({ path: path('vesselId'), message: 'This vessel is inactive' });
        }
        if (!clientId) clientId = vessel.relationships.find((r) => r.isPrimary)?.clientId ?? null;
        if (clientId && !vessel.relationships.some((r) => r.clientId === clientId)) {
          issues.push({
            path: path('clientId'),
            message: 'This vessel is not linked to that client',
          });
        }
      }
    } else if (st.vesselRequired) {
      issues.push({ path: path('vesselId'), message: `${st.name} samples need a vessel` });
    }
    if (!clientId) {
      issues.push({ path: path('clientId'), message: 'Choose the client' });
    } else if (clientId !== kit.clientId) {
      const client = await tx.client.findUnique({ where: { id: clientId } });
      if (!client || !user.modules.includes('clients')) {
        issues.push({ path: path('clientId'), message: 'Choose an existing client' });
      } else if (client.status !== 'ACTIVE') {
        issues.push({ path: path('clientId'), message: 'This client is inactive' });
      }
    }
    return { clientId: clientId ?? '', vesselId: vesselId ?? null };
  }
}
