import { Module } from '@nestjs/common';
import { LocationModule } from './location/location.module';
import { PreferenceModule } from './preference/preference.module';

@Module({
  imports: [LocationModule, PreferenceModule],
  exports: [LocationModule, PreferenceModule],
})
export class PreferencesModule {}
