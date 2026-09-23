import { timingSafeEqual } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import type { Request } from "express";
import passport from "passport";

import { HUMAN_AUTH_STRATEGY } from "../../../domains/shared/ports/human-auth.constants";
import type { User } from "../../../infrastructure/prisma/prisma-models";
import { UserService } from "../../user/user.service";
import { LocalIdentityFileStore } from "../local-identity-filesystem";

type LocalIdentityVerify = (
  request: Request,
  done: (error: unknown, user?: Express.User | false | null) => void,
) => void;

class LocalIdentityPassportStrategy extends passport.Strategy {
  constructor(private readonly verifyRequest: LocalIdentityVerify) {
    super();
  }

  authenticate(request: Request): void {
    const result =
      this as passport.StrategyCreated<LocalIdentityPassportStrategy>;
    this.verifyRequest(request, (error, user) => {
      if (error) {
        result.error(error);
      } else if (!user) {
        result.fail(401);
      } else {
        result.success(user);
      }
    });
  }
}

function readStrictBearer(request: Pick<Request, "headers" | "rawHeaders">) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string") return null;

  if (Array.isArray(request.rawHeaders)) {
    let authorizationCount = 0;
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (request.rawHeaders[index]?.toLowerCase() === "authorization") {
        authorizationCount += 1;
      }
    }
    if (authorizationCount !== 1) return null;
  }

  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  if (!match) return null;
  const credential = Buffer.from(match[1], "base64url");
  if (
    credential.byteLength !== 32 ||
    credential.toString("base64url") !== match[1]
  ) {
    credential.fill(0);
    return null;
  }
  return credential;
}

function equalBytes(left: Buffer, right: Buffer): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

@Injectable()
export class LocalIdentityStrategy extends PassportStrategy(
  LocalIdentityPassportStrategy,
  HUMAN_AUTH_STRATEGY,
) {
  constructor(
    private readonly stateReader: LocalIdentityFileStore,
    private readonly userService: UserService,
  ) {
    super();
  }

  async validate(request: Request): Promise<User | false> {
    const suppliedCredential = readStrictBearer(request);
    if (!suppliedCredential) return false;

    try {
      const first = await this.stateReader.openReadyState();
      const expectedCredential = Buffer.from(
        first.state.credential,
        "base64url",
      );
      try {
        if (!equalBytes(suppliedCredential, expectedCredential)) return false;
      } finally {
        expectedCredential.fill(0);
      }

      const user = await this.userService.findOne(first.state.principalId);
      if (user.userId !== first.state.principalId) return false;

      const second = await this.stateReader.openReadyState();
      const secondCredential = Buffer.from(
        second.state.credential,
        "base64url",
      );
      try {
        if (!equalBytes(suppliedCredential, secondCredential)) return false;
      } finally {
        secondCredential.fill(0);
      }

      if (!equalBytes(first.bytes, second.bytes)) return false;
      return user;
    } catch {
      return false;
    } finally {
      suppliedCredential.fill(0);
    }
  }
}
