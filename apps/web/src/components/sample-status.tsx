import { SampleStatus, type SampleColour } from '@flux/shared';

const LABEL: Record<SampleStatus, string> = {
  REGISTERED: 'Registered',
  UNDER_TESTING: 'Under testing',
  RESULTS_ENTERED: 'Results entered',
};
const TONE: Record<SampleColour, string> = {
  red: 'badge-bad',
  yellow: 'badge-warn',
  green: 'badge-ok',
};

/**
 * A sample's state with its Sample Update colour (red: registered, yellow: lab report uploaded,
 * green: published). The colour is also spelled out for screen readers and colour-blind users.
 */
export function SampleStatusBadge({
  status,
  colour,
}: {
  status: SampleStatus;
  colour: SampleColour;
}) {
  return (
    <span className={`badge ${TONE[colour]}`} title={`${colour} — ${LABEL[status]}`}>
      <span aria-hidden="true">●</span> {LABEL[status]}
      <span className="sr-only"> ({colour})</span>
    </span>
  );
}
