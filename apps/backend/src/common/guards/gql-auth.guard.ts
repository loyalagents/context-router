import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthGuard } from '@nestjs/passport';
import { HUMAN_AUTH_STRATEGY } from '../../domains/shared/ports/human-auth.constants';

@Injectable()
export class GqlAuthGuard extends AuthGuard(HUMAN_AUTH_STRATEGY) {
  getRequest(context: ExecutionContext) {
    const ctx = GqlExecutionContext.create(context);
    return ctx.getContext().req;
  }
}
