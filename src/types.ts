/**
 * taverns.js - Type Definitions
 *
 * TypeScript interfaces that mirror the Taverns API responses.
 * All IDs are UUIDs represented as strings.
 */

import { ChannelType, MessageStatus, BotStatus, MemberStatus, CommandOptionType } from './constants';
import type { Embed } from './embed';
import type { VoiceOptions } from './voice';
import type { ActionableDmMessage } from './client';

// ─── Users ──────────────────────────────────────────────────

export interface User {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  bannerUrl?: string | null;
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

// ─── Members ────────────────────────────────────────────────

export interface Member {
  id: string;
  userId: string;
  tavernId: string;
  nickname?: string | null;
  status: MemberStatus;
  user: User;
  roles?: MemberRole[];
  joinedAt?: string;
}

export interface MemberRole {
  id: string;
  name: string;
  color?: string | null;
  iconUrl?: string | null;
  position: number;
}

// ─── Roles ──────────────────────────────────────────────────

export interface Role {
  id: string;
  name: string;
  color?: string | null;
  iconUrl?: string | null;
  isMentionable: boolean;
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

export interface SendMessageOptions {
  content: string;
  replyToId?: string;
  metadata?: Record<string, unknown>;
  embeds?: Embed[];
}

export interface EditMessageOptions {
  content: string;
}

export interface GetMessagesOptions {
  limit?: number;
  before?: string;
  after?: string;
}

export interface SearchMessagesOptions {
  query: string;
  channelId?: string;
  senderId?: string;
  limit?: number;
  offset?: number;
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
  color?: string;
  iconUrl?: string;
  permissions?: string;
  isMentionable?: boolean;
}

export interface UpdateRoleOptions {
  name?: string;
  color?: string;
  iconUrl?: string;
  permissions?: string;
  isMentionable?: boolean;
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
  id: string;
  channelId: string;
  tavernId?: string;
}

export interface BulkDeleteEvent {
  channelId: string;
  tavernId: string;
  messageIds: string[];
  count: number;
}

export interface MemberJoinEvent {
  userId: string;
  tavernId: string;
  displayName: string;
  avatarUrl: string | null;
  isBot?: boolean;
}

export interface MemberLeaveEvent {
  userId: string;
  tavernId: string;
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
  id: string;
  tavernId: string;
}

export interface RoleUpdateEvent {
  id: string;
  tavernId?: string;
  name: string;
  color?: string | null;
  iconUrl?: string | null;
  position: number;
  permissions: string;
  isMentionable: boolean;
}

export interface RoleDeleteEvent {
  id: string;
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
  tavernName: string;
  grantedPermissions: string;
}

export interface BotRemovedEvent {
  tavernId: string;
}

export interface TypingEvent {
  userId: string;
  channelId: string;
  tavernId: string;
  displayName: string;
}

export interface MessagePinnedEvent {
  id: string;
  channelId: string;
  tavernId: string;
}

export interface MessageUnpinnedEvent {
  id: string;
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

export interface InteractionCallbackData {
  content?: string;
  ephemeral?: boolean;
  embeds?: Embed[];
}

// ─── Paginated response ─────────────────────────────────────

export interface PaginatedMessages {
  messages: Message[];
  hasMore: boolean;
  nextCursor?: string;
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
  messageCreate: [message: Message];
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
  /** The bot's voice connection in a hall ended (also emitted on the connection as `disconnected`). */
  botVoiceDisconnected: [event: { tavernId: string; channelId: string; reason: string }];
  /** The tavern granted or took away Listen in voice halls, or Speak, while the bot is in a hall. */
  botVoiceUpdated: [event: { tavernId: string; channelId: string; listening: boolean; canSpeak: boolean }];
  interactionCreate: [interaction: Interaction];
  /** A person sent the bot a direct message (needs the DIRECT_MESSAGES intent). */
  dmMessageCreate: [message: ActionableDmMessage];
  /** A person edited a message in a direct message with the bot. */
  dmMessageUpdate: [message: DmMessage];
  /** A person deleted a message in a direct message with the bot. */
  dmMessageDelete: [event: DmMessageDelete];
  raw: [event: string, data: unknown];
}
