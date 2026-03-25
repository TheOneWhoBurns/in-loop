import BetterSqlite3 from "better-sqlite3";
import { join } from "path";
import { createTables } from "./schema.js";

export type DB = BetterSqlite3.Database;

export function initDB(dataDir: string): DB {
  const dbPath = join(dataDir, "inloop.sqlite");
  const db = new BetterSqlite3(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  createTables(db);

  return db;
}
