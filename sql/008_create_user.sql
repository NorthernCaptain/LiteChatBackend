-- Create the chat_api MySQL user for LiteChat backend.
-- Full access to litechat database, read-only access to authdb.

CREATE USER IF NOT EXISTS 'chat_api'@'%' IDENTIFIED BY 'CHANGE_ME';

GRANT ALL PRIVILEGES ON litechat.* TO 'chat_api'@'%';
GRANT SELECT ON authdb.users TO 'chat_api'@'%';

FLUSH PRIVILEGES;
