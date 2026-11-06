CREATE TABLE `transcode_daily` (
	`instance_id` text NOT NULL,
	`day` text NOT NULL,
	`transcodes` integer NOT NULL,
	`health_checks` integer NOT NULL,
	`saved_bytes` integer NOT NULL,
	`failed_transcodes` integer NOT NULL,
	`failed_health_checks` integer NOT NULL,
	`queued` integer NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transcode_daily_instance_day` ON `transcode_daily` (`instance_id`,`day`);--> statement-breakpoint
CREATE TABLE `transcode_nodes` (
	`instance_id` text NOT NULL,
	`node_id` text NOT NULL,
	`name` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transcode_nodes_instance_node` ON `transcode_nodes` (`instance_id`,`node_id`);