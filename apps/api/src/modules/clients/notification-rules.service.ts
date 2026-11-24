import { Injectable } from '@nestjs/common';
import {
  notificationEventName,
  type ClientNotificationRuleDto,
  type NotificationEventKey,
  type clientNotificationRuleSchema,
} from '@flux/shared';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import { compactChanges, listChange, recordAudit } from '../audit/audit';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { fieldError, loadClientRules, recipientLabels } from './notification-rules';

/**
 * Client notification rules (design pack §15): one rule per event, the default for every vessel
 * of the client. Vessels store only overrides (see vessels/overrides.service.ts).
 */
@Injectable()
export class NotificationRulesService {
  constructor(private readonly db: TenantDb) {}

  list(ctx: TenantContext, clientId: string): Promise<ClientNotificationRuleDto[]> {
    return this.db.run(ctx.tenantId, async (tx) => {
      await this.findClient(tx, clientId);
      return loadClientRules(tx, clientId);
    });
  }

  set(
    ctx: TenantContext,
    clientId: string,
    event: NotificationEventKey,
    input: z.output<typeof clientNotificationRuleSchema>,
    actor: AuthUser,
  ): Promise<ClientNotificationRuleDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const client = await this.findClient(tx, clientId);
      const before = (await loadClientRules(tx, clientId)).find((r) => r.event === event)!;
      const contacts = await tx.clientContact.findMany({
        where: { clientId, id: { in: input.contactIds } },
        select: { id: true },
      });
      if (contacts.length !== input.contactIds.length) {
        throw fieldError('contactIds', "Choose from this client's contacts");
      }
      const rule = await tx.clientNotificationRule.upsert({
        where: { clientId_event: { clientId, event } },
        create: {
          tenantId: ctx.tenantId,
          clientId,
          event,
          enabled: input.enabled,
          extraEmails: input.emails,
        },
        update: { enabled: input.enabled, extraEmails: input.emails },
      });
      await tx.clientNotificationRuleContact.deleteMany({ where: { ruleId: rule.id } });
      await tx.clientNotificationRuleContact.createMany({
        data: input.contactIds.map((contactId) => ({
          tenantId: ctx.tenantId,
          clientId,
          ruleId: rule.id,
          contactId,
        })),
      });
      const after = (await loadClientRules(tx, clientId)).find((r) => r.event === event)!;
      const changes = compactChanges({
        enabled:
          before.enabled !== after.enabled
            ? { from: before.enabled, to: after.enabled }
            : undefined,
        recipients: listChange(recipientLabels(before), recipientLabels(after)),
      });
      if (changes) {
        await recordAudit(tx, {
          tenantId: ctx.tenantId,
          actor,
          action: 'client.notification_rule_updated',
          entity: { type: 'client', id: client.id, label: `${client.code} ${client.name}` },
          relatedIds: [rule.id],
          changes: { event: { from: null, to: notificationEventName(event) }, ...changes },
        });
      }
      return after;
    });
  }

  private async findClient(tx: TenantTx, id: string) {
    const client = await tx.client.findUnique({
      where: { id },
      select: { id: true, code: true, name: true },
    });
    if (!client) throw AppException.notFound('Client', id);
    return client;
  }
}
