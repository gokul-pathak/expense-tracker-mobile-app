# Working in this repo

A local-first personal wealth tracker. Expo / React Native, SQLite through Drizzle as the source of
truth, optional Supabase sync. Default currency NPR, with USD and INR; lending to friends and family
is a first-class feature rather than a footnote.

## Anything visual

Load the `private-vault-design` skill first. Every colour, size, spacing and radius is defined in
`src/theme/`, and choosing one from memory is how the system rots. `src/constants/theme.ts` is
deleted — a raw hex or font size inline in a component is a regression.

## Commands

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # expo lint
npm test              # vitest, ~4 minutes
npx expo start        # dev server, needed before any device can load new code
```

## Verifying a change

**A browser is not evidence about a device.** The hero balance once shipped sliced through the middle
on Android while typecheck, lint, all 548 tests and a browser were green. Text in a custom font is
where web and native diverge most, and web is the forgiving one.

**Expo Go replays its last cached bundle when it cannot reach Metro.** With no dev server running, a
device shows old code and every screenshot looks like the fix failed. Before believing a bug
survived, check whether the app is showing its own "Cannot connect to Expo CLI" notice, and check
that something is actually listening on port 8081. `CI=1` also disables Metro's watch mode, so edits
appear to do nothing.

## Constraints worth knowing

- **Web boots but shows no figures, permanently.** `expo-sqlite` blocks on `Atomics.wait`, which
  browsers forbid on the main thread, and this app reads SQLite synchronously everywhere.
  `src/db/index.web.ts` keeps the database shut on purpose. Web is still useful for first-run
  screens, the shell, and rendering a component in isolation.
- **The test suite is I/O bound and runs files in parallel.** A test costing 400ms alone costs four
  to nine seconds in a full run, which is why `testTimeout` and `hookTimeout` are raised in
  `vitest.config.mjs`. Timeouts there are budgets for slow hardware, not for slow code.
- **Money is integer minor units everywhere.** Never a float, never a formatted string in the domain.

## Commits

Do not add a `Co-Authored-By` trailer.
