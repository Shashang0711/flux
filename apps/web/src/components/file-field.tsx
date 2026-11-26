'use client';

import { useState } from 'react';
import { acceptFor, type FilePurpose } from '@flux/shared';
import { Field } from './field';
import { useMutation } from '@/hooks/use-mutation';
import { downloadVia, formatBytes } from '@/lib/files';

/** A file input limited to the purpose's types; the chosen File is reported through onChange. */
export function FileField({
  id,
  label,
  purpose,
  onChange,
  error,
  hint,
}: {
  id: string;
  label: string;
  purpose: FilePurpose;
  onChange: (file: File | null) => void;
  error?: string;
  hint?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <Field
      label={label}
      htmlFor={id}
      hint={file ? `${file.name} · ${formatBytes(file.size)}` : (hint ?? 'Up to 25 MB')}
      error={error}
    >
      <input
        className="input"
        id={id}
        type="file"
        accept={acceptFor(purpose)}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f);
          onChange(f);
        }}
      />
    </Field>
  );
}

/** Fetches a signed link from `linkPath`, then downloads. */
export function DownloadButton({
  linkPath,
  label = 'Download',
}: {
  linkPath: string;
  label?: string;
}) {
  const { pending, error, run } = useMutation();
  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() => run(() => downloadVia(linkPath), { refresh: false })}
      >
        {pending ? 'Preparing…' : label}
      </button>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
