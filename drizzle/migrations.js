// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import m0000 from './20260904095006_third_titania/migration.sql';
import m0001 from './20260904151616_damp_raider/migration.sql';
import m0002 from './20260907120000_sync_foundation/migration.sql';
import m0003 from './20260907180000_push_sync/migration.sql';

export default {
  migrations: {
    '20260904095006_third_titania': m0000,
    '20260904151616_damp_raider': m0001,
    '20260907120000_sync_foundation': m0002,
    '20260907180000_push_sync': m0003,
  },
};
