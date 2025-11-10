import { Module } from '@nestjs/common';
import { ExternalIdentityService } from './external-identity.service';
import { ExternalIdentityRepository } from './external-identity.repository';

@Module({
  providers: [ExternalIdentityService, ExternalIdentityRepository],
  exports: [ExternalIdentityService],
})
export class ExternalIdentityModule {}
