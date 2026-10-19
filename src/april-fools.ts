// On April 1st in Finland, every leaderboard is sorted backwards and the turtle
// is crowned Tangokuningatar. Nothing in the replies says why.
import type { PlayerTotal, TurtleScore } from "./db";

const dateFormat = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Helsinki", month: "numeric", day: "numeric" });

export function isAprilFools(nowSeconds: number): boolean {
  return dateFormat.format(new Date(nowSeconds * 1000)) === "4/1";
}

/** The totals as they're shown: best first, or worst first on April 1st. */
export function shownOrder(totals: PlayerTotal[], nowSeconds: number): PlayerTotal[] {
  return isAprilFools(nowSeconds) ? [...totals].reverse() : totals;
}

/**
 * Who wears the crown: whoever leads (sharing it on an exact tie), or on April
 * 1st the turtle. With no turtle yet, April 1st crowns whoever is last instead.
 */
export function crowned(totals: PlayerTotal[], turtle: TurtleScore | null, nowSeconds: number): PlayerTotal[] {
  if (isAprilFools(nowSeconds) && turtle) {
    const shelled = totals.filter((total) => total.telegramUserId === turtle.telegramUserId);
    if (shelled.length > 0) {
      return shelled;
    }
  }
  const [first] = shownOrder(totals, nowSeconds);
  return first ? totals.filter((total) => total.games === first.games && total.totalSeconds === first.totalSeconds) : [];
}
