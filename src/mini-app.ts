// The Mini App: a page Telegram opens in its in-app browser, and the API it calls.
// Reference: https://core.telegram.org/bots/webapps
//
// The page itself is public and holds no data. It sends the initData Telegram gives
// it to the API, which only answers once the signature checks out.

import { verifyInitData } from "./auth";
import { rankTotals } from "./commands";
import { isPlayer, playerTotals } from "./db";
import { formatDuration } from "./format";
import PAGE_HTML from "./mini-app.html";
import { GAMES, type GameId } from "./parser";
import { puzzleDayStart, puzzleWeek } from "./puzzle-day";

export const PAGE_PATH = "/app";
export const WEEK_PATH = "/api/week";

const DAY_SECONDS = 86_400;

// Keeps the page out of search engines, and its URL out of other sites' logs.
const PAGE_HEADERS = {
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

export function servePage(): Response {
  return new Response(PAGE_HTML, {
    headers: { ...PAGE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
  });
}

/**
 * This week's standings, all games together and each game alone: the same as
 * /week and /week_<game>. Expects `Authorization: tma <initData>`. 401 when
 * Telegram didn't vouch for the request, 403 for people who've never posted a
 * score in our group.
 */
export async function serveWeek(request: Request, env: Env): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.error({ event: "config_error", message: "TELEGRAM_BOT_TOKEN is not set; rejecting all Mini App requests" });
  }
  const initData = request.headers.get("Authorization")?.match(/^tma (.+)$/)?.[1] ?? "";
  const user = await verifyInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (!user) {
    return json({ error: "Open this page from Telegram." }, 401);
  }
  const player = await isPlayer(env.DB, user.id);
  console.log({ event: "mini_app_week", from_id: user.id, player });
  if (!player) {
    return json({ error: "Only for people who have posted a score in our group." }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  const week = puzzleWeek(now);
  const boards: { id: GameId | "all"; name: string }[] = [
    { id: "all", name: "All games" },
    ...(Object.entries(GAMES) as [GameId, string][]).map(([id, name]) => ({ id, name })),
  ];
  const totals = await Promise.all(boards.map(({ id }) => playerTotals(env.DB, week.start, id === "all" ? null : id)));

  return json({
    week: {
      saturday: formatDate(week.saturday),
      friday: formatDate(week.friday),
      // 1 on Saturday, 7 on Friday. Rounded: a day is 23 or 25 hours when DST changes.
      day: Math.round((puzzleDayStart(now) - week.start) / DAY_SECONDS) + 1,
    },
    boards: boards.map((board, i) => ({
      ...board,
      standings: rankTotals(totals[i]!).map(({ rank, name, total }) => ({
        rank,
        name,
        games: total.games,
        time: formatDuration(total.totalSeconds),
        you: total.telegramUserId === user.id,
      })),
    })),
  });
}

/** 17.10. */
function formatDate(date: Date): string {
  return `${date.getUTCDate()}.${date.getUTCMonth() + 1}.`;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { ...PAGE_HEADERS, "Cache-Control": "no-store" } });
}
