import { Module } from '@nestjs/common';
import { McpAccessLogQueryService } from './mcp-access-log-query.service';
import { McpAccessLogResolver } from './mcp-access-log.resolver';
import { McpAccessLogService } from './mcp-access-log.service';

@Module({
  providers: [
    McpAccessLogService,
    McpAccessLogQueryService,
    McpAccessLogResolver,
  ],
  exports: [McpAccessLogService, McpAccessLogQueryService],
})
export class McpAccessLogModule {}
