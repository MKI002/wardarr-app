CREATE TABLE `cleaner_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` text NOT NULL,
	`at` text NOT NULL,
	`download_key` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`rule` text NOT NULL,
	`reason` text NOT NULL,
	`dry_run` integer NOT NULL,
	`ok` integer NOT NULL,
	`error` text,
	`actor_user_id` text
);
--> statement-breakpoint
CREATE INDEX `cleaner_history_instance_at` ON `cleaner_history` (`instance_id`,`at`);--> statement-breakpoint
CREATE TABLE `feature_settings` (
	`instance_id` text NOT NULL,
	`feature` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`state` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feature_settings_instance_feature` ON `feature_settings` (`instance_id`,`feature`);--> statement-breakpoint
CREATE TABLE `hunt_exclusions` (
	`instance_id` text NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hunt_exclusions_instance_key` ON `hunt_exclusions` (`instance_id`,`key`);--> statement-breakpoint
CREATE TABLE `hunt_searches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` text NOT NULL,
	`key` text NOT NULL,
	`item_keys` text NOT NULL,
	`title` text NOT NULL,
	`list` text NOT NULL,
	`media_ids` text NOT NULL,
	`reason` text NOT NULL,
	`at` text NOT NULL,
	`manual` integer DEFAULT false NOT NULL,
	`result` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `hunt_searches_instance_at` ON `hunt_searches` (`instance_id`,`at`);--> statement-breakpoint
CREATE INDEX `hunt_searches_instance_key` ON `hunt_searches` (`instance_id`,`key`);