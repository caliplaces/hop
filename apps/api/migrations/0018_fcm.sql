ALTER TABLE `devices` ADD `platform` text DEFAULT 'apns' NOT NULL;--> statement-breakpoint
ALTER TABLE `live_activities` ADD `platform` text DEFAULT 'apns' NOT NULL;