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
  bottleLinesSchema,
  createBottleTypeSchema,
  createLabCategorySchema,
  createProductSchema,
  createRegistrationFieldSchema,
  createServiceTypeSchema,
  createVariantSchema,
  labListQuerySchema,
  registrationCheckSchema,
  updateBottleTypeSchema,
  updateLabCategorySchema,
  updateProductSchema,
  updateRegistrationFieldSchema,
  updateServiceTypeSchema,
  updateVariantSchema,
  type BottleTypeDto,
  type LabCategoryDto,
  type LabListQuery,
  type ProductDto,
  type ProductSummaryDto,
  type RegistrationCheckResultDto,
  type ServiceTypeDto,
  type ServiceTypeSummaryDto,
  type StarterImportResultDto,
} from '@flux/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { CurrentTenant, CurrentUser, RequireModule, RequirePermission } from '../auth/decorators';
import { CatalogueService } from './catalogue.service';
import { KitsService } from './kits.service';
import { StarterService } from './starter.service';

const body = <T extends z.ZodType>(schema: T) => Body(new ZodValidationPipe(schema));
const uuid = (name = 'id') => Param(name, ParseUUIDPipe);
const listQuery = Query(new ZodValidationPipe(labListQuerySchema));
type Out<T extends z.ZodType> = z.output<T>;

/**
 * Laboratory master data (design pack §7). Needs the Laboratory Setup module; reads need
 * lab-setup.view, changes lab-setup.manage.
 */
@Controller('lab')
@RequireModule('lab-setup')
@RequirePermission('lab-setup.view')
export class LabController {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly kits: KitsService,
    private readonly starter: StarterService,
  ) {}

  // ─── Categories ───────────────────────────────────────────────────────────

  @Get('categories')
  categories(
    @CurrentTenant() t: TenantContext,
    @listQuery q: LabListQuery,
  ): Promise<LabCategoryDto[]> {
    return this.catalogue.listCategories(t, q);
  }

  @Post('categories')
  @RequirePermission('lab-setup.manage')
  createCategory(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @body(createLabCategorySchema) input: Out<typeof createLabCategorySchema>,
  ): Promise<LabCategoryDto[]> {
    return this.catalogue.createCategory(t, input, u);
  }

  @Patch('categories/:id')
  @RequirePermission('lab-setup.manage')
  updateCategory(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @body(updateLabCategorySchema) input: Out<typeof updateLabCategorySchema>,
  ): Promise<LabCategoryDto[]> {
    return this.catalogue.updateCategory(t, id, input, u);
  }

  // ─── Service types and registration fields ────────────────────────────────

  @Get('service-types')
  serviceTypes(
    @CurrentTenant() t: TenantContext,
    @listQuery q: LabListQuery,
  ): Promise<ServiceTypeSummaryDto[]> {
    return this.catalogue.listServiceTypes(t, q);
  }

  @Get('service-types/:id')
  serviceType(@CurrentTenant() t: TenantContext, @uuid() id: string): Promise<ServiceTypeDto> {
    return this.catalogue.getServiceType(t, id);
  }

  @Post('service-types')
  @RequirePermission('lab-setup.manage')
  createServiceType(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @body(createServiceTypeSchema) input: Out<typeof createServiceTypeSchema>,
  ): Promise<ServiceTypeDto> {
    return this.catalogue.createServiceType(t, input, u);
  }

  @Patch('service-types/:id')
  @RequirePermission('lab-setup.manage')
  updateServiceType(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @body(updateServiceTypeSchema) input: Out<typeof updateServiceTypeSchema>,
  ): Promise<ServiceTypeDto> {
    return this.catalogue.updateServiceType(t, id, input, u);
  }

  @Post('service-types/:id/fields')
  @RequirePermission('lab-setup.manage')
  addField(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @body(createRegistrationFieldSchema) input: Out<typeof createRegistrationFieldSchema>,
  ): Promise<ServiceTypeDto> {
    return this.catalogue.addField(t, id, input, u);
  }

  @Patch('registration-fields/:id')
  @RequirePermission('lab-setup.manage')
  updateField(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @body(updateRegistrationFieldSchema) input: Out<typeof updateRegistrationFieldSchema>,
  ): Promise<ServiceTypeDto> {
    return this.catalogue.updateField(t, id, input, u);
  }

  /** Validates registration values exactly as sample registration will; changes nothing. */
  @Post('service-types/:id/registration-check')
  checkRegistration(
    @CurrentTenant() t: TenantContext,
    @uuid() id: string,
    @body(registrationCheckSchema) input: Out<typeof registrationCheckSchema>,
  ): Promise<RegistrationCheckResultDto> {
    return this.catalogue.checkRegistration(t, id, input);
  }

  // ─── Bottle types ─────────────────────────────────────────────────────────

  @Get('bottle-types')
  bottleTypes(
    @CurrentTenant() t: TenantContext,
    @listQuery q: LabListQuery,
  ): Promise<BottleTypeDto[]> {
    return this.kits.listBottleTypes(t, q);
  }

  @Post('bottle-types')
  @RequirePermission('lab-setup.manage')
  createBottleType(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @body(createBottleTypeSchema) input: Out<typeof createBottleTypeSchema>,
  ): Promise<BottleTypeDto[]> {
    return this.kits.createBottleType(t, input, u);
  }

  @Patch('bottle-types/:id')
  @RequirePermission('lab-setup.manage')
  updateBottleType(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @body(updateBottleTypeSchema) input: Out<typeof updateBottleTypeSchema>,
  ): Promise<BottleTypeDto[]> {
    return this.kits.updateBottleType(t, id, input, u);
  }

  // ─── Kits and variants ────────────────────────────────────────────────────

  @Get('products')
  products(
    @CurrentTenant() t: TenantContext,
    @listQuery q: LabListQuery,
  ): Promise<ProductSummaryDto[]> {
    return this.kits.listProducts(t, q);
  }

  @Get('products/:id')
  product(@CurrentTenant() t: TenantContext, @uuid() id: string): Promise<ProductDto> {
    return this.kits.getProduct(t, id);
  }

  @Post('products')
  @RequirePermission('lab-setup.manage')
  createProduct(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @body(createProductSchema) input: Out<typeof createProductSchema>,
  ): Promise<ProductDto> {
    return this.kits.createProduct(t, input, u);
  }

  @Patch('products/:id')
  @RequirePermission('lab-setup.manage')
  updateProduct(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @body(updateProductSchema) input: Out<typeof updateProductSchema>,
  ): Promise<ProductDto> {
    return this.kits.updateProduct(t, id, input, u);
  }

  @Put('products/:id/bottles')
  @RequirePermission('lab-setup.manage')
  setProductBottles(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @body(bottleLinesSchema) input: Out<typeof bottleLinesSchema>,
  ): Promise<ProductDto> {
    return this.kits.setProductBottles(t, id, input.bottles, u);
  }

  @Post('products/:id/variants')
  @RequirePermission('lab-setup.manage')
  addVariant(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @body(createVariantSchema) input: Out<typeof createVariantSchema>,
  ): Promise<ProductDto> {
    return this.kits.addVariant(t, id, input, u);
  }

  @Patch('variants/:id')
  @RequirePermission('lab-setup.manage')
  updateVariant(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @body(updateVariantSchema) input: Out<typeof updateVariantSchema>,
  ): Promise<ProductDto> {
    return this.kits.updateVariant(t, id, input, u);
  }

  @Put('variants/:id/bottles')
  @RequirePermission('lab-setup.manage')
  setVariantBottles(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @body(bottleLinesSchema) input: Out<typeof bottleLinesSchema>,
  ): Promise<ProductDto> {
    return this.kits.setVariantBottles(t, id, input.bottles, u);
  }

  // ─── Starter catalogue ────────────────────────────────────────────────────

  @Post('starter-catalogue')
  @RequirePermission('lab-setup.manage')
  importStarter(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
  ): Promise<StarterImportResultDto> {
    return this.starter.import(t, u);
  }
}
