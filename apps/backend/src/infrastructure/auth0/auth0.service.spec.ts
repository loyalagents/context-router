const mockGetUser = jest.fn();
const mockUpdateUser = jest.fn();

jest.mock("auth0", () => ({
  ManagementClient: jest.fn().mockImplementation(() => ({
    users: {
      get: mockGetUser,
      update: mockUpdateUser,
    },
  })),
  AuthenticationClient: jest.fn().mockImplementation(() => ({})),
}));

import { Logger } from "@nestjs/common";
import { Auth0Service } from "./auth0.service";

describe("Auth0Service diagnostics", () => {
  function createService() {
    const values: Record<string, string> = {
      "auth.auth0.domain": "tenant.auth0.test",
      "auth.auth0.clientId": "client-id",
      "auth.auth0.clientSecret": "client-secret",
    };
    return new Auth0Service({
      get: jest.fn((key: string) => values[key]),
    } as never);
  }

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it("does not log the raw Auth0 subject or upstream error cause", async () => {
    const debug = jest.spyOn(Logger.prototype, "debug");
    const error = jest.spyOn(Logger.prototype, "error");
    mockGetUser.mockRejectedValueOnce(new Error("upstream-cause-canary"));
    const service = createService();

    await expect(service.getUserInfo("auth0|subject-canary")).rejects.toThrow(
      "upstream-cause-canary",
    );

    expect(debug).toHaveBeenCalledWith("Fetching Auth0 user profile");
    expect(error).toHaveBeenCalledWith("Auth0 user profile request failed");
    const diagnostics = JSON.stringify([...debug.mock.calls, ...error.mock.calls]);
    expect(diagnostics).not.toContain("subject-canary");
    expect(diagnostics).not.toContain("upstream-cause-canary");
  });

  it("does not log raw metadata on update failure", async () => {
    const debug = jest.spyOn(Logger.prototype, "debug");
    const error = jest.spyOn(Logger.prototype, "error");
    mockUpdateUser.mockRejectedValueOnce(new Error("metadata-cause-canary"));
    const service = createService();

    await expect(
      service.updateUserMetadata("auth0|subject-canary", {
        private: "metadata-value-canary",
      }),
    ).rejects.toThrow("metadata-cause-canary");

    expect(debug).toHaveBeenCalledWith("Updating Auth0 user metadata");
    expect(error).toHaveBeenCalledWith("Auth0 user metadata request failed");
    const diagnostics = JSON.stringify([...debug.mock.calls, ...error.mock.calls]);
    expect(diagnostics).not.toContain("subject-canary");
    expect(diagnostics).not.toContain("metadata-value-canary");
    expect(diagnostics).not.toContain("metadata-cause-canary");
  });
});
