import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  airwayBillListQuerySchema,
  cancelReceivedKitSchema,
  createAirwayBillSchema,
  receiveKitSchema,
  registrationQueueQuerySchema,
  updateAirwayBillSchema,
  updateReceivedKitSchema,
  type AirwayBillDto,
  type AirwayBillSummaryDto,
  type PageQuery,
  type ReceivedKitDto,
  type ReceivingOptionsDto,
  type RegistrationQueueQuery,
} from '@flux/shared';
import type { z } from 'zod';
import { Paginated, pageQuerySchema } from '../../common/pagination/pagination';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { CurrentTenant, CurrentUser, RequireModule, RequirePermission } from '../auth/decorators';
import { ReceivingService } from './receiving.service';

const body = <T extends z.ZodType>(schema: T) => Body(new ZodValidationPipe(schema));
const uuid = (name = 'id') => Param(name, ParseUUIDPipe);
type Out<T extends z.ZodType> = z.output<T>;

const awbListQuery = pageQuerySchema.extend(airwayBillListQuerySchema.shape);
const queueQuery = pageQuerySchema.extend(registrationQueueQuerySchema.shape);

/**
 * Sample Receiving module: reads need receiving.view, receiving kits and changing AWBs need
 * receiving.receive.
 */
@Controller('receiving')
@RequireModule('receiving')
@RequirePermission('receiving.view')
export class ReceivingController {
  constructor(private readonly receiving: ReceivingService) {}

  /** Kits, clients and vessels for the receiving form (no other module permissions needed). */
  @Get('options')
  options(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
  ): Promise<ReceivingOptionsDto> {
    return this.receiving.options(t, u);
  }

  @Get('airway-bills')
  airwayBills(
    @CurrentTenant() t: TenantContext,
    @Query(new ZodValidationPipe(awbListQuery))
    q: PageQuery & Out<typeof airwayBillListQuerySchema>,
  ): Promise<Paginated<AirwayBillSummaryDto>> {
    return this.receiving.listAirwayBills(t, q, q);
  }

  @Get('airway-bills/:id')
  airwayBill(@CurrentTenant() t: TenantContext, @uuid() id: string): Promise<AirwayBillDto> {
    return this.receiving.getAirwayBill(t, id);
  }

  @Post('airway-bills')
  @RequirePermission('receiving.receive')
  createAirwayBill(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @body(createAirwayBillSchema) input: Out<typeof createAirwayBillSchema>,
  ): Promise<AirwayBillDto> {
    return this.receiving.createAirwayBill(t, input, u);
  }

  @Patch('airway-bills/:id')
  @RequirePermission('receiving.receive')
  updateAirwayBill(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @body(updateAirwayBillSchema) input: Out<typeof updateAirwayBillSchema>,
  ): Promise<AirwayBillDto> {
    return this.receiving.updateAirwayBill(t, id, input, u);
  }

  @Post('airway-bills/:id/close')
  @RequirePermission('receiving.receive')
  close(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
  ): Promise<AirwayBillDto> {
    return this.receiving.setAirwayBillOpen(t, id, false, u);
  }

  @Post('airway-bills/:id/reopen')
  @RequirePermission('receiving.receive')
  reopen(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
  ): Promise<AirwayBillDto> {
    return this.receiving.setAirwayBillOpen(t, id, true, u);
  }

  @Post('airway-bills/:id/kits')
  @RequirePermission('receiving.receive')
  receiveKit(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @body(receiveKitSchema) input: Out<typeof receiveKitSchema>,
  ): Promise<ReceivedKitDto> {
    return this.receiving.receiveKit(t, id, input, u);
  }

  @Get('kits/:id')
  kit(@CurrentTenant() t: TenantContext, @uuid() id: string): Promise<ReceivedKitDto> {
    return this.receiving.getKit(t, id);
  }

  @Patch('kits/:id')
  @RequirePermission('receiving.receive')
  updateKit(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @body(updateReceivedKitSchema) input: Out<typeof updateReceivedKitSchema>,
  ): Promise<ReceivedKitDto> {
    return this.receiving.updateKit(t, id, input, u);
  }

  @Post('kits/:id/cancel')
  @RequirePermission('receiving.receive')
  cancelKit(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @body(cancelReceivedKitSchema) input: Out<typeof cancelReceivedKitSchema>,
  ): Promise<ReceivedKitDto> {
    return this.receiving.cancelKit(t, id, input.reason, u);
  }

  /** Kits waiting for registration, vessel-linked and unlinked (design pack §8). */
  @Get('registration-queue')
  queue(
    @CurrentTenant() t: TenantContext,
    @Query(new ZodValidationPipe(queueQuery)) q: PageQuery & RegistrationQueueQuery,
  ): Promise<Paginated<ReceivedKitDto>> {
    return this.receiving.queue(t, q, q);
  }
}
