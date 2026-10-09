# Tangokuningatar

Telegram bot ([@tangokuningatar_bot](https://t.me/tangokuningatar_bot)) for our group's daily LinkedIn puzzle scores: Queens, Tango, Zip, Mini Sudoku, Patches and Wend. Pinpoint and Crossclimb are not supported. Posting one earns a 👎 and some shaming.

It's a Cloudflare Worker that receives Telegram updates via webhook. Messages from our group get parsed ([src/parser.ts](src/parser.ts)), and the bot reacts to each score with 👍 and replies with what it parsed. Messages from every other chat are ignored. Storage and leaderboards come later.

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

Merging to `main` deploys. CI runs the checks, then `wrangler deploy` uploads the Worker with its secrets, and `setWebhook` registers it with Telegram. Pending updates are never dropped.

Secrets live in GitHub's `production` environment, limited to `main`:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `TELEGRAM_BOT_TOKEN`
- `WEBHOOK_SECRET`

To redeploy without a code change, for example after rotating a secret, use **Actions → CI → Run workflow**. To check or delete the webhook, use **Actions → Telegram webhook**.

Logs are in the Cloudflare dashboard (Workers & Pages → tangokuningatar → Logs). For a live stream, run `npm run tail` after a one-time `npx wrangler login`.

## If the group becomes a supergroup

Some group settings make Telegram upgrade a group to a supergroup, which changes its chat ID. Until the ID is updated, the bot ignores the group. The logs will show a `chat_migrated` warning with the new ID. Put it in `ALLOWED_CHAT_ID` in [wrangler.jsonc](wrangler.jsonc) and merge.
