import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { HUMAN_AUTH_STRATEGY } from '../../domains/shared/ports/human-auth.constants';

/**
 * JWT Authentication Guard for REST endpoints
 * Uses the provider-neutral human strategy selected by the composition root.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard(HUMAN_AUTH_STRATEGY) {}
