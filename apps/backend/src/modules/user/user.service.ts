import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import type { User } from '@infrastructure/prisma/prisma-models';
import { UserRepository } from './user.repository';
import { CreateUserInput } from './dto/create-user.input';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private readonly userRepository: UserRepository) {}

  async create(createUserInput: CreateUserInput): Promise<User> {
    this.logger.debug('Creating a user');
    return this.userRepository.create(createUserInput);
  }

  async findAll(): Promise<User[]> {
    this.logger.log('Fetching all users');
    return this.userRepository.findAll();
  }

  async findOne(userId: string): Promise<User> {
    this.logger.debug('Fetching a user');
    const user = await this.userRepository.findOne(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async remove(userId: string): Promise<User> {
    this.logger.debug('Removing a user');

    // Verify user exists
    await this.findOne(userId);

    return this.userRepository.delete(userId);
  }

  async count(): Promise<number> {
    return this.userRepository.count();
  }
}
