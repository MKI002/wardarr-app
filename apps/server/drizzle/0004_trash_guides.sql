CREATE TABLE `trash_assignments` (
	`instance_id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`guard_mode` text DEFAULT 'notify' NOT NULL,
	`managed` text DEFAULT '{}' NOT NULL,
	`applied` text,
	`state` text DEFAULT '{}' NOT NULL,
	`last_sync_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `trash_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trash_files` (
	`path` text PRIMARY KEY NOT NULL,
	`sha` text NOT NULL,
	`content` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trash_history` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`template_name` text,
	`at` text NOT NULL,
	`actor` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`backup` text,
	`error` text,
	`rolled_back_at` text,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trash_history_instance_at` ON `trash_history` (`instance_id`,`at`);--> statement-breakpoint
CREATE TABLE `trash_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trash_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`product` text NOT NULL,
	`config` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trash_templates_name_unique` ON `trash_templates` (`name`);