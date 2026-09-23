import { postgresStorageFixture } from "./postgres-storage.fixture";
import { storageContract } from "./storage.contract";

storageContract("PostgreSQL", postgresStorageFixture);
