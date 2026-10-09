import type { Score } from "./parser";
import type { Message, User } from "./telegram";

export interface SaveResult {
  saved: number;
  duplicates: number;
}

/**
 * Stores the sender's scores and refreshes their names, in one transaction.
 * A score for a puzzle the sender already has is skipped: the first post counts,
 * and a redelivered update changes nothing.
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

  const [, ...results] = await db.batch([upsertPlayer, ...scoreInserts]);
  const saved = results.filter((result) => result.meta.changes > 0).length;
  return { saved, duplicates: scores.length - saved };
}
