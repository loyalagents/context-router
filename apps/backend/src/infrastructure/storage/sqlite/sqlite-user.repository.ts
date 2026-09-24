import type { UserRepository } from "../../../modules/user/user.repository";
import type { User } from "../../../domains/shared/storage/storage-types";
import {
  SqliteAccess,
  decode,
  insert,
  update,
  remove,
  timestamped,
} from "./sqlite-records";
export class SqliteUserRepository
  extends SqliteAccess
  implements UserRepository
{
  create(data: { email: string }): Promise<User> {
    return this.call((c) =>
      insert<User>(c, "users", timestamped({ email: data.email }, "user_id")),
    );
  }
  findAll(): Promise<User[]> {
    return this.call((c) =>
      c
        .all("SELECT * FROM users ORDER BY created_at DESC")
        .map((row) => decode<User>(row)!),
    );
  }
  findOne(userId: string): Promise<User | null> {
    return this.call((c) =>
      decode<User>(c.get("SELECT * FROM users WHERE user_id=?", [userId])),
    );
  }
  update(userId: string, data: { email?: string }): Promise<User> {
    return this.call((c) =>
      update<User>(
        c,
        "users",
        "user_id",
        userId,
        data.email ? { email: data.email } : {},
      ),
    );
  }
  delete(userId: string): Promise<User> {
    return this.call((c) => remove<User>(c, "users", "user_id", userId));
  }
  count(): Promise<number> {
    return this.call((c) => c.get("SELECT count(*) n FROM users").n);
  }
}
