# Reports feature

M5A provides native SQLite query and service layers only; Reports UI is deferred.

All ranges are local-calendar, start-inclusive and end-exclusive. Weeks run Monday through Sunday. `last_3_months` and `last_6_months` include the current calendar month plus the preceding two or five full calendar months; `last_1_month` is the current calendar month. Trend results omit future buckets and fill prior missing buckets with zero values.
