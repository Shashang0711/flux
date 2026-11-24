import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  formatClientCode,
  type BillingPartyDto,
  type ClientDto,
  type ClientListFilter,
  type ClientSummaryDto,
  type CustomFieldValues,
  type PageQuery,
  type UpdateClientRequest,
  billingPartySchema,
  clientAddressSchema,
  clientContactSchema,
  createClientSchema,
  updateBillingPartySchema,
  updateClientAddressSchema,
  updateClientContactSchema,
} from '@flux/shared';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import { Paginated, toSkipTake } from '../../common/pagination/pagination';
import { nextSequence } from '../../database/sequences';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import { compactChanges, fieldChanges, recordAudit, type AuditEntry } from '../audit/audit';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import {
  BILLING_PARTY_ORDER,
  CLIENT_DETAIL_INCLUDE,
  CLIENT_SUMMARY_INCLUDE,
  describeAddress,
  toBillingPartyDto,
  toClientDto,
  toClientSummaryDto,
} from './client.mapper';

const CLIENT_FIELDS = [
  'name',
  'tradingName',
  'email',
  'phone',
  'website',
  'taxNumber',
  'notes',
  'status',
] as const;
const ADDRESS_FIELDS = [
  'type',
  'label',
  'line1',
  'line2',
  'city',
  'region',
  'postalCode',
  'country',
] as const;
const CONTACT_FIELDS = ['name', 'jobTitle', 'email', 'phone', 'isPrimary'] as const;
const BILLING_FIELDS = [
  'name',
  'email',
  'phone',
  'taxNumber',
  'line1',
  'line2',
  'city',
  'region',
  'postalCode',
  'country',
  'isDefault',
  'isActive',
] as const;

type Client = Prisma.ClientGetPayload<object>;

/**
 * Clients of the caller's tenant with their addresses, contacts and billing parties. All
 * access runs through TenantDb (row-level security); every change is audited in the same
 * transaction, on the client's history.
 */
@Injectable()
export class ClientsService {
  constructor(
    private readonly db: TenantDb,
    private readonly customFields: CustomFieldsService,
  ) {}

  list(
    ctx: TenantContext,
    query: PageQuery & ClientListFilter,
  ): Promise<Paginated<ClientSummaryDto>> {
    const where: Prisma.ClientWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { code: { contains: query.q, mode: 'insensitive' } },
              { name: { contains: query.q, mode: 'insensitive' } },
              { tradingName: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.db.run(ctx.tenantId, async (tx) => {
      const [clients, total] = await Promise.all([
        tx.client.findMany({
          where,
          include: CLIENT_SUMMARY_INCLUDE,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          ...toSkipTake(query),
        }),
        tx.client.count({ where }),
      ]);
      return new Paginated(clients.map(toClientSummaryDto), total, query);
    });
  }

  get(ctx: TenantContext, id: string): Promise<ClientDto> {
    return this.db.run(ctx.tenantId, (tx) => this.detail(tx, id));
  }

  /** Creates the client with the next code of the tenant's sequence (CL-00001, …). */
  create(
    ctx: TenantContext,
    input: z.output<typeof createClientSchema>,
    actor: AuthUser,
  ): Promise<ClientDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const { customFields: customInput, ...fields } = input;
      // Validate custom fields before taking a number, so invalid input never touches the sequence.
      const custom = await this.customFields.resolveValues(tx, 'client', customInput, 'create');
      const code = formatClientCode(await nextSequence(tx, ctx.tenantId, 'client'));
      const client = await tx.client.create({
        data: { ...fields, tenantId: ctx.tenantId, code, customFields: custom.values },
      });
      await this.audit(tx, ctx, actor, client, 'client.created', {
        changes: compactChanges({
          code: { from: null, to: code },
          ...fieldChanges(
            null,
            client,
            CLIENT_FIELDS.filter((f) => f !== 'status'),
          ),
          ...custom.changes,
        }),
      });
      return this.detail(tx, client.id);
    });
  }

  update(
    ctx: TenantContext,
    id: string,
    input: UpdateClientRequest,
    actor: AuthUser,
  ): Promise<ClientDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const before = await this.find(tx, id);
      const { customFields: customInput, ...fields } = input;
      const custom =
        customInput === undefined
          ? null
          : await this.customFields.resolveValues(
              tx,
              'client',
              customInput,
              'update',
              before.customFields as CustomFieldValues,
            );
      const updated = await tx.client.update({
        where: { id },
        data: { ...fields, ...(custom ? { customFields: custom.values } : {}) },
      });
      const changes = { ...fieldChanges(before, updated, CLIENT_FIELDS), ...custom?.changes };
      if (Object.keys(changes).length > 0) {
        await this.audit(
          tx,
          ctx,
          actor,
          updated,
          changes.status
            ? updated.status === 'ACTIVE'
              ? 'client.activated'
              : 'client.deactivated'
            : 'client.updated',
          { changes },
        );
      }
      return this.detail(tx, id);
    });
  }

  // ─── Addresses ────────────────────────────────────────────────────────────

  addAddress(
    ctx: TenantContext,
    clientId: string,
    input: z.output<typeof clientAddressSchema>,
    actor: AuthUser,
  ): Promise<ClientDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const client = await this.find(tx, clientId);
      const address = await tx.clientAddress.create({
        data: { ...input, tenantId: ctx.tenantId, clientId },
      });
      await this.audit(tx, ctx, actor, client, 'client.address_added', {
        relatedIds: [address.id],
        changes: fieldChanges(null, address, ADDRESS_FIELDS),
      });
      return this.detail(tx, clientId);
    });
  }

  updateAddress(
    ctx: TenantContext,
    clientId: string,
    addressId: string,
    input: z.output<typeof updateClientAddressSchema>,
    actor: AuthUser,
  ): Promise<ClientDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const client = await this.find(tx, clientId);
      const before = await tx.clientAddress.findFirst({ where: { id: addressId, clientId } });
      if (!before) throw AppException.notFound('Address', addressId);
      const updated = await tx.clientAddress.update({ where: { id: addressId }, data: input });
      const changes = fieldChanges(before, updated, ADDRESS_FIELDS);
      if (Object.keys(changes).length > 0) {
        await this.audit(tx, ctx, actor, client, 'client.address_updated', {
          relatedIds: [addressId],
          changes,
        });
      }
      return this.detail(tx, clientId);
    });
  }

  removeAddress(
    ctx: TenantContext,
    clientId: string,
    addressId: string,
    actor: AuthUser,
  ): Promise<ClientDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const client = await this.find(tx, clientId);
      const address = await tx.clientAddress.findFirst({ where: { id: addressId, clientId } });
      if (!address) throw AppException.notFound('Address', addressId);
      await tx.clientAddress.delete({ where: { id: addressId } });
      await this.audit(tx, ctx, actor, client, 'client.address_removed', {
        relatedIds: [addressId],
        changes: { address: { from: describeAddress(address), to: null } },
      });
      return this.detail(tx, clientId);
    });
  }

  // ─── Contacts ─────────────────────────────────────────────────────────────

  addContact(
    ctx: TenantContext,
    clientId: string,
    input: z.output<typeof clientContactSchema>,
    actor: AuthUser,
  ): Promise<ClientDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const client = await this.find(tx, clientId);
      if (input.isPrimary) await this.clearPrimaryContact(tx, clientId);
      const contact = await tx.clientContact.create({
        data: { ...input, tenantId: ctx.tenantId, clientId },
      });
      await this.audit(tx, ctx, actor, client, 'client.contact_added', {
        relatedIds: [contact.id],
        changes: fieldChanges(null, contact, CONTACT_FIELDS),
      });
      return this.detail(tx, clientId);
    });
  }

  updateContact(
    ctx: TenantContext,
    clientId: string,
    contactId: string,
    input: z.output<typeof updateClientContactSchema>,
    actor: AuthUser,
  ): Promise<ClientDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const client = await this.find(tx, clientId);
      const before = await tx.clientContact.findFirst({ where: { id: contactId, clientId } });
      if (!before) throw AppException.notFound('Contact', contactId);
      if (input.isPrimary && !before.isPrimary) await this.clearPrimaryContact(tx, clientId);
      const updated = await tx.clientContact.update({ where: { id: contactId }, data: input });
      const changes = fieldChanges(before, updated, CONTACT_FIELDS);
      if (Object.keys(changes).length > 0) {
        await this.audit(tx, ctx, actor, client, 'client.contact_updated', {
          relatedIds: [contactId],
          changes: { contact: { from: null, to: updated.name }, ...changes },
        });
      }
      return this.detail(tx, clientId);
    });
  }

  removeContact(
    ctx: TenantContext,
    clientId: string,
    contactId: string,
    actor: AuthUser,
  ): Promise<ClientDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const client = await this.find(tx, clientId);
      const contact = await tx.clientContact.findFirst({ where: { id: contactId, clientId } });
      if (!contact) throw AppException.notFound('Contact', contactId);
      await tx.clientContact.delete({ where: { id: contactId } });
      await this.audit(tx, ctx, actor, client, 'client.contact_removed', {
        relatedIds: [contactId],
        changes: { contact: { from: contact.name, to: null } },
      });
      return this.detail(tx, clientId);
    });
  }

  // ─── Billing parties ──────────────────────────────────────────────────────

  billingParties(ctx: TenantContext, clientId: string): Promise<BillingPartyDto[]> {
    return this.db.run(ctx.tenantId, async (tx) => {
      await this.find(tx, clientId);
      const parties = await tx.billingParty.findMany({
        where: { clientId },
        orderBy: BILLING_PARTY_ORDER,
      });
      return parties.map(toBillingPartyDto);
    });
  }

  addBillingParty(
    ctx: TenantContext,
    clientId: string,
    input: z.output<typeof billingPartySchema>,
    actor: AuthUser,
  ): Promise<ClientDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const client = await this.find(tx, clientId);
      if (input.isDefault) await this.clearDefaultBillingParty(tx, clientId);
      const party = await tx.billingParty.create({
        data: { ...input, tenantId: ctx.tenantId, clientId },
      });
      await this.audit(tx, ctx, actor, client, 'client.billing_party_added', {
        relatedIds: [party.id],
        changes: fieldChanges(
          null,
          party,
          BILLING_FIELDS.filter((f) => f !== 'isActive'),
        ),
      });
      return this.detail(tx, clientId);
    });
  }

  updateBillingParty(
    ctx: TenantContext,
    clientId: string,
    partyId: string,
    input: z.output<typeof updateBillingPartySchema>,
    actor: AuthUser,
  ): Promise<ClientDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const client = await this.find(tx, clientId);
      const before = await tx.billingParty.findFirst({ where: { id: partyId, clientId } });
      if (!before) throw AppException.notFound('Billing party', partyId);
      const data = { ...input };
      // An inactive billing party cannot be the default.
      if (data.isActive === false) data.isDefault = false;
      if (data.isDefault === true && (data.isActive ?? before.isActive) === false) {
        throw AppException.badRequest('An inactive billing party cannot be the default', {
          fields: [{ path: 'isDefault', message: 'Activate the billing party first' }],
        });
      }
      if (data.isDefault && !before.isDefault) await this.clearDefaultBillingParty(tx, clientId);
      const updated = await tx.billingParty.update({ where: { id: partyId }, data });
      const changes = fieldChanges(before, updated, BILLING_FIELDS);
      if (Object.keys(changes).length > 0) {
        await this.audit(tx, ctx, actor, client, 'client.billing_party_updated', {
          relatedIds: [partyId],
          changes: { billingParty: { from: null, to: updated.name }, ...changes },
        });
      }
      return this.detail(tx, clientId);
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async find(tx: TenantTx, id: string): Promise<Client> {
    const client = await tx.client.findUnique({ where: { id } });
    if (!client) throw AppException.notFound('Client', id);
    return client;
  }

  private async detail(tx: TenantTx, id: string): Promise<ClientDto> {
    const client = await tx.client.findUnique({ where: { id }, include: CLIENT_DETAIL_INCLUDE });
    if (!client) throw AppException.notFound('Client', id);
    return toClientDto(client);
  }

  private async clearPrimaryContact(tx: TenantTx, clientId: string): Promise<void> {
    await tx.clientContact.updateMany({
      where: { clientId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  private async clearDefaultBillingParty(tx: TenantTx, clientId: string): Promise<void> {
    await tx.billingParty.updateMany({
      where: { clientId, isDefault: true },
      data: { isDefault: false },
    });
  }

  private audit(
    tx: TenantTx,
    ctx: TenantContext,
    actor: AuthUser,
    client: Client,
    action: AuditEntry['action'],
    extra: Pick<AuditEntry, 'changes' | 'relatedIds'>,
  ): Promise<void> {
    return recordAudit(tx, {
      tenantId: ctx.tenantId,
      actor,
      action,
      entity: { type: 'client', id: client.id, label: `${client.code} ${client.name}` },
      ...extra,
    });
  }
}
