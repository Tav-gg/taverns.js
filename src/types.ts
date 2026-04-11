/**
 * taverns.js - Type Definitions
 *
 * TypeScript interfaces that mirror the Taverns API responses.
 * All IDs are UUIDs represented as strings.
 */

import { ChannelType, MessageStatus, BotStatus, MemberStatus, CommandOptionType } from './constants';

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
}

// ─── Message Payloads ───────────────────────────────────────

export interface SendMessageOptions {
  content: string;
  replyToId?: string;
  metadata?: Record<string, unknown>;
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
  content: string;
  ephemeral?: boolean;
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
  /** Whether to automatically reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Maximum number of reconnect attempts before giving up (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
  /** Gateway intents bitfield (session-level, not persisted to server) */
  intents?: bigint;
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
  interactionCreate: [interaction: Interaction];
  raw: [event: string, data: unknown];
}
