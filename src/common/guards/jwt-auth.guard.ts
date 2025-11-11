import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT Authentication Guard for REST endpoints
 * Uses the 'jwt' strategy defined in JwtStrategy
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
