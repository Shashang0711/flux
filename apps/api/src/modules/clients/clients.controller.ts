import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  billingPartySchema,
  clientAddressSchema,
  clientContactSchema,
  clientListFilterSchema,
  createClientSchema,
  updateBillingPartySchema,
  updateClientAddressSchema,
  updateClientContactSchema,
  updateClientSchema,
  type BillingPartyDto,
  type ClientDto,
  type ClientListFilter,
  type ClientSummaryDto,
  type PageQuery,
} from '@flux/shared';
import type { z } from 'zod';
import { Paginated, pageQuerySchema } from '../../common/pagination/pagination';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { CurrentTenant, CurrentUser, RequireModule, RequirePermission } from '../auth/decorators';
import { ClientsService } from './clients.service';

const listQuerySchema = pageQuerySchema.extend(clientListFilterSchema.shape);
const body = <T extends z.ZodType>(schema: T) => Body(new ZodValidationPipe(schema));
const uuid = (name: string) => Param(name, ParseUUIDPipe);

/** Clients module: reads need client.view, changes need client.manage. */
@Controller('clients')
@RequireModule('clients')
@RequirePermission('client.view')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listQuerySchema)) query: PageQuery & ClientListFilter,
  ): Promise<Paginated<ClientSummaryDto>> {
    return this.clients.list(tenant, query);
  }

  @Post()
  @RequirePermission('client.manage')
  create(
    @CurrentTenant() tenant: TenantContext,
    @body(createClientSchema) input: z.output<typeof createClientSchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<ClientDto> {
    return this.clients.create(tenant, input, actor);
  }

  @Get(':id')
  get(@CurrentTenant() tenant: TenantContext, @uuid('id') id: string): Promise<ClientDto> {
    return this.clients.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermission('client.manage')
  update(
    @CurrentTenant() tenant: TenantContext,
    @uuid('id') id: string,
    @body(updateClientSchema) input: z.output<typeof updateClientSchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<ClientDto> {
    return this.clients.update(tenant, id, input, actor);
  }

  @Post(':id/addresses')
  @RequirePermission('client.manage')
  addAddress(
    @CurrentTenant() tenant: TenantContext,
    @uuid('id') id: string,
    @body(clientAddressSchema) input: z.output<typeof clientAddressSchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<ClientDto> {
    return this.clients.addAddress(tenant, id, input, actor);
  }

  @Patch(':id/addresses/:addressId')
  @RequirePermission('client.manage')
  updateAddress(
    @CurrentTenant() tenant: TenantContext,
    @uuid('id') id: string,
    @uuid('addressId') addressId: string,
    @body(updateClientAddressSchema) input: z.output<typeof updateClientAddressSchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<ClientDto> {
    return this.clients.updateAddress(tenant, id, addressId, input, actor);
  }

  @Delete(':id/addresses/:addressId')
  @RequirePermission('client.manage')
  removeAddress(
    @CurrentTenant() tenant: TenantContext,
    @uuid('id') id: string,
    @uuid('addressId') addressId: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<ClientDto> {
    return this.clients.removeAddress(tenant, id, addressId, actor);
  }

  @Post(':id/contacts')
  @RequirePermission('client.manage')
  addContact(
    @CurrentTenant() tenant: TenantContext,
    @uuid('id') id: string,
    @body(clientContactSchema) input: z.output<typeof clientContactSchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<ClientDto> {
    return this.clients.addContact(tenant, id, input, actor);
  }

  @Patch(':id/contacts/:contactId')
  @RequirePermission('client.manage')
  updateContact(
    @CurrentTenant() tenant: TenantContext,
    @uuid('id') id: string,
    @uuid('contactId') contactId: string,
    @body(updateClientContactSchema) input: z.output<typeof updateClientContactSchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<ClientDto> {
    return this.clients.updateContact(tenant, id, contactId, input, actor);
  }

  @Delete(':id/contacts/:contactId')
  @RequirePermission('client.manage')
  removeContact(
    @CurrentTenant() tenant: TenantContext,
    @uuid('id') id: string,
    @uuid('contactId') contactId: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<ClientDto> {
    return this.clients.removeContact(tenant, id, contactId, actor);
  }

  /** Billing Party Grid. */
  @Get(':id/billing-parties')
  billingParties(
    @CurrentTenant() tenant: TenantContext,
    @uuid('id') id: string,
  ): Promise<BillingPartyDto[]> {
    return this.clients.billingParties(tenant, id);
  }

  /** Billing Party Add. */
  @Post(':id/billing-parties')
  @RequirePermission('client.manage')
  addBillingParty(
    @CurrentTenant() tenant: TenantContext,
    @uuid('id') id: string,
    @body(billingPartySchema) input: z.output<typeof billingPartySchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<ClientDto> {
    return this.clients.addBillingParty(tenant, id, input, actor);
  }

  @Patch(':id/billing-parties/:partyId')
  @RequirePermission('client.manage')
  updateBillingParty(
    @CurrentTenant() tenant: TenantContext,
    @uuid('id') id: string,
    @uuid('partyId') partyId: string,
    @body(updateBillingPartySchema) input: z.output<typeof updateBillingPartySchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<ClientDto> {
    return this.clients.updateBillingParty(tenant, id, partyId, input, actor);
  }
}
