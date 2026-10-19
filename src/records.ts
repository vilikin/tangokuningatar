// Personal bests (🔥 instead of 👍) and group records (a reply) for newly posted scores.
import type { PreviousBest } from "./db";
import { formatDuration } from "./format";
import { GAMES, type GameId, type Score } from "./parser";

export interface NewRecord {
  score: Score;
  previous: PreviousBest;
}

export interface Highlights {
  /** Games where the sender beat their own best. Their first ever result for a game doesn't count. */
  personalBests: GameId[];
  /** Games where the sender beat the group record. The first result anyone posts doesn't count. */
  records: NewRecord[];
}

/** Compares the message's fastest counted score per game with the bests from before it. Ties don't count. */
export function findHighlights(counted: Score[], previous: PreviousBest[]): Highlights {
  const fastest = new Map<GameId, Score>();
  for (const score of counted) {
    const current = fastest.get(score.game);
    if (!current || score.timeSeconds < current.timeSeconds) {
      fastest.set(score.game, score);
    }
  }
  const bests = new Map(previous.map((best) => [best.game, best]));
  const personalBests: GameId[] = [];
  const records: NewRecord[] = [];
  // In the order the games appear in the message.
  for (const [game, score] of fastest) {
    const best = bests.get(game);
    if (!best) {
      continue;
    }
    if (best.personalSeconds !== null && score.timeSeconds < best.personalSeconds) {
      personalBests.push(best.game);
    }
    if (score.timeSeconds < best.recordSeconds) {
      records.push({ score, previous: best });
    }
  }
  return { personalBests, records };
}

/** 🏆 New group record! Aino did Zip #573 in 0:12, beating Liisa's old record of 0:15. */
export function formatRecords(records: NewRecord[], senderId: number, senderName: string): string {
  const lines = records.map(({ score, previous }) => {
    const holder = previous.recordUserId === senderId ? "their own" : `${previous.recordFirstName}'s`;
    return (
      `${senderName} did ${GAMES[score.game]} #${score.puzzleNumber} in ${formatDuration(score.timeSeconds)}, ` +
      `beating ${holder} old record of ${formatDuration(previous.recordSeconds)}.`
    );
  });
  const title = records.length === 1 ? "🏆 New group record!" : "🏆 New group records!";
  return [title, ...lines].join("\n");
}
