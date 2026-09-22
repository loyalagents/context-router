import { ConflictException, NotFoundException } from "@nestjs/common";
import { UserService } from "./user.service";

describe("UserService identity diagnostics", () => {
  const emailCanary = "private-email-canary@example.com";
  const userIdCanary = "private-user-id-canary";

  it("preserves exception classes without exposing identity fields", async () => {
    const repository = {
      findByEmail: jest.fn().mockResolvedValue({ userId: "existing" }),
      findOne: jest.fn().mockResolvedValue(null),
    };
    const service = new UserService(repository as never);

    const createError = await service
      .create({ email: emailCanary })
      .catch((error) => error);
    expect(createError).toEqual(new ConflictException("User already exists"));
    expect(JSON.stringify(createError)).not.toContain(emailCanary);

    const findError = await service.findOne(userIdCanary).catch((error) => error);
    expect(findError).toEqual(new NotFoundException("User not found"));
    expect(JSON.stringify(findError)).not.toContain(userIdCanary);
  });
});
