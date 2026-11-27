# Changelog

All notable changes to taverns.js are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) (while the version is 0.x, a minor release can break things).

## [0.4.1] - 2026-11-27

- The `memberJoin` type now describes both forms of the event. Use `event.user` for the name on every join. A person joining has a `member` row. A bot installation has `isBot: true` and a `botApplicationId`. Use `getMember(event.tavernId, event.user.id)` if you need that bot's full member row.

## [0.4.0] - 2026-11-27

This release makes the SDK match the Taverns API. Several calls and events did not work in 0.3.0; they do now.

### Added

- `botPermissionsUpdated` event, sent when a tavern changes the permissions it grants the bot. The cached tavern's
  `grantedPermissions` follows it.
- `roleCreate` event (needs the `TAVERN_ROLES` intent).
- `botInstalled` has the tavern's name (`tavernName`), and the cached tavern uses it.
- `rest.reorderRoles()`. With `MANAGE_ROLES`, a bot can create, edit, reorder, delete, give and take away roles below
  its own highest role, and give a role only permissions it has itself.
- `rest.searchMembers(tavernId, query, { limit })` finds members by name, nickname or @handle.
- `rest.getChannelList()` (channels and categories in one request), `rest.getCategories()` and `tavern.categories`.
- `client.stopTyping()`.
- `deferReply({ ephemeral })` and `rest.deferInteraction(id, { ephemeral })`.
- Messages and interaction answers can be embeds only: `content` may be left out when `embeds` are given.
- More options the API takes: `replyPing` and `nonce` when sending, `around` and `direction` for history,
  `includeArchived` for threads, `unicodeEmoji` and `isHoisted` for roles, and the search filters `channelId`,
  `mentionsUserId`, `has`, `before`, `after` and `includeThreads`.
- `gateway.latency`: the round trip of the last ping, in milliseconds.
- `messageCreate` and `interactionCreate` listeners are typed with their helper methods (`reply()` and the others).

### Changed

- **Breaking:** `client.getMessages()` and `rest.getMessages()` return `{ messages, hasMore }` instead of a list.
- **Breaking:** `searchMessages()` takes `q` and `fromUserId`, its `offset` is a message ID (not a number), and it
  answers `{ messages, hasMore, total, nextOffset }`. It always searches the whole tavern; `channelId` narrows it to one
  hall and its threads.
- **Breaking:** `getMembers(tavernId)` takes no paging options. The API returns every member at once and never used
  them. Use `searchMembers()` to find members by name.
- **Breaking:** `SendMessageOptions` has no `metadata`, which the API refused, and its `content` is optional.
- **Breaking:** the event types listed under Fixed. `BulkDeleteEvent.count` and `PaginatedMessages.nextCursor` are
  removed, because the API never sends them.
- **Breaking:** `GatewayEvent.TYPING_START` and `TYPING_STOP` are replaced by `GatewayEvent.TYPING_INDICATOR`, the
  event the gateway sends. The `GatewayAction` values for sending typing are unchanged.
- Like on Discord, a bot without the `MESSAGE_CONTENT` intent gets empty `content` (and no embeds or attachments) for
  other people's tavern messages, in events and in the API's answers. The bot's own messages, messages that mention
  the bot and its direct messages keep their content. Turn on Message Content in the Intents tab of your bot's page in
  the Developer Portal. The README explains it.
- An interaction gets one answer: `reply()`, or `deferReply()` and then one `reply()` or `followUp()`. The README and
  the method notes say so.

### Deprecated

- The `query` and `senderId` options of `searchMessages()` still work. Use `q` and `fromUserId`.

### Fixed

- The package declares the Node.js types used in its public TypeScript declarations. Building the SDK uses only the Node.js global types.
- **Replying to messages works.** The channel list comes back as `{ channels, categories }`, which 0.3.0 read as a
  plain list, so the channel cache stayed empty and `message.reply()`, `edit()`, `delete()`, `pin()`, `unpin()` and
  `react()` failed (the `!ping` example too). The cache is filled now, and the message helpers use the tavern named in
  the event, so they work even for a channel that is not cached. `client.rest.getChannels()` returns the channels.
- `getMessages()` returns the page the API sends, `{ messages, hasMore }`.
- `searchMessages()` sends what the API takes: `q`, `fromUserId`, and `offset` as the `nextOffset` message ID of the
  previous page. It answers `{ messages, hasMore, total, nextOffset }`.
- `editMessage()` and `message.edit()` send only the new text. Anything else made the API refuse the edit.
- `getMember()` returns one member (a person or a bot), `kickMember()` keeps its reason in the tavern's audit log, and
  `addMemberRole()` and `removeMemberRole()` work with a user ID.
- `typingStart` and `typingStop` are emitted. They never fired before.
- `messageDelete`, `messagePinned` and `messageUnpinned` carry `messageId`, `channelDelete` carries `channelId` and
  `roleDelete` carries `roleId`, as the API sends them (the types said `id`). A deleted channel now leaves the cache.
- `memberJoin` carries `{ tavernId, user, member }`, and the member cache keeps the whole member.
- The `Member` type matches the API: the membership `id`, `userId`, `nickname`, `joinedAt`, `user`, `roles`,
  `isOnline`, `status` (online, idle, do not disturb or `null`), `isOwner` and `isBot`.
- The connection is kept alive the way the gateway expects. The client sends a `ping` with each heartbeat and treats a
  connection that has heard nothing for 75 seconds as lost, so it reconnects instead of waiting forever. Every
  disconnect by the gateway (for example a service restart) is followed by a reconnect. Only a token refused when
  connecting (HTTP 401 or 403) stops it. Close codes 4001, 4003 and 4004 are not used by the gateway and no longer mean
  a refused token.

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

[0.4.1]: https://github.com/Tav-gg/taverns.js/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/Tav-gg/taverns.js/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Tav-gg/taverns.js/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/Tav-gg/taverns.js/tree/v0.2.1
