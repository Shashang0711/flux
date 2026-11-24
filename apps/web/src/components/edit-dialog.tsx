'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons';

/**
 * A button that opens its form in a modal dialog (native <dialog>: focus is trapped, Esc
 * closes, and the page behind is inert). Replaces inline editors inside table rows, which
 * were cramped on desktop and pushed tables sideways.
 */
export function EditDialog({
  title,
  label = 'Edit',
  children,
}: {
  title: string;
  label?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        {label}
      </button>
      <dialog ref={dialog} className="dialog" onClose={() => setOpen(false)} aria-label={title}>
        <div className="dialog-head">
          <h2 className="card-title">{title}</h2>
          <button
            type="button"
            className="dialog-close"
            aria-label="Close"
            onClick={() => dialog.current?.close()}
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        {open && children}
      </dialog>
    </>
  );
}
