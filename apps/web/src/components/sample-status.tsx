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
  // Yellow and green are report milestones on top of the testing status.
  const label = colour === 'yellow' ? 'Lab report uploaded' : LABEL[status];
  return (
    <span className={`badge ${TONE[colour]}`} title={`${colour} — ${label}`}>
      <span aria-hidden="true">●</span> {label}
      <span className="sr-only"> ({colour})</span>
    </span>
  );
}
