import { MongoClient, Db, Collection, Document } from 'mongodb';

// Thin wrapper around MongoDB client lifecycle reused by every feature module.

let client: MongoClient | null = null;
let database: Db | null = null;

export async function initMongo(uri: string, dbName = 'market-copilot'): Promise<void> {
  if (database) {
    return;
  }
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Please provide a connection string.');
  }

  client = new MongoClient(uri);
  await client.connect();
  database = client.db(dbName);
  console.log(`[SERVER] Connected to MongoDB database: ${database.databaseName}`);
}

export function getCollection<TSchema extends Document = Document>(name: string): Collection<TSchema> {
  if (!database) {
    throw new Error('MongoDB has not been initialised. Call initMongo() first.');
  }
  return database.collection<TSchema>(name);
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    database = null;
  }
}
