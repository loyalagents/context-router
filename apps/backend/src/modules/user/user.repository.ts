import { Injectable, Logger } from '@nestjs/common';
import type { User } from '@infrastructure/prisma/prisma-models';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { CreateUserInput } from './dto/create-user.input';

@Injectable()
export class UserRepository {
  private readonly logger = new Logger(UserRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateUserInput): Promise<User> {
    this.logger.debug('Creating a user row');
    return this.prisma.user.create({
      data: {
        email: data.email,
      },
    });
  }

  async findAll(): Promise<User[]> {
    this.logger.log('Fetching all users');
    return this.prisma.user.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(userId: string): Promise<User | null> {
    this.logger.debug('Fetching a user row');
    return this.prisma.user.findUnique({
      where: { userId },
    });
  }

  async update(userId: string, data: { email?: string }): Promise<User> {
    this.logger.debug('Updating a user row');
    return this.prisma.user.update({
      where: { userId },
      data: {
        ...(data.email && { email: data.email }),
      },
    });
  }

  async delete(userId: string): Promise<User> {
    this.logger.debug('Deleting a user row');
    return this.prisma.user.delete({
      where: { userId },
    });
  }

  async count(): Promise<number> {
    return this.prisma.user.count();
  }
}
