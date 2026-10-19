// The weekly crowning: on Fridays at 16:00 Finnish time the bot posts who leads
// the week (the Tangokuningatar) and the turtle of the week. /kuningatar and
// /turtle show the same during the week.
import type { BotApi } from "./bot-api";
import { type PlayerTotal, playerTotals, slowestRelativeScore, type TurtleScore } from "./db";
import { displayNames, formatDuration, formatWeek, joinNames } from "./format";
import { GAMES } from "./parser";
import { puzzleWeek, type PuzzleWeek } from "./puzzle-day";

// Cloudflare cron triggers run on UTC, so wrangler.jsonc schedules both 13:00 and
// 14:00 UTC on Fridays and only the run that is 16:00 in Finland posts.
const POST_TIME_ZONE = "Europe/Helsinki";
const POST_HOUR = 16;

const hourFormat = new Intl.DateTimeFormat("en-US", { timeZone: POST_TIME_ZONE, hourCycle: "h23", hour: "numeric" });

const TURTLE_RULE = "The turtle is the slowest result compared with the fastest time on the same puzzle.";

/** Runs from the cron trigger. */
export async function postWeeklyCrowning(scheduledTime: number, env: Env, bot: BotApi): Promise<void> {
  const hour = Number(hourFormat.format(new Date(scheduledTime)));
  if (hour !== POST_HOUR) {
    console.log({ event: "weekly_crowning_skipped", reason: `it's ${hour}:00 in Finland, not ${POST_HOUR}:00` });
    return;
  }
  const chatId = env.ALLOWED_CHAT_ID?.trim();
  if (!chatId) {
    console.error({ event: "config_error", message: "ALLOWED_CHAT_ID is not set; not posting the weekly crowning" });
    return;
  }
  const text = await weeklyCrowning(env.DB, Math.floor(scheduledTime / 1000));
  if (text === null) {
    console.log({ event: "weekly_crowning_skipped", reason: "no scores this week" });
    return;
  }
  await bot.sendMessage(Number(chatId), text);
  console.log({ event: "weekly_crowning_posted", chat_id: chatId });
}

/** The Friday post, or null when nobody has played this week. */
export async function weeklyCrowning(db: D1Database, nowSeconds: number): Promise<string | null> {
  const week = puzzleWeek(nowSeconds);
  const [totals, turtle] = await Promise.all([playerTotals(db, week.start), slowestRelativeScore(db, week.start)]);
  if (totals.length === 0) {
    return null;
  }
  const names = displayNames(totals);
  return [crownSection(totals, names, true), turtleSection(turtle, names, true), `${formatWeek(week)}\nFull standings: /week`].join(
    "\n\n",
  );
}

/** The reply to /kuningatar. */
export function formatWeekLeader(week: PuzzleWeek, totals: PlayerTotal[]): string {
  return [crownSection(totals, displayNames(totals), false), `${formatWeek(week)}\nCrowned on Friday at 16:00.`].join("\n\n");
}

/** The reply to /turtle. */
export function formatTurtle(week: PuzzleWeek, totals: PlayerTotal[], turtle: TurtleScore | null): string {
  return [
    turtleSection(turtle, displayNames(totals), false),
    `${formatWeek(week)}\n${TURTLE_RULE} Announced on Friday at 16:00.`,
  ].join("\n\n");
}

/** Whoever leads /week, sharing the crown on an exact tie. */
function crownSection(totals: PlayerTotal[], names: Map<number, string>, final: boolean): string {
  const [leader] = totals;
  if (!leader) {
    return "👑 Nobody has played this week yet. The crown is up for grabs!";
  }
  const queens = totals.filter((total) => total.games === leader.games && total.totalSeconds === leader.totalSeconds);
  const who = joinNames(queens.map((queen) => names.get(queen.telegramUserId)!));
  const games = leader.games === 1 ? "1 game" : `${leader.games} games`;
  const result = `${formatDuration(leader.totalSeconds)} over ${games}${queens.length > 1 ? " each" : ""}.`;
  return final ? `👑 Tangokuningatar of the week: ${who}!\n${result}` : `👑 Tangokuningatar so far this week: ${who}\n${result}`;
}

function turtleSection(turtle: TurtleScore | null, names: Map<number, string>, final: boolean): string {
  if (!turtle) {
    return final
      ? "🐢 No turtle this week: nobody was slower than anyone else on the same puzzle!"
      : "🐢 No turtle this week yet.";
  }
  const name = (id: number) => names.get(id) ?? "Someone";
  const ratio = (turtle.timeSeconds / Math.max(turtle.bestSeconds, 1)).toFixed(1);
  const result =
    `${GAMES[turtle.game]} #${turtle.puzzleNumber} in ${formatDuration(turtle.timeSeconds)}, ` +
    `${ratio}× the fastest ${formatDuration(turtle.bestSeconds)} (${name(turtle.bestUserId)}).`;
  return `${final ? "🐢 Turtle of the week" : "🐢 Turtle so far this week"}: ${name(turtle.telegramUserId)}\n${result}`;
}
