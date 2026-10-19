-- One row per score message the bot caught being edited, so it only calls it out once.
CREATE TABLE snitched_edits (
  chat_id     INTEGER NOT NULL,
  message_id  INTEGER NOT NULL,
  snitched_at INTEGER NOT NULL, -- unix seconds: when the first edit was made
  PRIMARY KEY (chat_id, message_id)
);
