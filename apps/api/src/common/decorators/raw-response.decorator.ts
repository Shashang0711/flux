import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE_KEY = 'flux:raw-response';

/** Opt a handler out of the `{ data }` envelope (e.g. file streams, CSV exports). */
export const RawResponse = (): MethodDecorator => SetMetadata(RAW_RESPONSE_KEY, true);
