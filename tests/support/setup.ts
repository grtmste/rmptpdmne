import "dotenv/config";

// Integratsioonitestid kasutavad eraldi andmebaasi (TEST_DATABASE_URL).
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
