const { db } = require("./db");
const target = Number(process.argv[2] || 10000);

function init() {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
    CREATE INDEX IF NOT EXISTS idx_users_createdAt ON users(createdAt);
    CREATE INDEX IF NOT EXISTS idx_users_name ON users(name);
  `);

  const row = db.prepare("SELECT COUNT(*) as cnt FROM users").get();
  if (row.cnt > 0) {
    console.log(`✅ users already seeded: ${row.cnt}`);
    return;
  }

  const insert = db.prepare(
    "INSERT INTO users (name, email, status, createdAt) VALUES (?, ?, ?, ?)"
  );

  const statuses = ["ACTIVE", "INACTIVE"];
  const now = Date.now();

  const tx = db.transaction(() => {
    for (let i = 1; i <= target; i++) {
      const name = `User ${i}`;
      const email = `user${i}@example.com`;
      const status = statuses[i % 2];
      const createdAt = new Date(now - i * 1000 * 60).toISOString();
      insert.run(name, email, status, createdAt);
    }
  });

  tx();
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_createdAt_id ON users(createdAt, id);`);
  console.log(`✅ Seeded ${target} users`);
}

init();
