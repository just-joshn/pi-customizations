// Builds targets/fixture.db exactly as the captures did (Node >= 24.15, node:sqlite).
// Run: node sqlite-fixture.mjs
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("fixture.db");
db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER, email TEXT UNIQUE)");
db.exec("CREATE INDEX idx_users_name ON users(name)");
db.exec("CREATE TABLE audit_log (id INTEGER PRIMARY KEY, action TEXT, at TEXT)");
db.exec("CREATE VIEW adults AS SELECT * FROM users WHERE age >= 18");
db.exec("CREATE TRIGGER users_audit AFTER INSERT ON users BEGIN INSERT INTO audit_log(action, at) VALUES ('insert new', datetime('now')); END");
const insertUser = db.prepare("INSERT INTO users (name, age, email) VALUES (?, ?, ?)");
for (let i = 1; i <= 25; i += 1) insertUser.run(`user${i}`, 10 + i, `user${i}@example.com`);
db.prepare("INSERT INTO audit_log (action, at) VALUES (?, ?)").run("seed", "2026-01-01T00:00:00Z");
db.close();
