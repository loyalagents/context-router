import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserResolver } from './user.resolver';
import { UserRepository } from './user.repository';

@Module({
  providers: [UserResolver, UserService, UserRepository],
  exports: [UserService],
})
export class UserModule {}
