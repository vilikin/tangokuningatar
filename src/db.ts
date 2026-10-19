import type { GameId, Score } from "./parser";
import type { Message, User } from "./telegram";

export interface SaveResult {
  /** Newly stored. */
  saved: number;
  /** Skipped because an earlier message already has the sender's result for that puzzle. */
  duplicates: number;
  /** The scores on record from this message: the ones that count. */
  counted: Score[];
}

/**
 * Stores the sender's scores and refreshes their names, in one transaction.
 * A score for a puzzle the sender already has is skipped: the first post counts.
 * A redelivered update changes nothing and isn't counted as a duplicate, since
 * the scores on record came from this very message.
 */
export async function saveScores(db: D1Database, message: Message, sender: User, scores: Score[]): Promise<SaveResult> {
  const upsertPlayer = db
    .prepare(
      `INSERT INTO players (telegram_user_id, username, first_name, last_name, first_seen_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT (telegram_user_id) DO UPDATE SET
         username = excluded.username,
         first_name = excluded.first_name,
         last_name = excluded.last_name,
         updated_at = excluded.updated_at
       WHERE excluded.updated_at >= players.updated_at`,
    )
    .bind(sender.id, sender.username ?? null, sender.first_name, sender.last_name ?? null, message.date);

  const insertScore = db.prepare(
    `INSERT INTO scores (telegram_user_id, game, puzzle_number, time_seconds, no_hints, no_redraws,
                         posted_at, chat_id, message_id, message_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (telegram_user_id, game, puzzle_number) DO NOTHING`,
  );
  const text = message.text ?? message.caption ?? "";
  const scoreInserts = scores.map((score) =>
    insertScore.bind(
      sender.id,
      score.game,
      score.puzzleNumber,
      score.timeSeconds,
      score.noHints ? 1 : 0,
      score.noRedraws ? 1 : 0,
      message.date,
      message.chat.id,
      message.message_id,
      text,
    ),
  );

  const creditedToThisMessage = db
    .prepare(`SELECT game, puzzle_number FROM scores WHERE telegram_user_id = ? AND chat_id = ? AND message_id = ?`)
    .bind(sender.id, message.chat.id, message.message_id);

  const [, ...results] = await db.batch<{ game: string; puzzle_number: number }>([
    upsertPlayer,
    ...scoreInserts,
    creditedToThisMessage,
  ]);
  const credited = new Set(results.pop()!.results.map((row) => `${row.game}#${row.puzzle_number}`));
  const counted = scores.filter((score) => credited.has(`${score.game}#${score.puzzleNumber}`));
  return {
    saved: results.filter((result) => result.meta.changes > 0).length,
    duplicates: scores.length - counted.length,
    counted,
  };
}

export interface PreviousBest {
  game: GameId;
  /** The group record before this message, and who set it first. */
  recordSeconds: number;
  recordUserId: number;
  recordFirstName: string;
  /** The sender's own best before this message, or null if this is their first. */
  personalSeconds: number | null;
}

/**
 * The group record and the sender's own best for each game, from every score
 * except the ones in this message. Leaving the message out means a redelivered
 * update gets the same answer. Games nobody has played yet are left out.
 */
export async function previousBests(
  db: D1Database,
  message: Message,
  sender: User,
  games: GameId[],
): Promise<PreviousBest[]> {
  const { results } = await db
    .prepare(
      `WITH others AS (
         SELECT telegram_user_id, game, time_seconds, posted_at FROM scores
         WHERE game IN (SELECT value FROM json_each(?1)) AND NOT (chat_id = ?2 AND message_id = ?3)
       ),
       records AS (
         SELECT game, telegram_user_id, time_seconds,
                ROW_NUMBER() OVER (PARTITION BY game ORDER BY time_seconds, posted_at) AS place
         FROM others
       )
       SELECT r.game,
              r.time_seconds     AS recordSeconds,
              r.telegram_user_id AS recordUserId,
              p.first_name       AS recordFirstName,
              (SELECT MIN(o.time_seconds) FROM others o WHERE o.game = r.game AND o.telegram_user_id = ?4) AS personalSeconds
       FROM records r
       JOIN players p USING (telegram_user_id)
       WHERE r.place = 1`,
    )
    .bind(JSON.stringify([...new Set(games)]), message.chat.id, message.message_id, sender.id)
    .all<PreviousBest>();
  return results;
}

// A score counts if it was posted after ?1 and its puzzle number is past anything
// posted for that game before then. That leaves out an older puzzle someone posts late.
const COUNTED_SINCE = `s.posted_at >= ?1
         AND s.puzzle_number > COALESCE(
               (SELECT MAX(earlier.puzzle_number) FROM scores earlier
                WHERE earlier.game = s.game AND earlier.posted_at < ?1),
               -1)`;

export interface PlayerTotal {
  telegramUserId: number;
  firstName: string;
  lastName: string | null;
  games: number;
  totalSeconds: number;
}

/**
 * Each player's combined time over the puzzles released since `since` (of one
 * game, or all of them), best first: more games played ranks higher, then lower
 * total time.
 */
export async function playerTotals(db: D1Database, since: number, game: GameId | null = null): Promise<PlayerTotal[]> {
  const { results } = await db
    .prepare(
      `SELECT p.telegram_user_id AS telegramUserId,
              p.first_name       AS firstName,
              p.last_name        AS lastName,
              COUNT(*)           AS games,
              SUM(s.time_seconds) AS totalSeconds
       FROM scores s
       JOIN players p USING (telegram_user_id)
       WHERE ${COUNTED_SINCE}
         AND (?2 IS NULL OR s.game = ?2)
       GROUP BY s.telegram_user_id
       ORDER BY games DESC, totalSeconds ASC, MIN(s.posted_at) ASC`,
    )
    .bind(since, game)
    .all<PlayerTotal>();
  return results;
}

export interface MoodResult {
  telegramUserId: number;
  firstName: string;
  lastName: string | null;
  game: GameId;
  timeSeconds: number;
  /** The player's average on this game before today. */
  usualSeconds: number;
}

/**
 * Today's results (since `dayStart`) from players with at least `minHistory`
 * results on the same game in the `historySeconds` before it, each with their
 * average from then.
 */
export async function moodResults(
  db: D1Database,
  dayStart: number,
  historySeconds: number,
  minHistory: number,
): Promise<MoodResult[]> {
  const { results } = await db
    .prepare(
      `WITH history AS (
         SELECT telegram_user_id, game, AVG(time_seconds) AS usual_seconds, COUNT(*) AS results
         FROM scores
         WHERE posted_at >= ?2 AND posted_at < ?1
         GROUP BY telegram_user_id, game
       )
       SELECT s.telegram_user_id AS telegramUserId,
              p.first_name       AS firstName,
              p.last_name        AS lastName,
              s.game,
              s.time_seconds     AS timeSeconds,
              h.usual_seconds    AS usualSeconds
       FROM scores s
       JOIN history h USING (telegram_user_id, game)
       JOIN players p USING (telegram_user_id)
       WHERE ${COUNTED_SINCE}
         AND h.results >= ?3
       ORDER BY s.posted_at, s.game`,
    )
    .bind(dayStart, dayStart - historySeconds, minHistory)
    .all<MoodResult>();
  return results;
}

export interface TurtleScore {
  telegramUserId: number;
  game: GameId;
  puzzleNumber: number;
  timeSeconds: number;
  /** The fastest time on the same puzzle, and who posted it first. */
  bestSeconds: number;
  bestUserId: number;
}

/**
 * The slowest result compared with the fastest time on the same puzzle, among the
 * puzzles released since `since` that more than one person played. Null if
 * nobody was slower than someone else.
 */
export async function slowestRelativeScore(db: D1Database, since: number): Promise<TurtleScore | null> {
  return db
    .prepare(
      `WITH counted AS (
         SELECT s.telegram_user_id, s.game, s.puzzle_number, s.time_seconds, s.posted_at,
                MIN(s.time_seconds) OVER puzzle AS best_seconds,
                FIRST_VALUE(s.telegram_user_id) OVER (puzzle ORDER BY s.time_seconds, s.posted_at) AS best_user_id
         FROM scores s
         WHERE ${COUNTED_SINCE}
         WINDOW puzzle AS (PARTITION BY s.game, s.puzzle_number)
       )
       SELECT telegram_user_id AS telegramUserId,
              game,
              puzzle_number    AS puzzleNumber,
              time_seconds     AS timeSeconds,
              best_seconds     AS bestSeconds,
              best_user_id     AS bestUserId
       FROM counted
       WHERE time_seconds > best_seconds
       ORDER BY CAST(time_seconds AS REAL) / MAX(best_seconds, 1) DESC, time_seconds DESC, posted_at ASC
       LIMIT 1`,
    )
    .bind(since)
    .first<TurtleScore>();
}

/** Whether this person has ever posted a score in our group. */
export async function isPlayer(db: D1Database, telegramUserId: number): Promise<boolean> {
  const row = await db.prepare("SELECT 1 FROM players WHERE telegram_user_id = ?").bind(telegramUserId).first();
  return row !== null;
}

export interface PuzzleFirstPost {
  game: string;
  puzzle_number: number;
  first_posted_at: number;
}

/** When each puzzle posted since `since` (unix seconds) was first posted. */
export async function listPuzzleFirstPosts(db: D1Database, since: number): Promise<PuzzleFirstPost[]> {
  const { results } = await db
    .prepare(
      `SELECT game, puzzle_number, MIN(posted_at) AS first_posted_at
       FROM scores WHERE posted_at >= ?
       GROUP BY game, puzzle_number`,
    )
    .bind(since)
    .all<PuzzleFirstPost>();
  return results;
}

export interface Player {
  telegram_user_id: number;
  username: string | null;
  first_name: string;
  last_name: string | null;
}

export async function listPlayers(db: D1Database): Promise<Player[]> {
  const { results } = await db
    .prepare("SELECT telegram_user_id, username, first_name, last_name FROM players ORDER BY telegram_user_id")
    .all<Player>();
  return results;
}

/** Who posted which of these puzzles, as { telegram_user_id, game } rows. */
export async function listPosters(
  db: D1Database,
  puzzles: { game: string; puzzleNumber: number }[],
): Promise<{ telegram_user_id: number; game: string }[]> {
  if (puzzles.length === 0) {
    return [];
  }
  const { results } = await db
    .prepare(
      `SELECT telegram_user_id, game FROM scores
       WHERE ${puzzles.map(() => "(game = ? AND puzzle_number = ?)").join(" OR ")}`,
    )
    .bind(...puzzles.flatMap(({ game, puzzleNumber }) => [game, puzzleNumber]))
    .all<{ telegram_user_id: number; game: string }>();
  return results;
}

/** Returns false if the player was already shamed for this puzzle day. */
export async function recordShame(
  db: D1Database,
  userId: number,
  puzzleDay: string,
  missedGames: string[],
  shamedAt: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO shames (telegram_user_id, puzzle_day, missed_games, shamed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (telegram_user_id, puzzle_day) DO NOTHING`,
    )
    .bind(userId, puzzleDay, missedGames.join(","), shamedAt)
    .run();
  return result.meta.changes > 0;
}
