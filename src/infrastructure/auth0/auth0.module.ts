import { Module, Global } from '@nestjs/common';
import { Auth0Service } from './auth0.service';

@Global()
@Module({
  providers: [Auth0Service],
  exports: [Auth0Service],
})
export class Auth0Module {}
