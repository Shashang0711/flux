import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  createFleetSchema,
  createRelationshipSchema,
  endRelationshipSchema,
  relationshipListQuerySchema,
  setRelationshipFleetSchema,
  updateFleetSchema,
  updateRelationshipSchema,
  type FleetDto,
  type VesselRelationshipDto,
} from '@flux/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { CurrentTenant, CurrentUser, RequireModule, RequirePermission } from '../auth/decorators';
import { FleetsService } from './fleets.service';
import { RelationshipsService, assertClientsModule } from './relationships.service';

const body = <T extends z.ZodType>(schema: T) => Body(new ZodValidationPipe(schema));
const uuid = (name: string) => Param(name, ParseUUIDPipe);
const statusQuery = Query(new ZodValidationPipe(relationshipListQuerySchema));

/**
 * Vessel–client relationships and fleets. Need the Vessels module (and Clients, checked per
 * request); reads need vessel.view, relationship changes vessel.manage, fleet changes fleet.manage.
 */
@Controller()
@RequireModule('vessels')
@RequirePermission('vessel.view')
export class RelationshipsController {
  constructor(
    private readonly relationships: RelationshipsService,
    private readonly fleets: FleetsService,
  ) {}

  @Get('vessels/:id/relationships')
  vesselRelationships(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @uuid('id') id: string,
    @statusQuery query: z.output<typeof relationshipListQuerySchema>,
  ): Promise<VesselRelationshipDto[]> {
    assertClientsModule(user);
    return this.relationships.list(tenant, { vesselId: id }, query.status);
  }

  @Post('vessels/:id/relationships')
  @RequirePermission('vessel.manage')
  link(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @uuid('id') id: string,
    @body(createRelationshipSchema) input: z.output<typeof createRelationshipSchema>,
  ): Promise<VesselRelationshipDto> {
    assertClientsModule(user);
    return this.relationships.create(tenant, id, input, user);
  }

  @Patch('relationships/:id')
  @RequirePermission('vessel.manage')
  updateRelationship(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @uuid('id') id: string,
    @body(updateRelationshipSchema) input: z.output<typeof updateRelationshipSchema>,
  ): Promise<VesselRelationshipDto> {
    assertClientsModule(user);
    return this.relationships.update(tenant, id, input, user);
  }

  @Post('relationships/:id/end')
  @RequirePermission('vessel.manage')
  end(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @uuid('id') id: string,
    @body(endRelationshipSchema) input: z.output<typeof endRelationshipSchema>,
  ): Promise<VesselRelationshipDto> {
    assertClientsModule(user);
    return this.relationships.end(tenant, id, input.endDate, user);
  }

  @Put('relationships/:id/fleet')
  @RequirePermission('fleet.manage')
  setFleet(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @uuid('id') id: string,
    @body(setRelationshipFleetSchema) input: z.output<typeof setRelationshipFleetSchema>,
  ): Promise<VesselRelationshipDto> {
    assertClientsModule(user);
    return this.relationships.setFleet(tenant, id, input.fleetId, user);
  }

  @Get('clients/:id/vessels')
  clientVessels(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @uuid('id') id: string,
    @statusQuery query: z.output<typeof relationshipListQuerySchema>,
  ): Promise<VesselRelationshipDto[]> {
    assertClientsModule(user);
    return this.relationships.list(tenant, { clientId: id }, query.status);
  }

  @Get('clients/:id/fleets')
  clientFleets(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @uuid('id') id: string,
  ): Promise<FleetDto[]> {
    assertClientsModule(user);
    return this.fleets.listForClient(tenant, id);
  }

  @Get('fleets/:id')
  fleet(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @uuid('id') id: string,
  ): Promise<FleetDto> {
    assertClientsModule(user);
    return this.fleets.get(tenant, id);
  }

  @Post('fleets')
  @RequirePermission('fleet.manage')
  createFleet(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @body(createFleetSchema) input: z.output<typeof createFleetSchema>,
  ): Promise<FleetDto> {
    assertClientsModule(user);
    return this.fleets.create(tenant, input, user);
  }

  @Patch('fleets/:id')
  @RequirePermission('fleet.manage')
  updateFleet(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @uuid('id') id: string,
    @body(updateFleetSchema) input: z.output<typeof updateFleetSchema>,
  ): Promise<FleetDto> {
    assertClientsModule(user);
    return this.fleets.update(tenant, id, input, user);
  }
}
