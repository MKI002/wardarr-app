CREATE TABLE `disk_samples` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`disk_key` text NOT NULL,
	`at` text NOT NULL,
	`free_bytes` integer NOT NULL,
	`total_bytes` integer NOT NULL,
	FOREIGN KEY (`disk_key`) REFERENCES `disks`(`key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `disk_samples_disk_at` ON `disk_samples` (`disk_key`,`at`);--> statement-breakpoint
CREATE TABLE `disks` (
	`key` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`total_bytes` integer NOT NULL,
	`free_bytes` integer NOT NULL,
	`media` integer DEFAULT false NOT NULL,
	`members` text DEFAULT '[]' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `storage_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
