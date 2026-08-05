import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 CLI config: schema/migrations live here, and the datasource URL for
// migrate/studio is read from the environment instead of schema.prisma.
// Prisma 7 no longer honours `datasource.url = env(...)` in the schema, and
// unlike Prisma 6 it does not auto-load .env — hence the dotenv import.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL },
});
