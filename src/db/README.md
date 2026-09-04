# Database layer

`index.ts` owns the single Expo SQLite connection and exported Drizzle instance.
Schemas live in `schema/`; generated SQL migrations and their Expo bundle manifest live in the root `drizzle/` directory.

The database is initialized on Android and iOS. Web uses a platform-specific no-op initializer because Expo SQLite web requires cross-origin isolation and is not an MVP target.
