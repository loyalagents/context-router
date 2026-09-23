import { Module } from '@nestjs/common';
import { LocationService } from './location.service';
import { LocationResolver } from './location.resolver';

@Module({
  imports: [],
  providers: [LocationService, LocationResolver],
  exports: [LocationService],
})
export class LocationModule {}
