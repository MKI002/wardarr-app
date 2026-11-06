# Notifications

Wardarr can tell you when something needs you: a new problem in the Issue
Center, a problem that is fixed, or a request that waits for approval.
Admins set this up under **Settings → Notifications**.

## Channels

| Kind     | What you need                                       | Notes                                       |
| -------- | --------------------------------------------------- | ------------------------------------------- |
| Webhook  | Any address that accepts a JSON `POST`              | Optional signing secret, see below.         |
| Discord  | A channel webhook (channel settings → Integrations) | The webhook address is stored as a secret.  |
| ntfy     | A topic, and the server if it is not ntfy.sh        | Optional access token for protected topics. |
| Gotify   | Your Gotify server and an application token         |                                             |
| Telegram | A bot token and the chat id the bot writes to       |                                             |

Every channel has a **Send test** button. Secrets are write-only: once
saved, the form only shows that a value is set. Leave the field empty to
keep it.

## What is sent

- **New issues** above the threshold you pick: critical only, warnings and
  critical, all, or none. Wardarr waits a minute before it announces an
  issue, so problems that fix themselves stay quiet.
- **Issues resolved**, only on channels that announced them.
- **Requests waiting for approval**, for requests made in Wardarr.

A channel sends at most 20 messages in 10 minutes. Each channel has its
own language.

## Links back to Wardarr

Set `WARDARR_PUBLIC_URL` to the address you open Wardarr at, for example
`https://wardarr.example.com`. Messages then link to the issue or request.
Without it, messages carry no links.

## Webhook format

```json
{
  "source": "wardarr",
  "event": "issueOpened",
  "level": "warning",
  "title": "ExampleIndexer unreachable for more than 6 hours",
  "body": "Used by Sonarr and Radarr.\nCheck the indexer in Prowlarr.",
  "url": "https://wardarr.example.com/issues?focus=…",
  "at": "2026-01-01T12:00:00.000Z"
}
```

`event` is one of `issueOpened`, `issueResolved`, `requestPending` or
`test`; `level` is `critical`, `warning`, `info` or `ok`.

With a signing secret, every request carries
`x-wardarr-signature: sha256=<hex>`, the HMAC-SHA256 of the raw body with
your secret. Compare it in constant time before you trust the message.
