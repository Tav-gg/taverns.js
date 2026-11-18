# Changelog

All notable changes to taverns.js are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) (while the version is 0.x, a minor release can break things).

## [0.3.0] - 2026-11-18

This release also contains the member moderation helpers from 0.2.2, which was tagged but never
published to npm.

### Added

- **Voice halls.** `client.voice.join(hallId)` connects the bot to a voice hall. It can play files,
  http(s) URLs, streams and raw PCM, with pause, resume, stop and volume. The connection renews itself
  and reports why it ended (`disconnected`). Needs the optional `@livekit/rtc-node` package, and
  ffmpeg (`ffmpeg-static` or your own) to play files and URLs.
- **Hearing a voice hall.** With the `LISTEN_VOICE` permission ("Listen in voice halls"), requested by
  the bot and granted by the tavern, a connection emits per-speaker `audio` frames and `speaking` events.
- **Listen-only voice.** A bot with Connect and Listen but no Speak in a hall can join it to hear it.
  `connection.canSpeak` (also `canSpeak` in the join answer and in `botVoiceUpdated`) says whether the bot
  may play; when it may not, `play()` and `playPCM()` throw an error with `code: 'VOICE_CANNOT_SPEAK'`.
  The audio track is published on the first play, never for a listen-only bot. Speak and Listen changes
  apply live (`canSpeak` and `listening` events): losing Speak stops playback, getting it back lets the
  next play publish again.
- `client.rest.joinVoice()` and `client.rest.leaveVoice()`, the `botVoiceDisconnected` and
  `botVoiceUpdated` events, and the `LISTEN_VOICE` permission flag.
- **Direct messages.** `client.sendDM(userId, content)` opens the bot's DM with a person the first time
  and reuses the channel after that. Also `createDM`, `sendDMMessage`, `getDMChannel`, `getDMMessages`,
  `editDMMessage` and `deleteDMMessage` on the client and on `client.rest`, and the `DmChannel`,
  `DmMessage` and `DmMessageDelete` types.
- The `DIRECT_MESSAGES` intent (`1n << 16n`, not privileged) and the `dmMessageCreate`,
  `dmMessageUpdate` and `dmMessageDelete` events. Messages from `dmMessageCreate` have `reply()`.
- `TavernAPIError.code`: the error code the API sent (for example `'CANNOT_DM_USER'`), with the
  `DMErrorCode` constants.
- `RateLimitError` (a `TavernAPIError`) with `retryAfter` (seconds), `scope` and `global`.
- Member moderation: `kickMember`, `banMember`, `unbanMember`, `muteMember` and `unmuteMember` on the
  client and on `client.rest`.
- `allowInsecure` option on `Client`, `RESTClient` and `Gateway`, to use plain `http://` and `ws://`
  URLs against a local test server.
- `CHANGELOG.md` and `SECURITY.md`.

### Changed

- **Breaking:** `rest.banMember(tavernId, userId, options?)` takes an options object
  (`{ reason, deleteMessageSeconds, auto }`) instead of a reason string.
- **Breaking:** `verifyWebhookSignature` throws a `TypeError` when the secret is empty or missing, and
  when the body is not a string or bytes (for example parsed JSON). Before, an empty secret produced a
  signature anyone could compute.
- **Breaking:** `verifyWebhookSignature` always checks that a request is recent (5 minutes by default),
  using the `timestamp` inside the signed body. Before, it trusted the unsigned `X-Tavern-Timestamp`
  header and skipped the check when the header was missing, so an old request could be replayed. When
  the header is passed, it must match the signed timestamp. Pass `maxAge: 0` to turn the check off.
- **Breaking:** custom `apiUrl` and `wsUrl` must use `https://` and `wss://`. Plain `http://` and `ws://`
  are refused unless `allowInsecure: true` is set, because the bot token would travel unencrypted.
- `GatewayIntents.DEFAULT` is now `0x17FF9n` and `GatewayIntents.ALL` is `0x1FFFFn`, so both include
  `DIRECT_MESSAGES`.
- A request refused with 429 that is still refused after the retries now rejects with
  `RateLimitError` (before: a plain `TavernAPIError` with the message "Rate limited"). A request over a
  direct message limit is not sent again at all: it rejects at once, with the limit in `scope`.
- `PermissionsBitField.has('LISTEN_VOICE')` is no longer true for `ADMINISTRATOR` alone. Listen in voice
  halls is always granted on its own, as the platform treats it.
- When the gateway refuses the bot token (HTTP 401 or 403 on connect, or close codes 4001, 4003 and
  4004), the client stops reconnecting and emits an `error` event. Before, a refused handshake was
  retried forever, and a refusing close code left the bot silently disconnected.
- The minimum `ws` version is now 8.21.0.

### Security

- Every ID placed in a REST path is escaped as a single path segment, and empty, `.` and `..` IDs are
  refused. Before, an ID taken from user input (for example `../x`, or text with `?` or `#`) could send
  the bot's request to a different route.
- `ws` 8.21.0 or later is required. Older versions are affected by
  [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) (memory exhaustion, high) and
  [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) (moderate).
- Webhook verification: empty secrets are refused, freshness uses the signed timestamp, and malformed
  signature headers return `false` instead of throwing.

### Fixed

- **A message, a kick or a ban is never sent twice.** The REST client used to send POST, PATCH and
  DELETE requests again after a server error (5xx) or a dropped connection, even when the API had
  already acted on them. Now:
  - a request answered with 429 is sent again after the wait the API asks for, whatever the method;
  - after a server error or a dropped connection, only GET and PUT requests are sent again (up to 3
    times, after 1, 2 and 4 seconds);
  - POST, PATCH and DELETE requests are sent again only when the connection could not be opened at all
    (the host name did not resolve, or the connection was refused), because the API never received them.
- An error answer with an empty body (for example a 500 with no content) resolved as if the request had
  worked; it now rejects with `TavernAPIError`.
- A connection lost in the middle of an answer left the request waiting forever; it is now handled like
  any other dropped connection.
- The `User-Agent` header reports the real SDK version.
- A gateway URL that already has a query string gets the token appended correctly.

## [0.2.1] - 2026-04-12

Earlier versions are described in the git history.

[0.3.0]: https://github.com/Tav-gg/taverns.js/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/Tav-gg/taverns.js/tree/v0.2.1
