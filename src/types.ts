/**
 * taverns.js - Type Definitions
 *
 * TypeScript interfaces that mirror the Taverns API responses.
 * All IDs are UUIDs represented as strings.
 */

import { ChannelType, MessageStatus, BotStatus, CommandOptionType } from './constants';
import type { Embed } from './embed';
import type { VoiceOptions } from './voice';
import type { ActionableDmMessage, ActionableInteraction, ActionableMessage } from './client';

// ─── Users ──────────────────────────────────────────────────

export interface User {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  avatarAnimated?: boolean;
  bannerUrl?: string | null;
  /** The @handle, when the person has one. */
  username?: string | null;
  isBot?: boolean;
  createdAt?: string;
}

// ─── Bot Identity ───────────────────────────────────────────

/** The bot's own identity returned by GET /bots/@me */
export interface BotSelf {
  id: string;
  name: string;
  description: string | null;
  user: User;
  taverns: InstalledTavern[];
}

/** A tavern the bot is installed in */
export interface InstalledTavern {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  memberCount: number;
  grantedPermissions: string;
  installedAt: string;
}

// ─── Taverns ────────────────────────────────────────────────

export interface Tavern {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  bannerUrl?: string | null;
  description?: string | null;
  memberCount: number;
  isPublic?: boolean;
  ownerId?: string;
  grantedPermissions?: string;
  installedAt?: string;
  channels?: Channel[];
  categories?: Category[];
  roles?: Role[];
  members?: Member[];
}

// ─── Channels ───────────────────────────────────────────────

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  tavernId: string;
  topic?: string | null;
  position: number;
  categoryId?: string | null;
  slowModeSeconds?: number;
  isNsfw?: boolean;
  isArchived?: boolean;
  isPrivate?: boolean;
  createdAt?: string;
  // Thread-specific
  parentChannelId?: string | null;
  rootMessageId?: string | null;
  creatorId?: string | null;
  isPrivateThread?: boolean;
  autoArchiveDuration?: number;
  archivedAt?: string | null;
  threadMetadata?: ThreadMetadata | null;
}

export interface ThreadMetadata {
  messageCount?: number;
  lastMessageAt?: string;
  lastSenderId?: string;
  lastSenderName?: string;
  lastSenderAvatarUrl?: string | null;
  lastMessagePreview?: string;
}

export interface Category {
  id: string;
  name: string;
  position: number;
  tavernId: string;
  isPrivate?: boolean;
  isNsfw?: boolean;
}

/** The answer of GET /taverns/:tavernId/channels: the channels and categories the bot can see. */
export interface ChannelList {
  channels: Channel[];
  categories: Category[];
}

// ─── Members ────────────────────────────────────────────────

/** A member of a tavern, as GET /taverns/:tavernId/members lists them. */
export interface Member {
  /** The membership ID (not the user ID). */
  id: string;
  userId: string;
  /** Set by the client helpers (the API leaves it out: you asked for that tavern). */
  tavernId?: string;
  nickname: string | null;
  joinedAt: string;
  user: User;
  roles: MemberRole[];
  isOnline: boolean;
  /** Presence: `null` when offline or hidden. */
  status: 'ONLINE' | 'IDLE' | 'DND' | null;
  isOwner: boolean;
  isBot: boolean;
  /** What the member is playing or doing, when they share it. */
  activity?: Record<string, unknown> | null;
}

export interface MemberRole {
  id: string;
  name: string;
  color?: string | null;
  iconUrl?: string | null;
  unicodeEmoji?: string | null;
  position: number;
  isHoisted?: boolean;
}

/** A member found by `searchMembers` (a shorter shape than `Member`). */
export interface MemberSearchResult {
  /** The membership ID (not the user ID). */
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  avatarAnimated?: boolean;
  nickname: string | null;
  /** The @handle, when the person has one. */
  username: string | null;
}

// ─── Roles ──────────────────────────────────────────────────

export interface Role {
  id: string;
  name: string;
  color?: string | null;
  iconUrl?: string | null;
  unicodeEmoji?: string | null;
  isMentionable: boolean;
  isHoisted?: boolean;
  /** Higher is more powerful. 0 is @everyone. */
  position: number;
  permissions: string;
  memberCount?: number;
  createdAt?: string;
}

// ─── Messages ───────────────────────────────────────────────

export interface Message {
  id: string;
  channelId: string;
  tavernId?: string;
  /**
   * The text. Empty in other people's messages unless the bot has the
   * MESSAGE_CONTENT intent or the message mentions the bot.
   */
  content: string;
  filteredContent?: string | null;
  status: MessageStatus;
  replyToId?: string | null;
  replyTo?: MessageReply | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  editedAt?: string | null;
  isPinned?: boolean;
  isPublished?: boolean;
  publishedAt?: string | null;
  isSyndicated?: boolean;
  originalAuthorName?: string | null;
  originalAuthorAvatar?: string | null;
  sourceTavernName?: string | null;
  sourceTavernId?: string | null;
  sender: MessageSender;
}

export interface MessageReply {
  id: string;
  senderId: string;
  senderName: string;
  preview: string;
}

export interface MessageSender {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  aetherName?: string | null;
  nickname?: string | null;
  roles?: MemberRole[];
  isBot?: boolean;
}

// ─── Message Payloads ───────────────────────────────────────

/** A message to send. It needs content or at least one embed. */
export interface SendMessageOptions {
  /** Up to 2000 characters. May be left out when `embeds` are given. */
  content?: string;
  /** Up to 5 embeds. */
  embeds?: Embed[];
  /** The ID of a message in the same channel to reply to. */
  replyToId?: string;
  /** With `replyToId`: `false` replies without notifying the author. Default: true. */
  replyPing?: boolean;
  /** Your own ID for this send (up to 64 characters), echoed back on the message. */
  nonce?: string;
}

/** Only the text of a message can be edited. */
export interface EditMessageOptions {
  /** 1 to 2000 characters. */
  content: string;
}

export interface GetMessagesOptions {
  /** 1 to 100 (default 50). */
  limit?: number;
  /** Messages older than this message ID. */
  before?: string;
  /** Messages newer than this message ID (with `direction: 'forward'`: the ones right after it). */
  after?: string;
  /** With `after`: page forward from it, oldest first. */
  direction?: 'forward';
  /** About half the page before and half after this message ID (it included). */
  around?: string;
}

/** One page of a channel's history, oldest first. */
export interface PaginatedMessages {
  messages: Message[];
  /** More messages exist in the direction you paged. */
  hasMore: boolean;
  hasMoreBefore?: boolean;
  hasMoreAfter?: boolean;
  /** With `around`: whether that message was found. */
  targetFound?: boolean;
}

/**
 * Search a tavern's messages. Give words (`q`) or at least one filter
 * (`fromUserId`, `channelId`, `mentionsUserId`, `has`).
 */
export interface SearchMessagesOptions {
  /** Words to search for (up to 100 characters). */
  q?: string;
  /** @deprecated Use `q`. */
  query?: string;
  /** Only messages from this user. */
  fromUserId?: string;
  /** @deprecated Use `fromUserId`. */
  senderId?: string;
  /** Only this hall (and its threads, unless `includeThreads` is false). */
  channelId?: string;
  /** Only messages that mention this user. */
  mentionsUserId?: string;
  /** Only messages with all of these: image, video, audio, file, link, embed, gif, sticker, poll. */
  has?: string | string[];
  /** Messages before this date (ISO 8601) or message ID. */
  before?: string;
  /** Messages after this date (ISO 8601). */
  after?: string;
  /** 1 to 50 (default 25). */
  limit?: number;
  /** The next page: the `nextOffset` of the previous answer (a message ID). */
  offset?: string;
  /** Default true. `false` searches the halls only, not their threads and forum posts. */
  includeThreads?: boolean;
}

/** One page of search results, newest first. A page can hold fewer than `limit` results while `hasMore` is true. */
export interface MessageSearchResult {
  messages: Message[];
  hasMore: boolean;
  /** About how many messages match, when known. */
  total: number | null;
  /** Pass as `offset` for the next page. Null when there is none. */
  nextOffset: string | null;
}

// ─── Direct Messages ────────────────────────────────────────

/** A 1:1 direct message between the bot and one person. */
export interface DmChannel {
  id: string;
  type: 'dm';
  /** The person on the other side. */
  recipient: DmRecipient;
  createdAt: string;
  lastMessageAt: string | null;
}

export interface DmRecipient {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

/** A file in a direct message. */
export interface DmAttachment {
  url: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

/** A message in a direct message (also the data of the dm_message_create and dm_message_update events). */
export interface DmMessage {
  id: string;
  channelId: string;
  content: string;
  filteredContent: string | null;
  status: 'SENT' | 'FILTERED';
  replyToId: string | null;
  replyTo: MessageReply | null;
  embeds: Embed[];
  attachments: DmAttachment[];
  /** Present when the person sent a GIF. */
  gif?: { url: string; width?: number; height?: number };
  /** Present when the person sent a sticker. */
  sticker?: { id: string; name: string; imageUrl: string };
  createdAt: string;
  editedAt: string | null;
  sender: DmMessageSender;
}

export interface DmMessageSender {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isBot: boolean;
}

/** The data of the dm_message_delete event. */
export interface DmMessageDelete {
  id: string;
  channelId: string;
}

/** One page of a direct message's history, oldest first. */
export interface DmMessagePage {
  messages: DmMessage[];
  hasMore: boolean;
}

/** A message to send in a direct message. It needs content, an embed or a file. */
export interface SendDMOptions {
  /** Up to 2000 characters. */
  content?: string;
  /** Up to 5 embeds. */
  embeds?: Embed[];
  /** The ID of a message in the same DM to reply to. */
  replyToId?: string;
  /** Your own ID for this send (up to 64 characters). */
  nonce?: string;
  /** Up to 10 files already uploaded for this DM. */
  attachments?: DmAttachment[];
}

export interface EditDMOptions {
  content?: string;
  embeds?: Embed[];
}

export interface GetDMMessagesOptions {
  /** Only messages older than this message ID. */
  before?: string;
  /** 1 to 100 (default 50). */
  limit?: number;
}

// ─── Channel Payloads ───────────────────────────────────────

export interface CreateChannelOptions {
  name: string;
  type?: ChannelType;
  topic?: string;
  categoryId?: string;
  position?: number;
  slowModeSeconds?: number;
  isNsfw?: boolean;
  isPrivate?: boolean;
}

export interface UpdateChannelOptions {
  name?: string;
  topic?: string;
  categoryId?: string | null;
  position?: number;
  slowModeSeconds?: number;
  isNsfw?: boolean;
  isArchived?: boolean;
}

// ─── Role Payloads ──────────────────────────────────────────

export interface CreateRoleOptions {
  name: string;
  /** A hex color such as `#FF5733`. */
  color?: string;
  iconUrl?: string;
  /** An emoji used as the role icon. */
  unicodeEmoji?: string;
  /** A permission bitfield as a string. Only permissions the bot has itself. */
  permissions?: string;
  isMentionable?: boolean;
  /** Show members with this role in their own group in the member list. */
  isHoisted?: boolean;
}

export interface UpdateRoleOptions {
  name?: string;
  /** A hex color such as `#FF5733`. */
  color?: string;
  iconUrl?: string;
  /** An emoji used as the role icon; `null` or `''` removes it. */
  unicodeEmoji?: string | null;
  /** A permission bitfield as a string. Only permissions the bot has itself can be added or taken away. */
  permissions?: string;
  isMentionable?: boolean;
  isHoisted?: boolean;
}

/** A role's new place in `reorderRoles`. Higher is more powerful; 0 is @everyone. */
export interface RolePosition {
  id: string;
  position: number;
}

// ─── Gateway Events ─────────────────────────────────────────
// Payloads received from the WebSocket gateway.

export interface GatewayPayload {
  event: string;
  data: unknown;
}

export interface MessageCreateEvent {
  id: string;
  channelId: string;
  tavernId?: string;
  content: string;
  sender: MessageSender;
  replyToId?: string | null;
  replyTo?: MessageReply | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface MessageEditEvent {
  id: string;
  channelId: string;
  tavernId?: string;
  content: string;
  editedAt: string;
  sender: MessageSender;
}

export interface MessageDeleteEvent {
  messageId: string;
  channelId: string;
  tavernId: string;
}

export interface BulkDeleteEvent {
  channelId: string;
  tavernId: string;
  messageIds: string[];
}

/** A person joining includes the member row. A bot installation includes its application ID. */
export type MemberJoinEvent = {
  tavernId: string;
  user: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    avatarAnimated?: boolean;
  };
} & (
  | { isBot?: false; member: Member }
  | { isBot: true; botApplicationId: string; member?: undefined }
);

export interface MemberLeaveEvent {
  userId: string;
  tavernId: string;
  /** For example `'kicked'`. Left out when they left on their own. */
  reason?: string;
  isBot?: boolean;
}

export interface ChannelCreateEvent {
  id: string;
  name: string;
  type: ChannelType;
  tavernId: string;
  topic?: string | null;
  position: number;
  categoryId?: string | null;
}

export interface ChannelUpdateEvent {
  id: string;
  tavernId: string;
  name?: string;
  topic?: string | null;
  position?: number;
}

export interface ChannelDeleteEvent {
  channelId: string;
  tavernId: string;
}

export interface RoleCreateEvent {
  tavernId: string;
  role: Role;
}

/** The changed role, with its tavern. */
export interface RoleUpdateEvent extends Role {
  tavernId: string;
}

export interface RoleDeleteEvent {
  roleId: string;
  tavernId: string;
}

export interface TavernUpdateEvent {
  id: string;
  name?: string;
  iconUrl?: string | null;
  bannerUrl?: string | null;
  description?: string | null;
}

export interface BotInstalledEvent {
  tavernId: string;
  tavernName: string | null;
  grantedPermissions: string;
}

export interface BotRemovedEvent {
  tavernId: string;
}

/** The tavern changed the permissions it grants the bot. */
export interface BotPermissionsUpdatedEvent {
  tavernId: string;
  grantedPermissions: string;
}

export interface TypingEvent {
  userId: string;
  channelId: string;
  tavernId: string;
  /** Sent when typing starts. */
  displayName?: string;
  isTyping: boolean;
}

export interface MessagePinnedEvent {
  messageId: string;
  channelId: string;
  tavernId: string;
  message?: Message;
}

export interface MessageUnpinnedEvent {
  messageId: string;
  channelId: string;
  tavernId: string;
}

// ─── Bot Commands (Slash Commands) ─────────────────────────

export interface BotCommand {
  id: string;
  name: string;
  description: string;
  options?: CommandOption[];
  defaultMemberPermissions?: string;
  version: number;
}

export interface CommandOption {
  name: string;
  description: string;
  type: CommandOptionType;
  required?: boolean;
  choices?: { name: string; value: string | number }[];
}

// ─── Interactions ──────────────────────────────────────────

export interface Interaction {
  id: string;
  commandName: string;
  tavernId: string;
  channelId: string;
  userId: string;
  options: Record<string, any>;
}

/** An answer to an interaction. It needs content or at least one embed. */
export interface InteractionCallbackData {
  /** Up to 4000 characters. May be left out when `embeds` are given. */
  content?: string;
  /** Only the person who used the command sees it. */
  ephemeral?: boolean;
  /** Up to 5 embeds. */
  embeds?: Embed[];
}

export interface InteractionDeferOptions {
  /** The answer that follows is seen only by the person who used the command. */
  ephemeral?: boolean;
}

// ─── Client Options ─────────────────────────────────────────

export interface ClientOptions {
  /** Bot token (must start with tavbot_) */
  token?: string;
  /** Override the REST API base URL */
  apiUrl?: string;
  /** Override the WebSocket gateway URL */
  wsUrl?: string;
  /**
   * Accept plain http:// and ws:// URLs for apiUrl and wsUrl. The bot token is
   * then sent unencrypted, so use this for local development only. Default: false.
   */
  allowInsecure?: boolean;
  /** Whether to automatically reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Maximum number of reconnect attempts before giving up (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
  /** Gateway intents bitfield (session-level, not persisted to server) */
  intents?: bigint;
  /** Voice options (see `client.voice`). */
  voice?: VoiceOptions;
}

// ─── Client Event Map ───────────────────────────────────────
// Type-safe event map for client.on()

export interface ClientEvents {
  ready: [];
  reconnecting: [attempt: number];
  disconnected: [code: number, reason: string];
  error: [error: Error];
  debug: [message: string];
  /** Without the MESSAGE_CONTENT intent, `content` is empty unless the message mentions the bot. */
  messageCreate: [message: ActionableMessage];
  messageUpdate: [message: MessageEditEvent];
  messageDelete: [event: MessageDeleteEvent];
  messageDeleteBulk: [event: BulkDeleteEvent];
  messagePinned: [event: MessagePinnedEvent];
  messageUnpinned: [event: MessageUnpinnedEvent];
  messagePublished: [message: Message];
  memberJoin: [event: MemberJoinEvent];
  memberLeave: [event: MemberLeaveEvent];
  memberMuted: [event: Record<string, unknown>];
  memberUnmuted: [event: Record<string, unknown>];
  channelCreate: [channel: ChannelCreateEvent];
  channelUpdate: [event: ChannelUpdateEvent];
  channelDelete: [event: ChannelDeleteEvent];
  threadCreate: [channel: Channel];
  threadUpdate: [event: Record<string, unknown>];
  threadDelete: [event: Record<string, unknown>];
  threadArchived: [event: Record<string, unknown>];
  roleCreate: [event: RoleCreateEvent];
  roleUpdate: [role: RoleUpdateEvent];
  roleDelete: [event: RoleDeleteEvent];
  tavernUpdate: [event: TavernUpdateEvent];
  eventCreate: [event: Record<string, unknown>];
  eventUpdate: [event: Record<string, unknown>];
  eventDelete: [event: Record<string, unknown>];
  eventStarting: [event: Record<string, unknown>];
  eventEnded: [event: Record<string, unknown>];
  voiceStateUpdate: [event: Record<string, unknown>];
  typingStart: [event: TypingEvent];
  typingStop: [event: TypingEvent];
  botInstalled: [event: BotInstalledEvent];
  botRemoved: [event: BotRemovedEvent];
  /** The tavern changed the permissions it grants the bot. */
  botPermissionsUpdated: [event: BotPermissionsUpdatedEvent];
  /** The bot's voice connection in a hall ended (also emitted on the connection as `disconnected`). */
  botVoiceDisconnected: [event: { tavernId: string; channelId: string; reason: string }];
  /** The tavern granted or took away Listen in voice halls, or Speak, while the bot is in a hall. */
  botVoiceUpdated: [event: { tavernId: string; channelId: string; listening: boolean; canSpeak: boolean }];
  interactionCreate: [interaction: ActionableInteraction];
  /** A person sent the bot a direct message (needs the DIRECT_MESSAGES intent). */
  dmMessageCreate: [message: ActionableDmMessage];
  /** A person edited a message in a direct message with the bot. */
  dmMessageUpdate: [message: DmMessage];
  /** A person deleted a message in a direct message with the bot. */
  dmMessageDelete: [event: DmMessageDelete];
  raw: [event: string, data: unknown];
}
