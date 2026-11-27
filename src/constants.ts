/**
 * taverns.js - Constants
 *
 * API versions, URLs, enums, and event names used throughout the SDK.
 */

// ─── API Configuration ──────────────────────────────────────

export const API_VERSION = 'v1';
export const DEFAULT_API_URL = 'https://api.tav.gg/api/v1';
export const DEFAULT_WS_URL = 'wss://ws.tav.gg';

// ─── Bot Token Prefix ────────────────────────────────────────

export const BOT_TOKEN_PREFIX = 'tavbot_';

// ─── Channel Types ───────────────────────────────────────────

export enum ChannelType {
  TEXT = 'TEXT',
  ANNOUNCEMENT = 'ANNOUNCEMENT',
  THREAD = 'THREAD',
  VOICE = 'VOICE',
  MIRROR = 'MIRROR',
  FORUM = 'FORUM',
}

// ─── Message Status ──────────────────────────────────────────

export enum MessageStatus {
  SENT = 'SENT',
  FILTERED = 'FILTERED',
  DELETED = 'DELETED',
}

// ─── Bot Application Status ─────────────────────────────────

export enum BotStatus {
  CREATED = 'CREATED',
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
  BANNED = 'BANNED',
}

// ─── Member Status ──────────────────────────────────────────

export enum MemberStatus {
  ACTIVE = 'ACTIVE',
  PENDING = 'PENDING',
  BANNED = 'BANNED',
}

// ─── Gateway Intents ────────────────────────────────────────
// Bitfield values controlling which events the bot receives.
// Pass a combination of these to the Client constructor to filter events.

export const GatewayIntents = {
  TAVERN_MESSAGES:   1n << 0n,
  /**
   * Privileged. Without it, `content` (and embeds and attachments) of tavern
   * messages is empty, except in the bot's own messages, messages that mention
   * the bot and its direct messages. Turn it on in the Intents tab of the bot's
   * page in the Developer Portal. A public bot in more than 100 taverns needs
   * review to keep a privileged intent.
   */
  MESSAGE_CONTENT:   1n << 1n,
  /** Privileged. Members joining, leaving, changing and being muted (memberJoin, memberLeave, ...). */
  TAVERN_MEMBERS:    1n << 2n,
  TAVERN_MODERATION: 1n << 3n,
  TAVERN_CHANNELS:   1n << 4n,
  TAVERN_THREADS:    1n << 5n,
  TAVERN_FORUMS:     1n << 6n,
  /** Roles created, changed, reordered and deleted. */
  TAVERN_ROLES:      1n << 7n,
  TAVERN_SETTINGS:   1n << 8n,
  TAVERN_EVENTS:     1n << 9n,
  TAVERN_VOICE:      1n << 10n,
  TAVERN_BROADCASTS: 1n << 11n,
  /** Typing in tavern halls (typingStart, typingStop). */
  TAVERN_TYPING:     1n << 12n,
  TAVERN_REACTIONS:  1n << 13n,
  TAVERN_PINS:       1n << 14n,
  INTERACTIONS:      1n << 15n,
  /**
   * Messages people send, edit and delete in their direct messages with the
   * bot. Not privileged: message content in these DMs is always included.
   */
  DIRECT_MESSAGES:   1n << 16n,
  /** All non-privileged intents */
  DEFAULT: 0x17FF9n,
  /** All intents including privileged */
  ALL: 0x1FFFFn,
} as const;

// ─── Command Option Types ───────────────────────────────────
// Types for slash command options.

export enum CommandOptionType {
  STRING = 1,
  INTEGER = 2,
  BOOLEAN = 3,
  USER = 4,
  CHANNEL = 5,
  ROLE = 6,
  NUMBER = 7,
}

// ─── Gateway Events ─────────────────────────────────────────
// Events emitted by the WebSocket gateway that bots can listen to.

export enum GatewayEvent {
  // Connection lifecycle
  READY = 'ready',
  RECONNECTING = 'reconnecting',
  DISCONNECTED = 'disconnected',
  ERROR = 'error',
  DEBUG = 'debug',

  // Messages
  MESSAGE_CREATE = 'tavern_message',
  MESSAGE_EDIT = 'tavern_message_edited',
  MESSAGE_DELETE = 'tavern_message_deleted',
  MESSAGES_BULK_DELETE = 'tavern_messages_bulk_deleted',
  MESSAGE_PINNED = 'tavern_message_pinned',
  MESSAGE_UNPINNED = 'tavern_message_unpinned',
  MESSAGE_PUBLISHED = 'tavern_message_published',
  MESSAGE_MEDIA_PROCESSED = 'tavern_message_media_processed',

  // Members
  MEMBER_JOINED = 'tavern_member_joined',
  MEMBER_LEFT = 'tavern_member_left',
  MEMBER_MUTED = 'tavern_member_muted',
  MEMBER_UNMUTED = 'tavern_member_unmuted',

  // Channels
  CHANNEL_CREATED = 'tavern_channel_created',
  CHANNEL_UPDATED = 'tavern_channel_updated',
  CHANNEL_DELETED = 'tavern_channel_deleted',

  // Threads
  THREAD_CREATED = 'tavern_thread_created',
  THREAD_UPDATED = 'tavern_thread_updated',
  THREAD_DELETED = 'tavern_thread_deleted',
  THREAD_ARCHIVED = 'tavern_thread_archived',
  THREAD_MESSAGE = 'tavern_thread_message',

  // Forum
  FORUM_POST_CREATED = 'tavern_forum_post_created',
  FORUM_SETTINGS_UPDATED = 'tavern_forum_settings_updated',
  FORUM_POST_TAGS_UPDATED = 'tavern_forum_post_tags_updated',

  // Roles
  ROLE_CREATED = 'tavern_role_created',
  ROLE_UPDATED = 'tavern_role_updated',
  ROLE_DELETED = 'tavern_role_deleted',

  // Tavern
  TAVERN_UPDATED = 'tavern_updated',

  // Events
  EVENT_CREATED = 'tavern_event_created',
  EVENT_UPDATED = 'tavern_event_updated',
  EVENT_DELETED = 'tavern_event_deleted',
  EVENT_STARTING = 'tavern_event_starting',
  EVENT_ENDED = 'tavern_event_ended',

  // Voice
  VOICE_STATE_UPDATE = 'tavern_voice_state_update',
  VOICE_SERVER_MUTE = 'tavern_voice_server_mute',
  VOICE_USER_DISCONNECTED = 'tavern_voice_user_disconnected',

  // Typing (`isTyping` says whether it started or stopped)
  TYPING_INDICATOR = 'tavern_typing_indicator',

  // Bot lifecycle
  BOT_INSTALLED = 'bot_installed',
  BOT_REMOVED = 'bot_removed',
  BOT_PERMISSIONS_UPDATED = 'bot_permissions_updated',

  // Bot voice (sent to the bot about its own voice connection)
  BOT_VOICE_DISCONNECTED = 'bot_voice_disconnected',
  BOT_VOICE_UPDATED = 'bot_voice_updated',

  // Interactions (slash commands)
  INTERACTION_CREATE = 'interaction_create',

  // Direct messages (what people send in their DMs with the bot)
  DM_MESSAGE_CREATE = 'dm_message_create',
  DM_MESSAGE_UPDATE = 'dm_message_update',
  DM_MESSAGE_DELETE = 'dm_message_delete',
}

// ─── WebSocket Actions ──────────────────────────────────────
// Actions the bot can send to the gateway.

export enum GatewayAction {
  HEARTBEAT = 'heartbeat',
  /** Answered by the gateway with a `pong` event. */
  PING = 'ping',
  TYPING_START = 'tavern_typing_start',
  TYPING_STOP = 'tavern_typing_stop',
  MARK_READ = 'tavern_mark_read',
}

// ─── Friendly Event Name Map ────────────────────────────────
// Maps gateway wire events to friendly SDK event names. The typing indicator is
// not listed: the client emits it as typingStart or typingStop.

export const FRIENDLY_EVENT_MAP: Record<string, string> = {
  [GatewayEvent.MESSAGE_CREATE]: 'messageCreate',
  [GatewayEvent.MESSAGE_EDIT]: 'messageUpdate',
  [GatewayEvent.MESSAGE_DELETE]: 'messageDelete',
  [GatewayEvent.MESSAGES_BULK_DELETE]: 'messageDeleteBulk',
  [GatewayEvent.MESSAGE_PINNED]: 'messagePinned',
  [GatewayEvent.MESSAGE_UNPINNED]: 'messageUnpinned',
  [GatewayEvent.MESSAGE_PUBLISHED]: 'messagePublished',
  [GatewayEvent.MEMBER_JOINED]: 'memberJoin',
  [GatewayEvent.MEMBER_LEFT]: 'memberLeave',
  [GatewayEvent.MEMBER_MUTED]: 'memberMuted',
  [GatewayEvent.MEMBER_UNMUTED]: 'memberUnmuted',
  [GatewayEvent.CHANNEL_CREATED]: 'channelCreate',
  [GatewayEvent.CHANNEL_UPDATED]: 'channelUpdate',
  [GatewayEvent.CHANNEL_DELETED]: 'channelDelete',
  [GatewayEvent.THREAD_CREATED]: 'threadCreate',
  [GatewayEvent.THREAD_UPDATED]: 'threadUpdate',
  [GatewayEvent.THREAD_DELETED]: 'threadDelete',
  [GatewayEvent.THREAD_ARCHIVED]: 'threadArchived',
  [GatewayEvent.ROLE_CREATED]: 'roleCreate',
  [GatewayEvent.ROLE_UPDATED]: 'roleUpdate',
  [GatewayEvent.ROLE_DELETED]: 'roleDelete',
  [GatewayEvent.TAVERN_UPDATED]: 'tavernUpdate',
  [GatewayEvent.EVENT_CREATED]: 'eventCreate',
  [GatewayEvent.EVENT_UPDATED]: 'eventUpdate',
  [GatewayEvent.EVENT_DELETED]: 'eventDelete',
  [GatewayEvent.EVENT_STARTING]: 'eventStarting',
  [GatewayEvent.EVENT_ENDED]: 'eventEnded',
  [GatewayEvent.VOICE_STATE_UPDATE]: 'voiceStateUpdate',
  [GatewayEvent.BOT_INSTALLED]: 'botInstalled',
  [GatewayEvent.BOT_REMOVED]: 'botRemoved',
  [GatewayEvent.BOT_PERMISSIONS_UPDATED]: 'botPermissionsUpdated',
  [GatewayEvent.BOT_VOICE_DISCONNECTED]: 'botVoiceDisconnected',
  [GatewayEvent.BOT_VOICE_UPDATED]: 'botVoiceUpdated',
  [GatewayEvent.INTERACTION_CREATE]: 'interactionCreate',
  [GatewayEvent.DM_MESSAGE_CREATE]: 'dmMessageCreate',
  [GatewayEvent.DM_MESSAGE_UPDATE]: 'dmMessageUpdate',
  [GatewayEvent.DM_MESSAGE_DELETE]: 'dmMessageDelete',
};

// ─── Direct Message Errors ──────────────────────────────────
// The `code` of a failed direct message request (see TavernAPIError.code).

export const DMErrorCode = {
  /** The bot may not message this person (one answer for every reason). */
  CANNOT_DM_USER: 'CANNOT_DM_USER',
  /** Direct messages are turned off for this app. */
  BOT_DM_DISABLED: 'BOT_DM_DISABLED',
  /** Opening new DMs needs the app to pass review (public apps in more than 100 taverns). */
  BOT_DM_REVIEW_REQUIRED: 'BOT_DM_REVIEW_REQUIRED',
  /** The channel is not one of this bot's direct messages. */
  DM_CHANNEL_NOT_FOUND: 'DM_CHANNEL_NOT_FOUND',
  /** The message does not exist in this direct message. */
  DM_MESSAGE_NOT_FOUND: 'DM_MESSAGE_NOT_FOUND',
  /** The bot can edit and delete only its own messages. */
  NOT_YOUR_MESSAGE: 'NOT_YOUR_MESSAGE',
  /** A direct message limit was hit; see RateLimitError.scope and retryAfter. */
  BOT_DM_RATE_LIMITED: 'BOT_DM_RATE_LIMITED',
} as const;

export type DMErrorCode = (typeof DMErrorCode)[keyof typeof DMErrorCode];

/** Which direct message limit a 429 answer refers to (RateLimitError.scope). */
export type DMRateLimitScope =
  | 'user_burst'
  | 'user_hourly'
  | 'unanswered'
  | 'global'
  | 'open_burst'
  | 'open_daily';
