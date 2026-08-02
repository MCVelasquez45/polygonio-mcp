import dotenv from 'dotenv';

// Keep process-level values authoritative (Render/production), then layer the
// checked-out service configuration with an ignored local override/fallback.
// dotenv's first-value-wins behavior means .env keeps ownership of existing
// values while .env.local supplies credentials that are absent from it.
dotenv.config({ path: ['.env', '.env.local'] });
