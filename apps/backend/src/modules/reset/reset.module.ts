import { Module } from '@nestjs/common';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { ResetResolver } from './reset.resolver';
import { UserDataResetService } from './user-data-reset.service';

@Module({
  imports: [PrismaModule],
  providers: [ResetResolver, UserDataResetService],
})
export class ResetModule {}
