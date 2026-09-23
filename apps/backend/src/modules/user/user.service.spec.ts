import { NotFoundException } from '@nestjs/common';
import { UserService } from './user.service';

describe('UserService identity diagnostics', () => {
  const emailCanary = 'private-email-canary@example.com';
  const userIdCanary = 'private-user-id-canary';

  it('creates duplicate account attributes without using email as identity', async () => {
    const repository = {
      create: jest.fn().mockResolvedValue({
        userId: 'new-principal',
        email: emailCanary,
      }),
      findOne: jest.fn().mockResolvedValue(null),
    };
    const service = new UserService(repository as never);

    await expect(service.create({ email: emailCanary })).resolves.toEqual({
      userId: 'new-principal',
      email: emailCanary,
    });
    expect(repository.create).toHaveBeenCalledWith({ email: emailCanary });
  });

  it('preserves not-found class without exposing the principal', async () => {
    const repository = { findOne: jest.fn().mockResolvedValue(null) };
    const service = new UserService(repository as never);

    const findError = await service
      .findOne(userIdCanary)
      .catch((error) => error);
    expect(findError).toEqual(new NotFoundException('User not found'));
    expect(JSON.stringify(findError)).not.toContain(userIdCanary);
  });
});
