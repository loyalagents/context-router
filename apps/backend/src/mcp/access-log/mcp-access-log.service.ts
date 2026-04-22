import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { McpAccessEventInput } from './access-log.types';

@Injectable()
export class McpAccessLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: McpAccessEventInput): Promise<void> {
    const operationName = event.operationName.trim();
    const clientKey = event.clientKey.trim();
    const correlationId = event.correlationId.trim();

    if (!operationName) {
      throw new Error('MCP access event operationName is required');
    }
    if (!clientKey) {
      throw new Error('MCP access event clientKey is required');
    }
    if (!correlationId) {
      throw new Error('MCP access event correlationId is required');
    }

    await this.prisma.mcpAccessEvent.create({
      data: {
        userId: event.userId,
        clientKey,
        surface: event.surface,
        operationName,
        outcome: event.outcome,
        correlationId,
        latencyMs: Math.max(0, Math.round(event.latencyMs)),
        requestMetadata: event.requestMetadata ?? undefined,
        responseMetadata: event.responseMetadata ?? undefined,
        errorMetadata: event.errorMetadata ?? undefined,
      },
    });
  }
}
