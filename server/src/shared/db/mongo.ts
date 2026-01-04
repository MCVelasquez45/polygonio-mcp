import { MongoClient, Db, Collection, Document } from 'mongodb';

// Thin wrapper around MongoDB client lifecycle reused by every feature module.
// Keeps a single connection per process so modules can call `getCollection`
// without worrying about connection pools or driver configuration.

let client: MongoClient | null = null;
let database: Db | null = null;

/**
 * Initializes the shared MongoDB connection. Call this once during server
 * startup (see `server/src/index.ts`). Subsequent calls will no-op so feature
 * modules can safely invoke it during tests.
 */
export async function initMongo(uri: string, dbName = 'market-copilot'): Promise<void> {
  if (database) {
    return;
  }
  if (!uri) {
    throw new Error('MONGO_URI is not set. Please provide a MongoDB connection string.');
  }

  client = new MongoClient(uri);
  await client.connect();
  database = client.db(dbName);
  console.log(`[SERVER] Connected to MongoDB database: ${database.databaseName}`);
}

/**
 * Returns a typed collection handle. Throws if `initMongo` hasn't been called
 * yet so misconfigured environments fail fast.
 */
export function getCollection<TSchema extends Document = Document>(name: string): Collection<TSchema> {
  if (!database) {
    throw new Error('MongoDB has not been initialised. Call initMongo() first.');
  }
  return database.collection<TSchema>(name);
}

/**
 * Closes the shared connection. Primarily used by tests or graceful shutdowns.
 */
export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    database = null;
  }
}
