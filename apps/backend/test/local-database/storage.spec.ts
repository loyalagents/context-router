import { storageContract } from "../integration/storage-contracts/storage.contract";
import { sqliteStorageFixture } from "./storage.fixture";
storageContract("SQLite file-backed", sqliteStorageFixture);
