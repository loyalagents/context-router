import { Module } from '@nestjs/common';
import { ExternalIdentityService } from './external-identity.service';

@Module({
  providers: [ExternalIdentityService, ],
  exports: [ExternalIdentityService],
})
export class ExternalIdentityModule {}
