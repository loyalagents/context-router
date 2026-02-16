import { Global, Module } from '@nestjs/common';
import { AuthResolver } from './auth.resolver';
import { ApiKeyService } from './api-key.service';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [ApiKeyService, ApiKeyGuard, AuthResolver],
  exports: [ApiKeyService, ApiKeyGuard],
})
export class AuthModule {}
