import type { User } from "@/domains/shared/storage/storage-types";
type CreateUserInput = { email: string };
/** Application-owned persistence behavior, independent of database and transport types. */
export abstract class UserRepository {
  abstract create(data: CreateUserInput): Promise<User>;
  abstract findAll(): Promise<User[]>;
  abstract findOne(userId: string): Promise<User | null>;
  abstract update(
    userId: string,
    data: {
      email?: string;
    },
  ): Promise<User>;
  abstract delete(userId: string): Promise<User>;
  abstract count(): Promise<number>;
}
