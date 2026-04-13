import { Injectable } from '@nestjs/common';
import {
  GrantAction,
  GrantEffect,
} from '@infrastructure/prisma/generated-client';
import { PrismaService } from '@infrastructure/prisma/prisma.service';

@Injectable()
export class PermissionGrantRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(
    userId: string,
    clientKey: string,
    target: string,
    action: GrantAction,
    effect: GrantEffect,
  ) {
    return this.prisma.permissionGrant.upsert({
      where: {
        userId_clientKey_target_action: {
          userId,
          clientKey,
          target,
          action,
        },
      },
      create: {
        userId,
        clientKey,
        target,
        action,
        effect,
      },
      update: {
        effect,
      },
    });
  }

  async remove(
    userId: string,
    clientKey: string,
    target: string,
    action: GrantAction,
  ) {
    await this.prisma.permissionGrant.delete({
      where: {
        userId_clientKey_target_action: {
          userId,
          clientKey,
          target,
          action,
        },
      },
    });
  }

  async findByUserAndClient(userId: string, clientKey: string) {
    return this.prisma.permissionGrant.findMany({
      where: {
        userId,
        clientKey,
      },
      orderBy: [{ action: 'asc' }, { target: 'asc' }],
    });
  }

  async findByUserClientAction(
    userId: string,
    clientKey: string,
    action: GrantAction,
  ) {
    return this.prisma.permissionGrant.findMany({
      where: {
        userId,
        clientKey,
        action,
      },
      orderBy: { target: 'asc' },
    });
  }

  async findByUser(userId: string) {
    return this.prisma.permissionGrant.findMany({
      where: { userId },
      orderBy: [{ clientKey: 'asc' }, { action: 'asc' }, { target: 'asc' }],
    });
  }

  async findMatchingGrants(
    userId: string,
    clientKey: string,
    action: GrantAction,
    prefixChain: string[],
  ) {
    const rows = await this.prisma.permissionGrant.findMany({
      where: {
        userId,
        clientKey,
        action,
        target: {
          in: prefixChain,
        },
      },
    });

    return rows.sort((a, b) => b.target.length - a.target.length);
  }
}
