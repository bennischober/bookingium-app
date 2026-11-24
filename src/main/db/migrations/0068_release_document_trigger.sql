-- #289: documents filed at a release go with it, like those of the other owners (0044)
CREATE TRIGGER `document_owner_release_deleted` AFTER DELETE ON `release` BEGIN
	DELETE FROM `document` WHERE `owner_type` = 'release' AND `owner_id` = OLD.`id`;
END;
