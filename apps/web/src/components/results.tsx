import {
  formatResultValue,
  rangeLabel,
  type ResultFlag,
  type ResultValue,
  type TestParameterDto,
} from '@flux/shared';

const FLAG: Record<ResultFlag, { label: string; tone: string }> = {
  NORMAL: { label: 'Normal', tone: 'badge-ok' },
  CAUTION: { label: 'Caution', tone: 'badge-warn' },
  CRITICAL: { label: 'Critical', tone: 'badge-bad' },
};

export function FlagBadge({ flag }: { flag: ResultFlag | null }) {
  if (!flag) return null;
  return <span className={`badge ${FLAG[flag].tone}`}>{FLAG[flag].label}</span>;
}

/** "cSt · normal 90–110 · ASTM D445" */
export function parameterHint(p: TestParameterDto): string {
  const normal = rangeLabel(p.cautionMin ?? p.criticalMin, p.cautionMax ?? p.criticalMax);
  return [p.unit, normal && `acceptable ${normal}`, p.method].filter(Boolean).join(' · ');
}

/** The form value of a stored result: numbers as text, pass/fail as "pass"/"fail". */
export function inputValue(p: TestParameterDto, v: ResultValue | undefined): string {
  if (v === undefined) return '';
  if (p.type === 'PASS_FAIL') return v ? 'pass' : 'fail';
  return formatResultValue(p, v);
}

/** One input for a result value; its form value is read as text and parsed by the API. */
export function ResultInput({
  parameter: p,
  id,
  name,
  defaultValue,
  invalid,
  disabled,
  label,
}: {
  parameter: TestParameterDto;
  id: string;
  name: string;
  defaultValue: string;
  invalid?: boolean;
  disabled?: boolean;
  /** Accessible name when there is no visible label (grid cells). */
  label?: string;
}) {
  const common = {
    id,
    name,
    defaultValue,
    disabled,
    'aria-invalid': invalid || undefined,
    'aria-label': label,
  };
  if (p.type === 'PASS_FAIL') {
    return (
      <select className="select" {...common}>
        <option value="">—</option>
        <option value="pass">Pass</option>
        <option value="fail">Fail</option>
      </select>
    );
  }
  if (p.type === 'CHOICE') {
    return (
      <select className="select" {...common}>
        <option value="">—</option>
        {p.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      className="input"
      inputMode={p.type === 'NUMBER' ? 'decimal' : undefined}
      autoComplete="off"
      {...common}
    />
  );
}
