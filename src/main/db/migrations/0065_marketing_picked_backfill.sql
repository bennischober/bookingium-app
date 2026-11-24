-- Atlas entries the team works with stay on the working list: priority A, a status of their own,
-- or a booked measure. Everything else goes to the pool (contacts stay linked).
UPDATE `marketing_item` SET `picked` = 1
WHERE `priority` = 'A'
  OR `status` <> 'open'
  OR `id` IN (SELECT `marketing_item_id` FROM `marketing_action` WHERE `marketing_item_id` IS NOT NULL);
