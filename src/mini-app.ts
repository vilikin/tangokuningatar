// The Mini App: a page Telegram opens in its in-app browser, and the API it calls.
// Reference: https://core.telegram.org/bots/webapps
//
// The page itself is public and holds no data. It sends the initData Telegram gives
// it to the API, which only answers once the signature checks out.

import { verifyInitData } from "./auth";
import { findPlayerScores } from "./db";
import { GAMES, type GameId } from "./parser";

export const PAGE_PATH = "/app";
export const MY_SCORES_PATH = "/api/my-scores";

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
 * Answers with the viewer's own scores. Expects `Authorization: tma <initData>`.
 * 401 when Telegram didn't vouch for the request, 403 for people who've never
 * posted a score in our group.
 */
export async function serveMyScores(request: Request, env: Env): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.error({ event: "config_error", message: "TELEGRAM_BOT_TOKEN is not set; rejecting all Mini App requests" });
  }
  const initData = request.headers.get("Authorization")?.match(/^tma (.+)$/)?.[1] ?? "";
  const user = await verifyInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (!user) {
    return json({ error: "Open this page from Telegram." }, 401);
  }

  const scores = await findPlayerScores(env.DB, user.id);
  console.log({ event: "mini_app_scores", from_id: user.id, player: scores !== null, scores: scores?.length ?? 0 });
  if (!scores) {
    return json({ error: "Only for people who have posted a score in our group." }, 403);
  }
  return json({
    first_name: user.first_name,
    scores: scores.map((score) => ({ ...score, game_name: GAMES[score.game as GameId] ?? score.game })),
  });
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { ...PAGE_HEADERS, "Cache-Control": "no-store" } });
}

// Deliberately crude: a demo that Telegram tells us who's viewing.
// Colours come from the viewer's Telegram theme, with fallbacks for a plain browser.
const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>My scores</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  body {
    margin: 0;
    padding: 16px;
    font: 15px/1.4 system-ui, sans-serif;
    background: var(--tg-theme-bg-color, #fff);
    color: var(--tg-theme-text-color, #000);
  }
  .muted { color: var(--tg-theme-hint-color, #888); }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 6px 8px 6px 0; border-bottom: 1px solid var(--tg-theme-section-separator-color, #ddd); }
  td.time { font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<h1 id="title">My scores</h1>
<p id="status" class="muted">Loading…</p>
<table id="scores" hidden>
  <thead><tr><th>Game</th><th>#</th><th>Time</th><th>Posted</th></tr></thead>
  <tbody></tbody>
</table>
<script>
  const app = window.Telegram?.WebApp;
  app?.ready();
  const status = document.getElementById("status");

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = String(seconds % 60).padStart(2, "0");
    return m + ":" + s;
  }

  async function load() {
    if (!app?.initData) {
      status.textContent = "Open this page from Telegram.";
      return;
    }
    const response = await fetch("${MY_SCORES_PATH}", { headers: { Authorization: "tma " + app.initData } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      status.textContent = body.error ?? "Something went wrong (" + response.status + ").";
      return;
    }
    document.getElementById("title").textContent = body.first_name + "’s scores";
    status.textContent = body.scores.length === 1 ? "1 score" : body.scores.length + " scores";
    const rows = document.querySelector("#scores tbody");
    for (const score of body.scores) {
      const row = rows.insertRow();
      row.insertCell().textContent = score.game_name;
      row.insertCell().textContent = score.puzzle_number;
      const time = row.insertCell();
      time.className = "time";
      time.textContent = formatTime(score.time_seconds);
      row.insertCell().textContent = new Date(score.posted_at * 1000).toLocaleDateString();
    }
    document.getElementById("scores").hidden = body.scores.length === 0;
  }

  load().catch((error) => (status.textContent = "Something went wrong: " + error));
</script>
</body>
</html>
`;
