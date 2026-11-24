'use client';

import { parseEmailList, type NotificationRecipientsDto } from '@flux/shared';
import { Badge } from './badges';
import { Field } from './field';

/** Contacts that can receive a notification (client contacts and, on vessels, vessel contacts). */
export interface RecipientOption {
  id: string;
  name: string;
  email: string | null;
  /** e.g. "Vessel contact" */
  note?: string;
}

/** Names and addresses of a notification's recipients, for table cells. */
export function RecipientSummary({ recipients }: { recipients: NotificationRecipientsDto }) {
  const { contacts, emails } = recipients;
  if (contacts.length === 0 && emails.length === 0) {
    return <span className="muted">No recipients</span>;
  }
  return (
    <ul className="chips" aria-label="Recipients">
      {contacts.map((c) => (
        <li key={c.id}>
          {c.name}
          {c.source === 'vessel' && (
            <>
              {' '}
              <Badge>vessel</Badge>
            </>
          )}
          {!c.email && (
            <>
              {' '}
              <Badge tone="warn">no email</Badge>
            </>
          )}
        </li>
      ))}
      {emails.map((e) => (
        <li key={e} className="muted">
          {e}
        </li>
      ))}
    </ul>
  );
}

/** True when at least one recipient has an address (a notification can actually be sent). */
export function canDeliver(r: NotificationRecipientsDto): boolean {
  return r.emails.length > 0 || r.contacts.some((c) => c.email);
}

/** Checkbox list of contacts plus a textarea of extra addresses. Read with readRecipients(). */
export function RecipientsFields({
  idPrefix,
  options,
  selected,
  emails,
  fields,
}: {
  idPrefix: string;
  options: RecipientOption[];
  selected: string[];
  emails: string[];
  fields: Record<string, string>;
}) {
  const emailError =
    fields.emails ??
    Object.entries(fields).find(
      ([k]) => k.startsWith('emails.') || k.startsWith('recipients.emails'),
    )?.[1];
  return (
    <>
      <fieldset className="check-group">
        <legend>Contacts</legend>
        {options.length === 0 && <span className="muted">No contacts to choose from.</span>}
        {options.map((o) => (
          <label key={o.id} className="check">
            <input
              type="checkbox"
              name="contactIds"
              value={o.id}
              defaultChecked={selected.includes(o.id)}
            />
            <span>
              {o.name}
              {o.note && <span className="muted"> · {o.note}</span>}
              <span className="cell-sub">{o.email ?? 'No email address'}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Field
        label="Other email addresses"
        htmlFor={`${idPrefix}-emails`}
        hint="One per line, e.g. a shared inbox"
        error={emailError}
      >
        <textarea
          className="textarea"
          id={`${idPrefix}-emails`}
          name="emails"
          rows={3}
          defaultValue={emails.join('\n')}
        />
      </Field>
    </>
  );
}

export function readRecipients(data: FormData): { contactIds: string[]; emails: string[] } {
  return {
    contactIds: data.getAll('contactIds').map(String),
    emails: parseEmailList(String(data.get('emails') ?? '')),
  };
}
