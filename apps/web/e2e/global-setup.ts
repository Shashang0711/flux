import { mkdirSync } from 'node:fs';
import { request, type FullConfig } from '@playwright/test';
import { OPERATOR, OWNER, STATE } from './fixtures';

/**
 * Creates the demo tenant and data through the API (idempotent: an existing tenant is reused)
 * and saves signed-in sessions for the tests. Needs a database with the platform admin seeded
 * (FLUX_ADMIN_* → `npm run db:seed`).
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]!.use.baseURL!;
  mkdirSync('./e2e/.auth', { recursive: true });

  const operator = await request.newContext({ baseURL });
  const opLogin = await operator.post('/api/v1/auth/login', { data: OPERATOR });
  if (!opLogin.ok())
    throw new Error(`Operator sign-in failed (${opLogin.status()}): seed the platform admin first`);
  const tenant = await operator.post('/api/v1/platform/tenants', {
    data: {
      name: 'Oceanic Testing Ltd',
      slug: 'oceanic-e2e',
      modules: ['clients', 'vessels', 'samples', 'reports'],
      admin: { name: 'Owen Owner', email: OWNER.email, password: OWNER.password },
    },
  });
  const freshTenant = tenant.status() === 201;
  if (!freshTenant && tenant.status() !== 409)
    throw new Error(`Tenant setup failed: ${tenant.status()}`);
  await operator.storageState({ path: STATE.operator });

  const owner = await request.newContext({ baseURL });
  const login = await owner.post('/api/v1/auth/login', { data: OWNER });
  if (!login.ok()) throw new Error(`Owner sign-in failed (${login.status()})`);
  if (freshTenant) await seed(owner);
  await owner.storageState({ path: STATE.owner });
  await operator.dispose();
  await owner.dispose();
}

type Api = Awaited<ReturnType<typeof request.newContext>>;

async function seed(api: Api): Promise<void> {
  const json = async (res: Awaited<ReturnType<Api['post']>>) => {
    if (!res.ok()) throw new Error(`${res.url()}: ${res.status()} ${await res.text()}`);
    return (await res.json()).data;
  };
  const types = await json(await api.get('/api/v1/reference-data/vessel-type'));
  const relTypes = await json(await api.get('/api/v1/reference-data/vessel-relationship-type'));
  const role = await json(
    await api.post('/api/v1/roles', {
      data: {
        name: 'Lab Analyst',
        defaultPortal: 'LAB',
        modules: ['samples'],
        permissions: ['sample.test'],
      },
    }),
  );
  await json(
    await api.post('/api/v1/users', {
      data: {
        name: 'Ana Analyst',
        email: 'ana@oceanic.test',
        password: 'demo-pass-123',
        roleIds: [role.id],
      },
    }),
  );
  await json(
    await api.post('/api/v1/custom-fields', {
      data: {
        entity: 'client',
        label: 'Service tier',
        type: 'SELECT',
        options: [{ value: 'gold', label: 'Gold' }],
      },
    }),
  );
  const clients = [];
  for (const name of [
    'Aegean Bulk Carriers SA',
    'Baltic Reefers AB',
    'Caspian Tankers Management Ltd',
  ]) {
    const client = await json(
      await api.post('/api/v1/clients', {
        data: { name, email: 'ops@example.com', phone: '+30 210 000 0000' },
      }),
    );
    await json(
      await api.post(`/api/v1/clients/${client.id}/contacts`, {
        data: { name: 'Maria Papadopoulou', isPrimary: true },
      }),
    );
    await json(
      await api.post(`/api/v1/clients/${client.id}/billing-parties`, {
        data: { name: `${name} Finance`, isDefault: true },
      }),
    );
    clients.push(client);
  }
  const fleet = await json(
    await api.post('/api/v1/fleets', { data: { clientId: clients[0].id, name: 'Capesize Fleet' } }),
  );
  await json(
    await api.post('/api/v1/vessels', {
      data: {
        name: 'Aegean Star',
        imoNumber: '9074729',
        vesselTypeId: types[0].id,
        relationship: {
          clientId: clients[0].id,
          relationshipTypeId: relTypes[0].id,
          isPrimary: true,
          fleetId: fleet.id,
        },
      },
    }),
  );
}
