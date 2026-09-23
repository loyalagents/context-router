import { Module } from '@nestjs/common';
import { ResetResolver } from './reset.resolver';
import { UserDataResetService } from './user-data-reset.service';

@Module({
  imports: [],
  providers: [ResetResolver, UserDataResetService],
})
export class ResetModule {}
