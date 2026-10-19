# Tangokuningatar

Telegram bot ([@tangokuningatar_bot](https://t.me/tangokuningatar_bot)) for our group's daily LinkedIn puzzle scores: Queens, Tango, Zip, Mini Sudoku, Patches and Wend. Pinpoint and Crossclimb are not supported. Posting one earns a 👎 and some shaming.

It's a Cloudflare Worker that receives Telegram updates via webhook. Scores posted in our group are parsed ([src/parser.ts](src/parser.ts)), saved to D1 ([migrations/](migrations)), and get a 👍. Only the first result per person per puzzle counts; a repost gets a 🤨. Messages from every other chat are ignored.

The Worker also serves a Telegram Mini App at `/app`. For now it's a demo that only lists the viewer's own scores ([src/mini-app.ts](src/mini-app.ts)). The page itself is public. Its data comes from `/api/my-scores`, which only answers when the request carries initData signed by Telegram, and only for people who have posted a score in our group.

## Commands

- `/today`: today's leaderboard. Each player's times on today's puzzles are added up. More games played ranks higher, then the lower total time.
- `/week`: the same for the whole week, all games together. A week runs Saturday to Friday.
- `/week_queens`, `/week_tango`, `/week_zip`, `/week_mini_sudoku`, `/week_patches`, `/week_wend`: the week for one game. Typing `/week-zip` works too, but Telegram doesn't allow hyphens in the command menu.

The top three get medals, everyone else a 🐢. Days start when LinkedIn releases new puzzles, at midnight Pacific time (10:00 in Finland), so a week runs from Saturday's puzzles to Friday's. Older puzzles posted late don't count.

Commands live in [src/commands.ts](src/commands.ts). The menu Telegram shows when typing `/` is set on deploy from the list in [scripts/telegram.ts](scripts/telegram.ts).

## Development

Requires Node 24.

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

Then run `npm test`, `npm run typecheck` and `npm run smoke`. The smoke test starts `wrangler dev` and sends it real requests.

To try a fixture by hand, start the Worker with `npm run dev`, then:

```bash
curl -i -X POST http://localhost:8787/telegram/webhook -H "X-Telegram-Bot-Api-Secret-Token: local-dev-secret" --data @test/fixtures/group-score-message.json
```

Locally the Worker runs without a bot token, so it only logs the reactions and replies it would send (`telegram_dry_run`). Nothing gets posted to the real group.

## Deployment

Merging to `main` deploys. CI runs the checks, applies D1 migrations, uploads the Worker with its secrets via `wrangler deploy`, then registers the webhook with `setWebhook` and the command menu with `setMyCommands`. Pending updates are never dropped.

Secrets live in GitHub's `production` environment, limited to `main`:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `TELEGRAM_BOT_TOKEN`
- `WEBHOOK_SECRET`

To redeploy without a code change, for example after rotating a secret, use **Actions → CI → Run workflow**. To check or delete the webhook, use **Actions → Telegram webhook**.

Logs are in the Cloudflare dashboard (Workers & Pages → tangokuningatar → Logs). For a live stream, run `npm run tail` after a one-time `npx wrangler login`.

## Mini App setup

One-time, in [@BotFather](https://t.me/BotFather): open the bot's **Bot Settings → Configure Mini App**, enable it and set the URL to the Worker's `workers.dev` URL plus `/app`. That adds **Open App** to the bot's profile, and `https://t.me/tangokuningatar_bot?startapp` opens it from any chat. Pin that link in the group.

The page only works inside Telegram, so try changes by deploying. Opened in a normal browser, it just says so.

## If the group becomes a supergroup

Some group settings make Telegram upgrade a group to a supergroup, which changes its chat ID. Until the ID is updated, the bot ignores the group. The logs will show a `chat_migrated` warning with the new ID. Put it in `ALLOWED_CHAT_ID` in [wrangler.jsonc](wrangler.jsonc) and merge.
