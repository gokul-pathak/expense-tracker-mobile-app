# M7B Supabase Foundation

## Local setup

Set the public client values in an uncommitted `.env` file:

```text
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

`EXPO_PUBLIC_` values are bundled client configuration, not secrets. Never put a service-role key, database password, or private Postgres credential in this app. Missing values leave the application in Local Only mode; SQLite financial features continue to work.

The version-controlled cloud schema is `supabase/migrations/20260907000000_cloud_sync.sql`. Apply it only to a development/local Supabase project using the Supabase CLI migration workflow, for example `supabase start`, `supabase db reset`, and `supabase test db`. The local RLS suite is `supabase/tests/rls.sql`; it needs the Supabase Docker environment and is not run by normal unit tests.

## Auth and session handling

M7B supports Email + Password only. The app centralizes vendor access in `src/lib/supabase/` and `src/features/cloud-auth/`; screens call `cloudAuthService`, never `supabase.auth` directly. Native session data is stored in chunked Expo SecureStore values to stay inside platform item limits without using financial SQLite. Web uses a separate browser-storage adapter because SecureStore is not available there.

App Lock is independent from Cloud Account authentication. The Cloud Account provider is rendered inside App Lock, so an enabled lock still protects Cloud Account actions. The provider restores any persisted session and uses Supabase auth-state events plus app lifecycle auto-refresh. Auth restoration never blocks SQLite startup or local financial screens.

Sign-up handles projects that require email confirmation by asking the user to confirm and then sign in. Password reset, OAuth, magic link, realtime, storage buckets, Edge Functions, financial sync, local sync UUID/outbox migrations, and cloud-account/data linking are intentionally deferred.

## M7B data boundary

Sign-in does not upload, download, read, write, or link financial records. Accounts, categories, people, transactions, settings, reports, and balances remain SQLite-only. Sessions/tokens are not stored in financial SQLite and are not represented by backup/export schemas. Do not log passwords, sessions, tokens, JWTs, or authorization headers.
