import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthGuard } from '@nestjs/passport';
import { HUMAN_AUTH_STRATEGY } from '../../domains/shared/ports/human-auth.constants';

@Injectable()
export class OptionalGqlAuthGuard extends AuthGuard(HUMAN_AUTH_STRATEGY) {
  getRequest(context: ExecutionContext) {
    const ctx = GqlExecutionContext.create(context);
    return ctx.getContext().req;
  }

  handleRequest(err: any, user: any) {
    // Allow requests without authentication to proceed
    // User will be undefined if no token provided
    return user;
  }
}
