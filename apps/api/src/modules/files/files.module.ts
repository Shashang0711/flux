import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FILE_STORAGE, createFileStorage } from './storage';

@Module({
  controllers: [FilesController],
  providers: [
    FilesService,
    {
      provide: FILE_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createFileStorage((key) => config.get(key, { infer: true })),
    },
  ],
  exports: [FilesService, FILE_STORAGE],
})
export class FilesModule {}
