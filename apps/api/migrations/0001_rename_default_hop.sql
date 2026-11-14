-- The standing default Hop is now called "Main" (it used to be "Inbox", which
-- clashed with the Inbox page). Only rename ones the athlete never renamed.
UPDATE `hops` SET `title` = 'Main' WHERE `slug` = 'inbox' AND `title` = 'Inbox';
