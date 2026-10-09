# Tangokuningatar

Telegram bot ([@tangokuningatar_bot](https://t.me/tangokuningatar_bot)) for our group's daily LinkedIn puzzle scores: Queens, Tango, Zip, Mini Sudoku, Patches and Wend. Pinpoint and Crossclimb are deliberately not supported: posting one earns a 👎 and some public shaming.

**Current phase:** a Cloudflare Worker that receives Telegram updates through a webhook, verifies them, and parses the scores people post. It reacts to each score with 👍 and, for now, replies with what it parsed. Storage (D1) and leaderboards come later.

## How it works

Telegram POSTs every update to `https://tangokuningatar.<subdomain>.workers.dev/telegram/webhook`. The Worker:

1. Returns 404 for any other path, and 405 for any method other than POST.
2. Returns 401 and does nothing else unless the `X-Telegram-Bot-Api-Secret-Token` header matches `WEBHOOK_SECRET`. The comparison is constant-time.
3. For messages from our group (`ALLOWED_CHAT_ID`), logs the update ID, sender, date, text and parsed scores, plus the raw update JSON.
4. If a message from our group contains one or more scores, reacts to it with 👍 and replies with what was parsed. If it contains a Pinpoint or Crossclimb result, reacts with 👎 and replies with a shaming line instead. Bots get one reaction per message, so 👎 wins when both appear, and the parsed scores are listed under the shame. Other messages get no response.
5. Ignores updates from every other chat, including private chats, and logs only a metadata line with no message content. If someone adds the bot to another chat, that line records who did it.
6. Logs a `chat_migrated` warning with the new chat ID if Telegram upgrades our group to a supergroup. See [When the group becomes a supergroup](#when-the-group-becomes-a-supergroup).
7. Always answers authenticated requests with 200, even if processing fails. Otherwise Telegram would keep redelivering the same update. The reaction and reply are sent after the 200, so a slow Bot API call can't cause a redelivery.

Security is layered:

- The bot can't be added to new groups, because "join groups" is disabled in BotFather.
- Every request must carry the webhook secret.
- The Worker only acts on our chat ID.

| Setting | Where it lives |
|---|---|
| `ALLOWED_CHAT_ID` | `vars` in [wrangler.jsonc](wrangler.jsonc) (public, harmless on its own) |
| `WEBHOOK_SECRET` | GitHub secret, uploaded to the Worker on every deploy |
| `TELEGRAM_BOT_TOKEN` | GitHub secret, uploaded to the Worker on every deploy and used to register the webhook |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub secrets, used by the deploy job |

## Score parsing

[src/parser.ts](src/parser.ts) reads LinkedIn's share text. A result starts with a `<Game> #<number>` line. The time follows either on that line (`Wend #123 | 1:22 🌀`) or at the start of the next one (`Queens #892` / `1:00 👑`). "no hints" and "no redraws" count if they appear between the header and the `lnkd.in` link. Each score has:

| Field | Example |
|---|---|
| `game` | `queens`, `tango`, `zip`, `mini-sudoku`, `patches`, `wend` |
| `puzzleNumber` | `206` |
| `timeSeconds` | `29` (from `0:29`; `h:mm:ss` also works) |
| `noHints`, `noRedraws` | `true` if the text says so, otherwise `false` |

It tolerates chatter around the result, several results in one message, photo captions, CRLF line endings, non-breaking and zero-width spaces, and lowercase game names. A puzzle name without a time right after it ("Queens #892 oli vaikea") is not a score.

Pinpoint and Crossclimb are never parsed as scores. `findShamefulGames` only spots their results so the bot can shame the poster. It looks for a `Pinpoint #512 | …` header or a `lnkd.in/pinpoint` / `lnkd.in/crossclimb` link. A mention like "Pinpoint #512 oli helppo" goes unpunished.

## Project layout

```
src/index.ts          HTTP layer: routing, secret check, always-200 for authenticated requests
src/auth.ts           constant-time secret comparison
src/handler.ts        allowlist, migration warning, logging, reacting and replying to scores
src/parser.ts         parses LinkedIn share texts into scores
src/bot-api.ts        minimal Bot API client (plain fetch); only logs when there's no token
src/telegram.ts       the Telegram types we read
test/                 Vitest tests, run inside the Workers runtime; fixtures/ holds sample updates
scripts/telegram.ts   set-webhook / webhook-info / delete-webhook
scripts/smoke-test.ts starts `wrangler dev` and sends real HTTP requests to it
.github/workflows/    CI + deploy, and manual webhook tools
```

## First-time setup

These steps are done once, and are already done for this repo.

1. **Cloudflare:**
   - Create a free account and choose a workers.dev subdomain under **Workers & Pages**.
   - Create an API token from the **Edit Cloudflare Workers** template.
2. **GitHub:**
   - Under **Settings → Environments**, create an environment named `production`.
   - Limit its deployment branches to `main`.
   - Add these environment secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TELEGRAM_BOT_TOKEN` and `WEBHOOK_SECRET`. Generate `WEBHOOK_SECRET` without ever seeing it:
     ```bash
     openssl rand -hex 32 | gh secret set WEBHOOK_SECRET --env production
     ```
3. **Telegram:**
   - Add the bot to the group.
   - In BotFather, run `/setjoingroups` and choose **Disable**, so nobody can add the bot anywhere else.
   - Privacy mode (`/setprivacy`) must be **Disabled**, so the bot sees every message, not only commands.

## Local development

Requires Node 24 (see [.nvmrc](.nvmrc)).

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run types
```

`npm run types` generates `worker-configuration.d.ts`, which gives your editor the `Env` and Workers runtime types. Run it again after changing `wrangler.jsonc`.

`.dev.vars` has a local `WEBHOOK_SECRET` (`local-dev-secret`). It doesn't need to match production, because Telegram never calls your machine.

`npm run dev` and the smoke test always run the Worker without a bot token, even if `.dev.vars` has one. Instead of reacting and replying, the Worker logs a `telegram_dry_run` entry with the call it would have made. Curling a fixture can't post into the real group.

Run the tests, the typecheck, and the smoke test (which starts `wrangler dev` and sends it real requests):

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run smoke
```

### Sending fixture updates by hand

Start the Worker locally, at http://localhost:8787:

```bash
npm run dev
```

In another terminal, POST any file from [test/fixtures](test/fixtures) the way Telegram would:

```bash
curl -i -X POST http://localhost:8787/telegram/webhook -H "Content-Type: application/json" -H "X-Telegram-Bot-Api-Secret-Token: local-dev-secret" --data @test/fixtures/group-score-message.json
```

The log lines appear in the `npm run dev` terminal, including the parsed `scores` and the dry-run reaction and reply. Drop the secret header or change its value to see the 401.

## Deployment

Merging to `main` deploys. The [CI workflow](.github/workflows/ci.yml):

1. On every PR and push, runs the typecheck, tests and smoke test.
2. On `main` only, deploys the Worker with `wrangler deploy`. `WEBHOOK_SECRET` is uploaded as part of the same version.
3. Registers the webhook with Telegram (`setWebhook`). It uses the deployed URL, the same secret, and `allowed_updates: ["message", "my_chat_member"]`. It never drops pending updates, so updates queued during downtime (up to 24 hours) are still delivered.

To redeploy without a code change, for example after rotating `WEBHOOK_SECRET`, go to **Actions → CI → Run workflow** on `main`.

### Webhook debugging

From GitHub: **Actions → Telegram webhook → Run workflow**, then pick one:

- `webhook-info` shows the registered URL, pending update count, and the last delivery error.
- `delete-webhook` removes the webhook and keeps pending updates. To restore it, re-run the CI workflow.

From your machine, with `TELEGRAM_BOT_TOKEN` filled in `.dev.vars`:

```bash
npm run webhook:info
```

The webhook is only *set* from CI on purpose. The production `WEBHOOK_SECRET` only exists in GitHub, and registering any other value would make the Worker reject every update.

### Watching the logs

- **Cloudflare dashboard:** Workers & Pages → tangokuningatar → **Logs**. Logs are kept, so you can search past updates there.
- **Live stream:** run `npm run tail`. It needs a one-time `npx wrangler login` first.

Every log entry is a JSON object with an `event` field:

| Event | Meaning |
|---|---|
| `group_message` | A message in our group. Has `from_name`, `date`, `text`, `scores` (parsed, empty if none), `shameful_games` and `raw` (the full update). |
| `bot_membership_changed` | The bot was added, removed or promoted somewhere. `allowed_chat` says whether it was our group. |
| `ignored_update` | An update from another chat, or of a type we don't handle. |
| `chat_migrated` | **Action required**, see below. |
| `telegram_error` | Reacting or replying failed. `error` has Telegram's reason. |
| `telegram_dry_run` | The Worker has no bot token, so it only logged a reaction or reply. Expected locally, a misconfiguration in production. |
| `config_error`, `processing_error` | Something is misconfigured or broken. |

## When the group becomes a supergroup

Our group (`-5465433776`) is a regular group. If Telegram ever upgrades it to a supergroup (this can happen when changing some group settings), it gets a new `-100…` ID. Until the allowlist is updated, the bot ignores the group.

When that happens, a `chat_migrated` warning shows up in the logs with the new ID. To fix it:

1. Set `ALLOWED_CHAT_ID` in [wrangler.jsonc](wrangler.jsonc) to `new_chat_id` from the warning.
2. Merge to `main`.
