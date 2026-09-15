import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";

import {
  assertCatalogState,
  assertGenerationStatesEqual,
  assertNonLoopbackUnreachable,
  createSignedTestToken,
  enumerateNonLoopbackAddresses,
  stopBackendProcess,
  waitForReadiness,
  withCleanupStack,
} from "./restart-smoke.mjs";

test("ephemeral test token is RS256-signed and contains the bounded M2M claims", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const token = createSignedTestToken({
    privateKey,
    kid: "smoke-key",
    issuer: "https://127.0.0.1:4443/",
    audience: "urn:context-router:smoke",
    subject: "migration-smoke@clients",
    clientId: "migration-smoke-client",
    nowSeconds: 1_700_000_000,
  });
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(encodedHeader, "base64url").toString()), {
    alg: "RS256",
    kid: "smoke-key",
    typ: "JWT",
  });
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
  assert.deepEqual(payload, {
    iss: "https://127.0.0.1:4443/",
    aud: "urn:context-router:smoke",
    sub: "migration-smoke@clients",
    azp: "migration-smoke-client",
    scope: "preferences:read",
    iat: 1_700_000_000,
    nbf: 1_699_999_995,
    exp: 1_700_000_300,
  });
  assert.equal(
    verify(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      publicKey,
      Buffer.from(encodedSignature, "base64url"),
    ),
    true,
  );
});

test("catalog state rejects duplicates and generation comparison pins IDs, slugs, count, and principal", () => {
  const state = {
    catalog: [
      { id: "id-a", slug: "a" },
      { id: "id-b", slug: "b" },
    ],
    principalId: "principal-1",
  };
  assert.deepEqual(assertCatalogState(state.catalog, 2), state.catalog);
  assert.doesNotThrow(() => assertGenerationStatesEqual(state, structuredClone(state)));
  assert.throws(
    () => assertCatalogState([...state.catalog, { id: "id-c", slug: "a" }], 3),
    /duplicate catalog slug/,
  );
  assert.throws(
    () => assertGenerationStatesEqual(state, { ...state, principalId: "principal-2" }),
    /principal changed/,
  );
});

test("readiness fails promptly on early exit and times out boundedly", async () => {
  await assert.rejects(
    waitForReadiness({
      deadlineMs: 100,
      request: async () => {
        throw new Error("not ready");
      },
      processStatus: () => ({ exited: true, exitCode: 12, signal: null }),
      delay: async () => {},
    }),
    /exited before readiness.*12/,
  );

  let now = 0;
  await assert.rejects(
    waitForReadiness({
      deadlineMs: 20,
      request: async () => ({ status: 503, body: {} }),
      processStatus: () => ({ exited: false }),
      now: () => (now += 10),
      delay: async () => {},
    }),
    /readiness timed out/,
  );
});

test("bounded process stop records SIGTERM success and scoped SIGKILL fallback", async () => {
  const gracefulSignals = [];
  const graceful = await stopBackendProcess(
    {
      exitCode: null,
      signalCode: null,
      kill(signal) {
        gracefulSignals.push(signal);
        this.exitCode = 0;
        return true;
      },
    },
    { waitForExit: async () => true, timeoutMs: 10 },
  );
  assert.deepEqual(gracefulSignals, ["SIGTERM"]);
  assert.equal(graceful.usedSigkill, false);

  const forcedSignals = [];
  const child = {
    exitCode: null,
    signalCode: null,
    kill(signal) {
      forcedSignals.push(signal);
      if (signal === "SIGKILL") this.signalCode = signal;
      return true;
    },
  };
  let waits = 0;
  const forced = await stopBackendProcess(child, {
    waitForExit: async () => ++waits > 1,
    timeoutMs: 10,
  });
  assert.deepEqual(forcedSignals, ["SIGTERM", "SIGKILL"]);
  assert.equal(forced.usedSigkill, true);
});

test("network negative probes cover only non-internal, non-loopback interfaces", async () => {
  assert.deepEqual(
    enumerateNonLoopbackAddresses({
      lo0: [{ address: "127.0.0.1", internal: true }],
      en0: [
        { address: "192.0.2.4", internal: false },
        { address: "::1", internal: false },
      ],
    }),
    ["192.0.2.4"],
  );
  const attempted = [];
  await assert.doesNotReject(
    assertNonLoopbackUnreachable(["192.0.2.4", "2001:db8::1"], 4010, async (host) => {
      attempted.push(host);
      return false;
    }),
  );
  assert.deepEqual(attempted, ["192.0.2.4", "2001:db8::1"]);
  await assert.rejects(
    assertNonLoopbackUnreachable(["192.0.2.4"], 4010, async () => true),
    /reachable through non-loopback/,
  );
});

test("cleanup stack runs in reverse order and preserves cleanup failures with the primary error", async () => {
  const calls = [];
  await assert.rejects(
    withCleanupStack(async (defer) => {
      defer(async () => calls.push("first"));
      defer(async () => {
        calls.push("second");
        throw new Error("cleanup failed");
      });
      throw new Error("primary failed");
    }),
    (error) => {
      assert.match(error.message, /primary failed/);
      assert.match(error.message, /cleanup failed/);
      return true;
    },
  );
  assert.deepEqual(calls, ["second", "first"]);
});
