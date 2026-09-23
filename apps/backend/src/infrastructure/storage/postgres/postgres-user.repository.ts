import { UserRepository } from "@/modules/user/user.repository";
import { postgresClient } from "./postgres-client";
import { Injectable, Logger } from "@nestjs/common";
import type { User } from "@/domains/shared/storage/storage-types";
import { Prisma } from "@infrastructure/prisma/generated-client";
type CreateUserInput = { email: string };

@Injectable()
export class PostgresUserRepository implements UserRepository {
  private readonly logger = new Logger(PostgresUserRepository.name);

  constructor(private prisma: Prisma.TransactionClient) {
    this.prisma = postgresClient(this.prisma);
  }

  async create(data: CreateUserInput): Promise<User> {
    this.logger.debug("Creating a user row");
    return this.prisma.user.create({
      data: {
        email: data.email,
      },
    });
  }

  async findAll(): Promise<User[]> {
    this.logger.log("Fetching all users");
    return this.prisma.user.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findOne(userId: string): Promise<User | null> {
    this.logger.debug("Fetching a user row");
    return this.prisma.user.findUnique({
      where: { userId },
    });
  }

  async update(userId: string, data: { email?: string }): Promise<User> {
    this.logger.debug("Updating a user row");
    return this.prisma.user.update({
      where: { userId },
      data: {
        ...(data.email && { email: data.email }),
      },
    });
  }

  async delete(userId: string): Promise<User> {
    this.logger.debug("Deleting a user row");
    return this.prisma.user.delete({
      where: { userId },
    });
  }

  async count(): Promise<number> {
    return this.prisma.user.count();
  }
}
