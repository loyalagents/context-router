import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { UserRepository } from './user.repository';
import { CreateUserInput } from './dto/create-user.input';
import { UpdateUserInput } from './dto/update-user.input';
import { User } from '@prisma/client';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private readonly userRepository: UserRepository) {}

  async create(createUserInput: CreateUserInput): Promise<User> {
    this.logger.log(`Creating new user: ${createUserInput.email}`);

    // Check if user already exists
    const existingUser = await this.userRepository.findByEmail(
      createUserInput.email,
    );

    if (existingUser) {
      throw new ConflictException(
        `User with email ${createUserInput.email} already exists`,
      );
    }

    return this.userRepository.create(createUserInput);
  }

  async findAll(): Promise<User[]> {
    this.logger.log('Fetching all users');
    return this.userRepository.findAll();
  }

  async findOne(userId: string): Promise<User> {
    this.logger.log(`Fetching user: ${userId}`);
    const user = await this.userRepository.findOne(userId);

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return user;
  }

  async update(updateUserInput: UpdateUserInput): Promise<User> {
    this.logger.log(`Updating user: ${updateUserInput.userId}`);

    // Verify user exists
    await this.findOne(updateUserInput.userId);

    // If email is being updated, check it's not already taken
    if (updateUserInput.email) {
      const existingUser = await this.userRepository.findByEmail(
        updateUserInput.email,
      );

      if (existingUser && existingUser.userId !== updateUserInput.userId) {
        throw new ConflictException(
          `Email ${updateUserInput.email} is already in use`,
        );
      }
    }

    return this.userRepository.update(
      updateUserInput.userId,
      updateUserInput,
    );
  }

  async remove(userId: string): Promise<User> {
    this.logger.log(`Removing user: ${userId}`);

    // Verify user exists
    await this.findOne(userId);

    return this.userRepository.delete(userId);
  }

  async count(): Promise<number> {
    return this.userRepository.count();
  }

  async findByEmail(email: string): Promise<User | null> {
    this.logger.log(`Fetching user by email: ${email}`);
    return this.userRepository.findByEmail(email);
  }
}
