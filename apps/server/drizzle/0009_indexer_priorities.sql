CREATE TABLE `indexer_priority_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`target` text NOT NULL,
	`instance_id` text NOT NULL,
	`indexer_id` integer NOT NULL,
	`indexer_name` text NOT NULL,
	`from_priority` integer,
	`to_priority` integer NOT NULL,
	`score` real,
	`preview` integer DEFAULT false NOT NULL,
	`error` text,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `indexer_priority_log_at` ON `indexer_priority_log` (`at`);--> statement-breakpoint
CREATE TABLE `indexer_priority_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`state` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
