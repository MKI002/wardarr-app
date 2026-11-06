CREATE TABLE `auth_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`password_hash` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_identities_provider_subject` ON `auth_identities` (`provider`,`subject`);--> statement-breakpoint
CREATE TABLE `instances` (
	`id` text PRIMARY KEY NOT NULL,
	`adapter` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`public_fields` text DEFAULT '{}' NOT NULL,
	`secret_fields` text,
	`enabled` integer DEFAULT true NOT NULL,
	`allow_insecure_tls` integer DEFAULT false NOT NULL,
	`options` text DEFAULT '{}' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instances_name_unique` ON `instances` (`name`);--> statement-breakpoint
CREATE TABLE `issue_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fingerprint` text NOT NULL,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`at` text NOT NULL,
	`actor_user_id` text
);
--> statement-breakpoint
CREATE INDEX `issue_events_fingerprint` ON `issue_events` (`fingerprint`,`at`);--> statement-breakpoint
CREATE TABLE `issues` (
	`fingerprint` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`origin` text NOT NULL,
	`severity` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`resolved_at` text,
	`muted_until` text,
	`muted_forever` integer DEFAULT false NOT NULL,
	`group_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `issues_status` ON `issues` (`status`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`csrf_token` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text,
	`role` text NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`preferences` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);