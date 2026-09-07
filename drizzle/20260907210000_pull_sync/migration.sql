ALTER TABLE `sync_outbox` ADD `base_server_revision` integer;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `last_successful_pull_at` integer;--> statement-breakpoint
CREATE TABLE `sync_baselines` (
	`entity_type` text NOT NULL,
	`entity_sync_id` text NOT NULL,
	`server_revision` integer NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`applied_at` integer NOT NULL,
	PRIMARY KEY(`entity_type`, `entity_sync_id`)
);
--> statement-breakpoint
CREATE TABLE `sync_conflicts` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`entity_type` text NOT NULL,
	`entity_sync_id` text NOT NULL,
	`local_operation` text,
	`base_server_revision` integer,
	`remote_server_revision` integer NOT NULL,
	`resolution` text NOT NULL,
	`detail` text,
	`detected_at` integer NOT NULL,
	CONSTRAINT "valid_conflict_resolution" CHECK(`resolution` IN ('remote_wins', 'local_wins', 'remote_delete_wins', 'local_delete_wins', 'converged_delete', 'attention_required'))
);
--> statement-breakpoint
CREATE INDEX `idx_sync_conflicts_entity` ON `sync_conflicts` (`entity_type`,`entity_sync_id`);
