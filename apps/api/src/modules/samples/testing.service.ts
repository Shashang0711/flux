import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma, SampleResult, TestParameter } from '@prisma/client';
import {
  ErrorCode,
  flagFor,
  formatResultValue,
  parseResultValue,
  worstFlag,
  type BatchResultsDto,
  type FieldIssue,
  type ResultValue,
  type SampleResultDto,
  type SampleResultsDto,
} from '@flux/shared';
import { AppException } from '../../common/errors/app.exception';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import { recordAudit } from '../audit/audit';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { PARAMETER_ORDER, toParameterDto } from '../lab/lab.mapper';

type Entry = { parameterId: string; value: string | number | boolean | null };
type ResultRow = SampleResult & { enteredBy: { name: string } | null };

const RESULT_INCLUDE = { enteredBy: { select: { name: true } } } as const;

/** Thrown inside a transaction to roll back a dry run and hand back its result. */
class DryRun<T> extends Error {
  constructor(readonly result: T) {
    super('dry run');
  }
}

function invalid(message: string, details: FieldIssue[]): AppException {
  return new AppException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, message, details);
}

const stored = (r: SampleResult): ResultValue =>
  r.valueNumber ?? r.valueBoolean ?? r.valueText ?? '';

function toResultDto(r: ResultRow): SampleResultDto {
  return {
    parameterId: r.parameterId,
    value: stored(r),
    flag: r.flag,
    enteredAt: r.enteredAt.toISOString(),
    enteredBy: r.enteredBy?.name ?? null,
  };
}

/**
 * Under Testing (design pack §8): structured results per test parameter, entered per sample
 * (individual view) or per batch (grid or CSV). Values are parsed and flagged with the shared
 * parseResultValue/flagFor, so the browser preview and the API agree. Saving a result moves a
 * sample to UNDER_TESTING; completing needs every required parameter and locks the results until
 * they are reopened.
 */
@Injectable()
export class TestingService {
  constructor(private readonly db: TenantDb) {}

  // ─── Individual sample ────────────────────────────────────────────────────

  sampleResults(ctx: TenantContext, sampleId: string): Promise<SampleResultsDto> {
    return this.db.run(ctx.tenantId, (tx) => this.sampleDto(tx, sampleId));
  }

  saveSampleResults(
    ctx: TenantContext,
    user: AuthUser,
    sampleId: string,
    entries: Entry[],
  ): Promise<SampleResultsDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const sample = await this.findSample(tx, sampleId);
      const params = await this.parameters(tx, sample.serviceTypeId);
      const issues: FieldIssue[] = [];
      await this.apply(tx, ctx, user, sample, params, entries, '', issues);
      if (issues.length > 0) throw invalid('Some results are not valid', issues);
      return this.sampleDto(tx, sampleId);
    });
  }

  /** RESULTS_ENTERED: every required active parameter has a value; results are then locked. */
  completeSample(ctx: TenantContext, user: AuthUser, sampleId: string): Promise<SampleResultsDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const dto = await this.sampleDto(tx, sampleId);
      if (dto.status === 'RESULTS_ENTERED') return dto;
      if (dto.results.length === 0)
        throw AppException.badRequest('Enter results before completing them');
      if (dto.missingRequired.length > 0) {
        throw AppException.badRequest(
          `Required results are missing: ${dto.missingRequired.join(', ')}`,
        );
      }
      await this.setCompleted(tx, ctx, user, [sampleId], true);
      return this.sampleDto(tx, sampleId);
    });
  }

  reopenSample(ctx: TenantContext, user: AuthUser, sampleId: string): Promise<SampleResultsDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const sample = await this.findSample(tx, sampleId);
      if (sample.status === 'RESULTS_ENTERED')
        await this.setCompleted(tx, ctx, user, [sampleId], false);
      return this.sampleDto(tx, sampleId);
    });
  }

  // ─── Batch ────────────────────────────────────────────────────────────────

  batchResults(ctx: TenantContext, batchId: string): Promise<BatchResultsDto> {
    return this.db.run(ctx.tenantId, (tx) => this.batchDto(tx, batchId));
  }

  /**
   * Saves results for several samples of the batch, all or nothing. Error paths:
   * samples.<n>.<parameter key>. With dryRun the changes are made, read back and rolled back,
   * so the preview shows exactly what saving would.
   */
  async saveBatchResults(
    ctx: TenantContext,
    user: AuthUser,
    batchId: string,
    input: { sampleId: string; results: Entry[] }[],
    dryRun: boolean,
  ): Promise<BatchResultsDto> {
    try {
      return await this.db.run(ctx.tenantId, async (tx) => {
        const batch = await tx.registrationBatch.findUnique({ where: { id: batchId } });
        if (!batch) throw AppException.notFound('Batch', batchId);
        const params = await this.parameters(tx, batch.serviceTypeId);
        const samples = await tx.sample.findMany({ where: { batchId } });
        const issues: FieldIssue[] = [];
        for (const [i, row] of input.entries()) {
          const sample = samples.find((s) => s.id === row.sampleId);
          if (!sample) {
            issues.push({ path: `samples.${i}`, message: 'This sample is not in the batch' });
            continue;
          }
          await this.apply(tx, ctx, user, sample, params, row.results, `samples.${i}.`, issues);
        }
        if (issues.length > 0) throw invalid('Some results are not valid', issues);
        const dto = await this.batchDto(tx, batchId);
        if (dryRun) throw new DryRun(dto);
        return dto;
      });
    } catch (error) {
      if (error instanceof DryRun) return error.result as BatchResultsDto;
      throw error;
    }
  }

  /** The lab picks up the batch: its registered samples go UNDER_TESTING. */
  startTesting(ctx: TenantContext, user: AuthUser, batchId: string): Promise<BatchResultsDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const batch = await tx.registrationBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw AppException.notFound('Batch', batchId);
      const waiting = await tx.sample.findMany({ where: { batchId, status: 'REGISTERED' } });
      if (waiting.length > 0) {
        await tx.sample.updateMany({
          where: { id: { in: waiting.map((s) => s.id) } },
          data: { status: 'UNDER_TESTING', testingStartedAt: new Date() },
        });
        await recordAudit(tx, {
          tenantId: ctx.tenantId,
          actor: user,
          action: 'sample.testing_started',
          entity: { type: 'batch', id: batch.id, label: batch.code },
          relatedIds: waiting.map((s) => s.id),
          changes: { samples: { added: waiting.map((s) => s.code), removed: [] } },
        });
      }
      return this.batchDto(tx, batchId);
    });
  }

  /** Completes every open sample of the batch; all must have their required results. */
  completeBatch(ctx: TenantContext, user: AuthUser, batchId: string): Promise<BatchResultsDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const dto = await this.batchDto(tx, batchId);
      const open = dto.samples.filter((s) => s.status !== 'RESULTS_ENTERED');
      const issues: FieldIssue[] = [];
      dto.samples.forEach((s, i) => {
        if (s.status === 'RESULTS_ENTERED') return;
        if (s.results.length === 0)
          issues.push({ path: `samples.${i}`, message: `${s.code}: no results yet` });
        else if (s.missingRequired.length > 0) {
          issues.push({
            path: `samples.${i}`,
            message: `${s.code}: missing ${s.missingRequired.join(', ')}`,
          });
        }
      });
      if (issues.length > 0) throw invalid('Some samples are not complete', issues);
      if (open.length > 0)
        await this.setCompleted(
          tx,
          ctx,
          user,
          open.map((s) => s.id),
          true,
        );
      return this.batchDto(tx, batchId);
    });
  }

  // ─── Core ─────────────────────────────────────────────────────────────────

  /** Validates and saves one sample's entries; problems go to `issues` (nothing saved then). */
  private async apply(
    tx: TenantTx,
    ctx: TenantContext,
    user: AuthUser,
    sample: { id: string; code: string; batchId: string; serviceTypeId: string; status: string },
    params: TestParameter[],
    entries: Entry[],
    prefix: string,
    issues: FieldIssue[],
  ): Promise<void> {
    if (entries.length === 0) return;
    if (sample.status === 'RESULTS_ENTERED') {
      issues.push({
        path: prefix ? prefix.slice(0, -1) : 'results',
        message: `Results of ${sample.code} are completed; reopen them to make changes`,
      });
      return;
    }
    const existing = await tx.sampleResult.findMany({ where: { sampleId: sample.id } });
    const planned: {
      param: TestParameter;
      value: ResultValue | null;
      before: SampleResult | undefined;
    }[] = [];
    const before = issues.length;
    for (const entry of entries) {
      const param = params.find((p) => p.id === entry.parameterId);
      if (!param) {
        issues.push({
          path: `${prefix}${entry.parameterId}`,
          message: 'Unknown parameter for this service type',
        });
        continue;
      }
      const parsed = parseResultValue(
        {
          type: param.type,
          decimals: param.decimals,
          options: param.options as string[],
          name: param.name,
        },
        entry.value,
      );
      if ('error' in parsed) {
        issues.push({ path: `${prefix}${param.key}`, message: parsed.error });
        continue;
      }
      const old = existing.find((r) => r.parameterId === param.id);
      if (!param.isActive && parsed.value !== null && (!old || stored(old) !== parsed.value)) {
        issues.push({
          path: `${prefix}${param.key}`,
          message: `${param.name} is no longer in use`,
        });
        continue;
      }
      planned.push({ param, value: parsed.value, before: old });
    }
    if (issues.length > before) return;

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const { param, value, before: old } of planned) {
      const fmt = (v: ResultValue | null | undefined) =>
        v === null || v === undefined
          ? null
          : formatResultValue({ type: param.type, decimals: param.decimals }, v);
      if ((old ? stored(old) : null) === value) continue;
      changes[param.name] = { from: fmt(old ? stored(old) : null), to: fmt(value) };
      if (value === null) {
        await tx.sampleResult.deleteMany({ where: { sampleId: sample.id, parameterId: param.id } });
        continue;
      }
      const data = {
        valueNumber: typeof value === 'number' ? value : null,
        valueBoolean: typeof value === 'boolean' ? value : null,
        valueText: typeof value === 'string' ? value : null,
        flag: flagFor(
          {
            type: param.type,
            cautionMin: param.cautionMin,
            cautionMax: param.cautionMax,
            criticalMin: param.criticalMin,
            criticalMax: param.criticalMax,
          },
          value,
        ),
        enteredAt: new Date(),
        enteredById: user.id,
      };
      await tx.sampleResult.upsert({
        where: { sampleId_parameterId: { sampleId: sample.id, parameterId: param.id } },
        create: {
          tenantId: ctx.tenantId,
          sampleId: sample.id,
          serviceTypeId: sample.serviceTypeId,
          parameterId: param.id,
          ...data,
        },
        update: data,
      });
    }
    if (Object.keys(changes).length === 0) return;
    if (sample.status === 'REGISTERED') {
      await tx.sample.update({
        where: { id: sample.id },
        data: { status: 'UNDER_TESTING', testingStartedAt: new Date() },
      });
    }
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      actor: user,
      action: 'sample.results_saved',
      entity: { type: 'sample', id: sample.id, label: sample.code },
      relatedIds: [sample.batchId],
      changes,
    });
  }

  private async setCompleted(
    tx: TenantTx,
    ctx: TenantContext,
    user: AuthUser,
    ids: string[],
    completed: boolean,
  ): Promise<void> {
    const samples = await tx.sample.findMany({ where: { id: { in: ids } } });
    await tx.sample.updateMany({
      where: { id: { in: ids } },
      data: completed
        ? { status: 'RESULTS_ENTERED', resultsCompletedAt: new Date() }
        : { status: 'UNDER_TESTING', resultsCompletedAt: null },
    });
    for (const s of samples) {
      await recordAudit(tx, {
        tenantId: ctx.tenantId,
        actor: user,
        action: completed ? 'sample.results_completed' : 'sample.results_reopened',
        entity: { type: 'sample', id: s.id, label: s.code },
        relatedIds: [s.batchId],
        changes: {
          status: {
            from: s.status,
            to: completed ? 'RESULTS_ENTERED' : 'UNDER_TESTING',
          },
        },
      });
    }
  }

  // ─── Reading ──────────────────────────────────────────────────────────────

  private parameters(tx: TenantTx, serviceTypeId: string) {
    return tx.testParameter.findMany({ where: { serviceTypeId }, orderBy: PARAMETER_ORDER });
  }

  private async findSample(tx: TenantTx, id: string) {
    const sample = await tx.sample.findUnique({ where: { id } });
    if (!sample) throw AppException.notFound('Sample', id);
    return sample;
  }

  /** Active parameters, plus inactive ones that still have a result in `results`. */
  private visible(params: TestParameter[], results: { parameterId: string }[]) {
    return params.filter((p) => p.isActive || results.some((r) => r.parameterId === p.id));
  }

  private missing(params: TestParameter[], results: { parameterId: string }[]): string[] {
    return params
      .filter((p) => p.isActive && p.required && !results.some((r) => r.parameterId === p.id))
      .map((p) => p.name);
  }

  private async sampleDto(tx: TenantTx, sampleId: string): Promise<SampleResultsDto> {
    const sample = await tx.sample.findUnique({
      where: { id: sampleId },
      include: { results: { include: RESULT_INCLUDE } },
    });
    if (!sample) throw AppException.notFound('Sample', sampleId);
    const params = await this.parameters(tx, sample.serviceTypeId);
    return {
      sampleId,
      status: sample.status,
      parameters: this.visible(params, sample.results).map(toParameterDto),
      results: sample.results.map(toResultDto),
      worstFlag: worstFlag(sample.results.map((r) => r.flag)),
      missingRequired: this.missing(params, sample.results),
    };
  }

  private async batchDto(tx: TenantTx, batchId: string): Promise<BatchResultsDto> {
    const batch = await tx.registrationBatch.findUnique({
      where: { id: batchId },
      include: {
        samples: {
          include: {
            results: { include: RESULT_INCLUDE },
            receivedKit: { select: { code: true, serialNumber: true } },
            vessel: { select: { name: true } },
          },
          orderBy: { code: 'asc' },
        } satisfies Prisma.RegistrationBatch$samplesArgs,
      },
    });
    if (!batch) throw AppException.notFound('Batch', batchId);
    const params = await this.parameters(tx, batch.serviceTypeId);
    const allResults = batch.samples.flatMap((s) => s.results);
    return {
      batchId,
      batchCode: batch.code,
      parameters: this.visible(params, allResults).map(toParameterDto),
      samples: batch.samples.map((s) => ({
        id: s.id,
        code: s.code,
        status: s.status,
        kit: s.receivedKit,
        vessel: s.vessel?.name ?? null,
        results: s.results.map(toResultDto),
        worstFlag: worstFlag(s.results.map((r) => r.flag)),
        missingRequired: this.missing(params, s.results),
      })),
    };
  }
}
