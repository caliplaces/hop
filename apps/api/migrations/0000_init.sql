CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`hop_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`thumb_key` text,
	`original_name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`part_size` integer NOT NULL,
	`part_count` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`multipart_upload_id` text,
	`pass_id` text NOT NULL,
	`upload_token_hash` text NOT NULL,
	`contributor_name` text,
	`contributor_user_id` text,
	`note` text,
	`uploader_ip_hash` text,
	`created_at` integer NOT NULL,
	`last_activity_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`hop_id`) REFERENCES `hops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contributor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `files_owner_status_activity_idx` ON `files` (`owner_id`,`status`,`last_activity_at`);--> statement-breakpoint
CREATE INDEX `files_owner_status_created_idx` ON `files` (`owner_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `files_hop_status_created_idx` ON `files` (`hop_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `files_status_activity_idx` ON `files` (`status`,`last_activity_at`);--> statement-breakpoint
CREATE INDEX `files_pass_status_idx` ON `files` (`pass_id`,`status`);--> statement-breakpoint
CREATE TABLE `hops` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hops_owner_slug_idx` ON `hops` (`owner_id`,`slug`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`oidc_sub` text NOT NULL,
	`email` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`name` text,
	`handle` text,
	`active_hop_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_oidc_sub_unique` ON `users` (`oidc_sub`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_handle_unique` ON `users` (`handle`);