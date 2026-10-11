import { validateManagedCapability } from "./managed-admission";

const id = "a".repeat(32);
const pin = { dev: 1, ino: 2 };
const capability = () => ({
  version: 1, epoch: 1, envelope: "/private/pilot/managed-v1",
  installationId: id, storeId: id, generation: id, bootId: "boot-1",
  role: "prepare", operation: "initialize", nonce: "b".repeat(64),
  envelopePin: pin, lockPin: pin, dataPin: null, identityPin: null, targetId: null,
});

describe("managed inherited capability grammar (parsing never grants admission)", () => {
  it("accepts only the exact versioned reserved-pair capability", () => {
    expect(validateManagedCapability(capability())).toEqual(capability());
  });
  it.each([
    ["version", 2], ["epoch", 0], ["envelope", "/private/pilot/other"],
    ["envelope", "/private/../managed-v1"], ["envelope", "managed-v1"],
    ["nonce", "b".repeat(63)], ["role", "browser"], ["operation", "anything"],
    ["storeId", "../escape"], ["generation", ""], ["bootId", "\n"],
    ["lockPin", { dev: 1, ino: -1 }], ["envelopePin", { dev: 1, ino: 2, extra: true }],
    ["dataPin", null], ["targetId", "bad-target"],
  ])("rejects malformed %s", (key, value) => {
    const source = { ...capability(), [key as string]: value };
    if (key === "dataPin") Object.assign(source, { role: "application", operation: "serve" });
    expect(() => validateManagedCapability(source)).toThrow("Storage operation failed");
  });
  it("rejects ambient fields, omitted fields, null, arrays and oversized values", () => {
    const omitted = capability() as any;
    delete omitted.bootId;
    for (const source of [{ ...capability(), authorized: true }, omitted, null, [],
      { ...capability(), envelope: "/" + "x".repeat(20_000) + "/managed-v1" }]) {
      expect(() => validateManagedCapability(source)).toThrow();
    }
  });
  it("requires a pinned target and both roots for an application", () => {
    const source = { ...capability(), role: "application", operation: "serve", dataPin: pin, identityPin: pin, targetId: "c".repeat(43) };
    expect(validateManagedCapability(source)).toEqual(source);
    expect(() => validateManagedCapability({ ...source, operation: "initialize" })).toThrow();
    expect(() => validateManagedCapability({ ...source, identityPin: null })).toThrow();
  });
});
