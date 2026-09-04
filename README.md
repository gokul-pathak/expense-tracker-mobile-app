# Personal Expense Tracker — Milestone 0 Foundation

This scaffold implements **M0 only** for the personal expense tracker project.

## Included

- Expo + React Native + TypeScript
- Expo Router
- Bottom navigation: Home / Transactions / Add / Reports / More
- Center `+` primary action
- Placeholder screens only
- `src/` architecture aligned to later features
- Theme/design tokens
- Reusable base UI: `Screen`, `AppText`, `Card`, `AppButton`, `PlaceholderScreen`
- ESLint flat config + Prettier
- Strict TypeScript configuration

## Intentionally excluded

- SQLite / Drizzle
- Accounts and categories logic
- Transactions and calculations
- Zustand / forms / Zod / TanStack Query
- Reports logic
- Cloud sync / Supabase
- AI, OCR, budgets, recurring transactions, investments

Those belong to later milestones and should not be introduced early.

## Requirements

- Node.js 22.13+ (Expo SDK 57 minimum)
- npm
- Android Studio for Android emulator and/or Xcode on macOS for iOS simulator

## Run

```bash
npm install
npm run typecheck
npm run lint
npm run start
```

Then use Expo CLI to open Android or iOS.

```bash
npm run android
npm run ios
```

> iOS Simulator requires macOS + Xcode.

## M0 acceptance checklist

- [ ] Dependencies install successfully
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] App launches without runtime errors
- [ ] Home / Transactions / Add / Reports / More navigation works
- [ ] Center `+` opens Quick Add placeholder
- [ ] Android launch verified
- [ ] iOS launch verified on macOS/Xcode
- [ ] No finance/database logic added

Once every item above is verified, proceed to **M1 Database Foundation**.
