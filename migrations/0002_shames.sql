-- One row per person shamed for a puzzle day they didn't post every game for.
-- Written before the shame is sent, so a repeated cron run never shames twice.
CREATE TABLE shames (
  telegram_user_id INTEGER NOT NULL REFERENCES players (telegram_user_id),
  puzzle_day       TEXT NOT NULL,    -- 'YYYY-MM-DD': the Pacific-time day the missed puzzles belonged to
  missed_games     TEXT NOT NULL,    -- comma-separated game IDs, e.g. 'tango,zip'
  shamed_at        INTEGER NOT NULL, -- unix seconds
  PRIMARY KEY (telegram_user_id, puzzle_day)
);
