// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import m0000 from './20260904095006_third_titania/migration.sql';
import m0001 from './20260904151616_damp_raider/migration.sql';
import m0002 from './20260907120000_sync_foundation/migration.sql';
import m0003 from './20260907180000_push_sync/migration.sql';
import m0004 from './20260907210000_pull_sync/migration.sql';
import m0005 from './20260908090000_cloud_link/migration.sql';
import m0006 from './20260909120000_budgets/migration.sql';

export default {
  migrations: {
    '20260904095006_third_titania': m0000,
    '20260904151616_damp_raider': m0001,
    '20260907120000_sync_foundation': m0002,
    '20260907180000_push_sync': m0003,
    '20260907210000_pull_sync': m0004,
    '20260908090000_cloud_link': m0005,
    '20260909120000_budgets': m0006,
  },
};
