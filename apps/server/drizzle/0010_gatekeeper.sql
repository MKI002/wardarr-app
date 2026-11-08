CREATE TABLE `gatekeeper_catches` (
	`download_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`at` text NOT NULL,
	`extensions` text DEFAULT '[]' NOT NULL,
	`seen_by` text DEFAULT '[]' NOT NULL,
	`outcome` text NOT NULL,
	`reason` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gatekeeper_catches_at` ON `gatekeeper_catches` (`at`);--> statement-breakpoint
CREATE TABLE `gatekeeper_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`state` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
