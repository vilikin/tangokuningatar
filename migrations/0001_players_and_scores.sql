-- People are keyed by their Telegram user ID: usernames are optional and can change.
-- Names are refreshed from each new message.
CREATE TABLE players (
  telegram_user_id INTEGER PRIMARY KEY,
  username         TEXT,
  first_name       TEXT NOT NULL,
  last_name        TEXT,
  first_seen_at    INTEGER NOT NULL, -- unix seconds
  updated_at       INTEGER NOT NULL  -- date of the message the names came from
);

-- One result per person per puzzle; the first one posted counts.
-- game + puzzle_number identify a day's puzzle, regardless of when it was posted.
CREATE TABLE scores (
  id               INTEGER PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL REFERENCES players (telegram_user_id),
  game             TEXT NOT NULL,    -- 'queens', 'tango', 'zip', 'mini-sudoku', 'patches', 'wend'
  puzzle_number    INTEGER NOT NULL,
  time_seconds     INTEGER NOT NULL,
  no_hints         INTEGER NOT NULL, -- 0/1: the share text said "no hints"
  no_redraws       INTEGER NOT NULL, -- 0/1: the share text said "no redraws"
  posted_at        INTEGER NOT NULL, -- Telegram message date, unix seconds
  chat_id          INTEGER NOT NULL,
  message_id       INTEGER NOT NULL,
  message_text     TEXT NOT NULL,    -- kept so old scores can be re-parsed for new stats
  UNIQUE (telegram_user_id, game, puzzle_number)
);

CREATE INDEX scores_by_puzzle ON scores (game, puzzle_number);
