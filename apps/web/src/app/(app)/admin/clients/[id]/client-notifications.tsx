'use client';

import type { FormEvent } from 'react';
import {
  NOTIFICATION_EVENTS,
  notificationEventName,
  type ClientDto,
  type ClientNotificationRuleDto,
} from '@flux/shared';
import { Badge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { EditDialog } from '@/components/edit-dialog';
import { FormStatus } from '@/components/field';
import {
  RecipientSummary,
  RecipientsFields,
  canDeliver,
  readRecipients,
} from '@/components/recipients';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';

const description = (event: string) =>
  NOTIFICATION_EVENTS.find((e) => e.key === event)?.description ?? '';

function RuleForm({ client, rule }: { client: ClientDto; rule: ClientNotificationRuleDto }) {
  const { pending, error, fields, success, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(
      () =>
        apiFetch(`/clients/${client.id}/notification-rules/${rule.event}`, {
          method: 'PUT',
          body: JSON.stringify({ enabled: data.get('enabled') === 'on', ...readRecipients(data) }),
        }),
      { success: 'Saved.' },
    );
  }
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <p className="muted" style={{ margin: 0 }}>
        {description(rule.event)}
      </p>
      <label className="check">
        <input type="checkbox" name="enabled" defaultChecked={rule.enabled} /> Send this
        notification
      </label>
      <RecipientsFields
        idPrefix={`rule-${rule.event}`}
        options={client.contacts.map((c) => ({ id: c.id, name: c.name, email: c.email }))}
        selected={rule.contacts.map((c) => c.id)}
        emails={rule.emails}
        fields={fields}
      />
      <FormStatus error={error} fields={fields} success={success} />
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

/**
 * The client's notification rules (design pack §15): the defaults for every vessel of this
 * client. Vessels change them only through overrides on their own Notifications tab.
 */
export function ClientNotifications({
  client,
  rules,
  canManage,
}: {
  client: ClientDto;
  rules: ClientNotificationRuleDto[];
  canManage: boolean;
}) {
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        These rules apply to all of this client’s vessels. A vessel can override them on its
        Notifications tab. Emails are sent once the sample workflow is live.
      </p>
      <DataTable
        label="Notification rules"
        empty="No notification events."
        rows={rules}
        rowKey={(r) => r.event}
        columns={[
          {
            header: 'Event',
            primary: true,
            cell: (r) => (
              <>
                {notificationEventName(r.event)}
                <span className="cell-sub">{description(r.event)}</span>
              </>
            ),
          },
          {
            header: 'Status',
            cell: (r) => (
              <span className="row">
                {r.enabled ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}
                {r.enabled && !canDeliver(r) && <Badge tone="warn">No one to email</Badge>}
              </span>
            ),
          },
          { header: 'Recipients', cell: (r) => <RecipientSummary recipients={r} /> },
          ...(canManage
            ? [
                {
                  header: 'Actions',
                  actions: true,
                  cell: (r: ClientNotificationRuleDto) => (
                    <EditDialog title={notificationEventName(r.event)}>
                      <RuleForm client={client} rule={r} />
                    </EditDialog>
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
