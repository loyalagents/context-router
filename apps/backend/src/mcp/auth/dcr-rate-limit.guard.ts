import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory rate limiter for the DCR shim endpoint.
 *
 * This is a basic implementation suitable for single-instance deployments.
 * For multi-instance/serverless deployments, consider using Redis or
 * Cloud Run's built-in rate limiting.
 */
@Injectable()
export class DcrRateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly logger = new Logger(DcrRateLimitGuard.name);
  private readonly requests = new Map<string, RateLimitEntry>();
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {
    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupInterval);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = this.getClientIp(request);

    const windowMs = this.configService.get<number>(
      'mcp.oauth.rateLimit.windowMs',
      60000,
    );
    const maxRequests = this.configService.get<number>(
      'mcp.oauth.rateLimit.maxRequests',
      30,
    );

    const now = Date.now();
    const entry = this.requests.get(ip);

    if (!entry || now > entry.resetAt) {
      // New window
      this.requests.set(ip, {
        count: 1,
        resetAt: now + windowMs,
      });
      return true;
    }

    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      this.logger.warn(
        `Rate limit exceeded for IP ${ip}: ${entry.count}/${maxRequests} requests`,
      );

      throw new HttpException(
        {
          error: 'too_many_requests',
          error_description: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    entry.count++;
    return true;
  }

  private getClientIp(request: Request): string {
    // Check common proxy headers (Cloud Run, nginx, etc.)
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded.split(',')[0];
      return ips.trim();
    }

    return request.ip || request.socket.remoteAddress || 'unknown';
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [ip, entry] of this.requests.entries()) {
      if (now > entry.resetAt) {
        this.requests.delete(ip);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired rate limit entries`);
    }
  }
}
