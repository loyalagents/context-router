import { Module } from '@nestjs/common';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { PermissionGrantRepository } from './permission-grant.repository';
import { PermissionGrantResolver } from './permission-grant.resolver';
import { PermissionGrantService } from './permission-grant.service';

@Module({
  imports: [PrismaModule],
  providers: [
    PermissionGrantRepository,
    PermissionGrantService,
    PermissionGrantResolver,
  ],
  exports: [PermissionGrantRepository, PermissionGrantService],
})
export class PermissionGrantModule {}
