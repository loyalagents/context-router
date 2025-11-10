import { Module } from '@nestjs/common';
import { LocationService } from './location.service';
import { LocationRepository } from './location.repository';
import { LocationResolver } from './location.resolver';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [LocationService, LocationRepository, LocationResolver],
  exports: [LocationService],
})
export class LocationModule {}
