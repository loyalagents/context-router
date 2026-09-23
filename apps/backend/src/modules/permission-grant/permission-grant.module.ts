import { Module } from '@nestjs/common';
import { PermissionGrantResolver } from './permission-grant.resolver';
import { PermissionGrantService } from './permission-grant.service';

@Module({
  imports: [],
  providers: [
    PermissionGrantService,
    PermissionGrantResolver,
  ],
  exports: [PermissionGrantService],
})
export class PermissionGrantModule {}
