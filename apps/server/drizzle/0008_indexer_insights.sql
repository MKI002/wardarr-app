CREATE TABLE `indexer_agent_buckets` (
	`instance_id` text NOT NULL,
	`agent` text NOT NULL,
	`bucket_start` text NOT NULL,
	`bucket_minutes` integer NOT NULL,
	`queries` integer DEFAULT 0 NOT NULL,
	`grabs` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`instance_id`, `agent`, `bucket_start`),
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `indexer_grabs` (
	`instance_id` text NOT NULL,
	`download_id` text NOT NULL,
	`indexer` text NOT NULL,
	`grabbed_at` text NOT NULL,
	`imported_at` text,
	`failed_at` text,
	`size_bytes` integer,
	PRIMARY KEY(`instance_id`, `download_id`),
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `indexer_grabs_grabbed` ON `indexer_grabs` (`grabbed_at`);--> statement-breakpoint
CREATE TABLE `indexer_source_daily` (
	`instance_id` text NOT NULL,
	`day` text NOT NULL,
	`mode` text NOT NULL,
	`total` integer NOT NULL,
	`synced` integer NOT NULL,
	`direct` integer NOT NULL,
	`duplicate` integer NOT NULL,
	`missing` integer NOT NULL,
	`orphan` integer NOT NULL,
	PRIMARY KEY(`instance_id`, `day`),
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `indexer_stat_buckets` (
	`instance_id` text NOT NULL,
	`indexer_id` integer NOT NULL,
	`indexer_name` text NOT NULL,
	`bucket_start` text NOT NULL,
	`bucket_minutes` integer NOT NULL,
	`queries` integer DEFAULT 0 NOT NULL,
	`grabs` integer DEFAULT 0 NOT NULL,
	`failed_queries` integer DEFAULT 0 NOT NULL,
	`failed_grabs` integer DEFAULT 0 NOT NULL,
	`rss_queries` integer DEFAULT 0 NOT NULL,
	`auth_queries` integer DEFAULT 0 NOT NULL,
	`avg_response_ms` real,
	`avg_grab_response_ms` real,
	PRIMARY KEY(`instance_id`, `indexer_id`, `bucket_start`),
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `indexer_stat_buckets_start` ON `indexer_stat_buckets` (`bucket_start`);--> statement-breakpoint
CREATE TABLE `indexer_status_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` text NOT NULL,
	`indexer_id` integer NOT NULL,
	`indexer_name` text NOT NULL,
	`at` text NOT NULL,
	`failing` integer NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `indexer_status_log_lookup` ON `indexer_status_log` (`instance_id`,`indexer_id`,`at`);