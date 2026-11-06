CREATE TABLE `request_links` (
	`user_id` text NOT NULL,
	`instance_id` text NOT NULL,
	`external_id` integer NOT NULL,
	`external_name` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `request_links_user_instance` ON `request_links` (`user_id`,`instance_id`);--> statement-breakpoint
CREATE TABLE `stream_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` text NOT NULL,
	`session_id` text NOT NULL,
	`user` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`media_type` text NOT NULL,
	`started_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`ended_at` text,
	`played_ms` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`progress` integer DEFAULT 0 NOT NULL,
	`transcoding` integer DEFAULT false NOT NULL,
	`resolution` text,
	`client` text
);
--> statement-breakpoint
CREATE INDEX `stream_history_started` ON `stream_history` (`started_at`);--> statement-breakpoint
CREATE INDEX `stream_history_open` ON `stream_history` (`instance_id`,`ended_at`);