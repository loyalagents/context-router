import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { CreateUserInput } from './dto/create-user.input';
import { UpdateUserInput } from './dto/update-user.input';
import { User } from '@prisma/client';

@Injectable()
export class UserRepository {
  private readonly logger = new Logger(UserRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateUserInput): Promise<User> {
    this.logger.log(`Creating user with email: ${data.email}`);
    return this.prisma.user.create({
      data: {
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
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
    this.logger.log(`Fetching user with ID: ${userId}`);
    return this.prisma.user.findUnique({
      where: { userId },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    this.logger.log(`Fetching user with email: ${email}`);
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async update(userId: string, data: Partial<UpdateUserInput>): Promise<User> {
    this.logger.log(`Updating user with ID: ${userId}`);
    return this.prisma.user.update({
      where: { userId },
      data: {
        ...(data.email && { email: data.email }),
        ...(data.firstName && { firstName: data.firstName }),
        ...(data.lastName && { lastName: data.lastName }),
      },
    });
  }

  async delete(userId: string): Promise<User> {
    this.logger.log(`Deleting user with ID: ${userId}`);
    return this.prisma.user.delete({
      where: { userId },
    });
  }

  async count(): Promise<number> {
    return this.prisma.user.count();
  }
}
