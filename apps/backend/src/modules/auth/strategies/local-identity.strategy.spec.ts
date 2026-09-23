import passport from "passport";

import { HUMAN_AUTH_STRATEGY } from "../../../domains/shared/ports/human-auth.constants";
import type { OpenLocalIdentityState } from "../local-identity-filesystem";
import {
  digestLocalIdentityState,
  encodeLocalIdentityState,
  type LocalIdentityState,
} from "../local-identity-state.codec";
import { LocalIdentityStrategy } from "./local-identity.strategy";

const PRINCIPAL_ID = Buffer.alloc(32, 0x11).toString("base64url");
const CREDENTIAL = Buffer.alloc(32, 0x22).toString("base64url");
const ROTATED_CREDENTIAL = Buffer.alloc(32, 0x33).toString("base64url");

function ready(
  credential = CREDENTIAL,
  generation = 1,
): OpenLocalIdentityState {
  const state: LocalIdentityState = {
    schemaVersion: 1,
    databaseTargetId: Buffer.alloc(32, 0x44).toString("base64url"),
    principalId: PRINCIPAL_ID,
    credential,
    generation,
  };
  const bytes = encodeLocalIdentityState(state);
  return {
    state,
    bytes,
    digest: digestLocalIdentityState(bytes),
  };
}

function request(authorization?: string | string[], rawHeaders?: string[]) {
  return {
    headers: authorization === undefined ? {} : { authorization },
    ...(rawHeaders === undefined ? {} : { rawHeaders }),
  };
}

describe("LocalIdentityStrategy", () => {
  afterEach(() => {
    passport.unuse(HUMAN_AUTH_STRATEGY);
  });

  function createStrategy(states: OpenLocalIdentityState[]) {
    const openReadyState = jest.fn(async () => {
      const state = states.shift();
      if (!state) throw new Error("state-canary");
      return state;
    });
    const user = {
      userId: PRINCIPAL_ID,
      email: "local@principal.invalid",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const findOne = jest.fn(async () => user);
    const strategy = new LocalIdentityStrategy(
      { openReadyState } as never,
      { findOne } as never,
    );
    return { strategy, openReadyState, findOne, user };
  }

  it("binds the local verifier to the shared human strategy name", () => {
    const { strategy } = createStrategy([ready(), ready()]);
    expect(passport._strategy(HUMAN_AUTH_STRATEGY)).toBe(strategy);
  });

  it("returns the exact principal only after two unchanged canonical reads", async () => {
    const first = ready();
    const second = ready();
    const { strategy, openReadyState, findOne, user } = createStrategy([
      first,
      second,
    ]);

    await expect(
      strategy.validate(request(`Bearer ${CREDENTIAL}`) as never),
    ).resolves.toBe(user);
    expect(openReadyState).toHaveBeenCalledTimes(2);
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledWith(PRINCIPAL_ID);
  });

  it.each([
    ["missing", request()],
    ["array", request([`Bearer ${CREDENTIAL}`])],
    ["basic", request(`Basic ${CREDENTIAL}`)],
    ["lowercase scheme", request(`bearer ${CREDENTIAL}`)],
    ["extra leading whitespace", request(` Bearer ${CREDENTIAL}`)],
    ["extra trailing whitespace", request(`Bearer ${CREDENTIAL} `)],
    ["padded", request(`Bearer ${CREDENTIAL}=`)],
    ["short", request(`Bearer ${CREDENTIAL.slice(1)}`)],
    ["long", request(`Bearer ${CREDENTIAL}a`)],
    ["comma joined", request(`Bearer ${CREDENTIAL}, Bearer ${CREDENTIAL}`)],
    [
      "duplicate raw headers",
      request(`Bearer ${CREDENTIAL}`, [
        "Authorization",
        `Bearer ${CREDENTIAL}`,
        "authorization",
        `Bearer ${CREDENTIAL}`,
      ]),
    ],
  ])("rejects %s authorization without reading state", async (_name, req) => {
    const { strategy, openReadyState, findOne } = createStrategy([
      ready(),
      ready(),
    ]);

    await expect(strategy.validate(req as never)).resolves.toBe(false);
    expect(openReadyState).not.toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled();
  });

  it("collapses wrong credentials and state failures to the same denial", async () => {
    const wrong = Buffer.alloc(32, 0x55).toString("base64url");
    const { strategy, openReadyState, findOne } = createStrategy([ready()]);

    await expect(
      strategy.validate(request(`Bearer ${wrong}`) as never),
    ).resolves.toBe(false);
    expect(openReadyState).toHaveBeenCalledTimes(1);
    expect(findOne).not.toHaveBeenCalled();

    await expect(
      strategy.validate(request(`Bearer ${CREDENTIAL}`) as never),
    ).resolves.toBe(false);
  });

  it("denies the old credential when rotation linearizes before the second read", async () => {
    const { strategy, openReadyState, findOne } = createStrategy([
      ready(),
      ready(ROTATED_CREDENTIAL, 2),
    ]);

    await expect(
      strategy.validate(request(`Bearer ${CREDENTIAL}`) as never),
    ).resolves.toBe(false);
    expect(openReadyState).toHaveBeenCalledTimes(2);
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it("accepts the rotated credential only against two identical new reads", async () => {
    const rotated = ready(ROTATED_CREDENTIAL, 2);
    const { strategy, user } = createStrategy([
      rotated,
      ready(ROTATED_CREDENTIAL, 2),
    ]);

    await expect(
      strategy.validate(request(`Bearer ${ROTATED_CREDENTIAL}`) as never),
    ).resolves.toBe(user);
  });

  it("fails closed when the loaded principal does not match canonical state", async () => {
    const openReadyState = jest.fn(async () => ready());
    const findOne = jest.fn(async () => ({
      userId: Buffer.alloc(32, 0x66).toString("base64url"),
      email: "foreign@principal.invalid",
    }));
    const strategy = new LocalIdentityStrategy(
      { openReadyState } as never,
      { findOne } as never,
    );

    await expect(
      strategy.validate(request(`Bearer ${CREDENTIAL}`) as never),
    ).resolves.toBe(false);
    expect(openReadyState).toHaveBeenCalledTimes(1);
  });
});
