import { Injectable, CanActivate } from "@nestjs/common";

/** Placeholder guard for MCP routes. Override in tests via createTestApp(). */
@Injectable()
export class McpAuthGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
