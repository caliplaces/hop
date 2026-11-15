CREATE TABLE `live_activities` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`hop_id` text NOT NULL,
	`since` integer NOT NULL,
	`alerted_at` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hop_id`) REFERENCES `hops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `live_activities_hop_idx` ON `live_activities` (`hop_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `live_activities_user_idx` ON `live_activities` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `live_activities_expires_idx` ON `live_activities` (`expires_at`);