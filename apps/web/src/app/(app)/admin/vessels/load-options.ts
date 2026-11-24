import 'server-only';
import type { CustomFieldDefinitionDto, ReferenceItemDto } from '@flux/shared';
import { loadOrNotFound } from '@/lib/server-api';
import type { VesselFormOptions } from './vessel-form';

/** Dropdown choices (usable reference items) and custom fields for the vessel forms. */
export async function loadVesselFormOptions(): Promise<VesselFormOptions> {
  const [types, classes, customFields] = await Promise.all([
    loadOrNotFound<ReferenceItemDto[]>('/reference-data/vessel-type'),
    loadOrNotFound<ReferenceItemDto[]>('/reference-data/classification-society'),
    loadOrNotFound<CustomFieldDefinitionDto[]>('/custom-fields?entity=vessel'),
  ]);
  return {
    vesselTypes: types.data,
    classificationSocieties: classes.data,
    customFields: customFields.data,
  };
}
