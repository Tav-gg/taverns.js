/**
 * taverns.js - SDK for building Tavern bots
 *
 * SDK for building bots on the Taverns platform.
 *
 * @example
 * ```ts
 * import { Client, PermissionsBitField } from 'taverns.js';
 *
 * const client = new Client({ token: 'tavbot_...' });
 *
 * client.on('ready', () => {
 *   console.log(`Logged in as ${client.user.displayName}`);
 * });
 *
 * client.on('messageCreate', (message) => {
 *   if (message.content === '!ping') {
 *     message.reply('Pong!');
 *   }
 * });
 *
 * client.login();
 * ```
 */

export { Client } from './client';
export type { ActionableMessage, ActionableInteraction, ActionableDmMessage } from './client';
export { PermissionsBitField, PermissionFlags } from './permissions';
export type { PermissionFlagName } from './permissions';
export { Collection } from './collection';
export { RESTClient, TavernAPIError, RateLimitError } from './rest';
export { Gateway } from './gateway';
export type { GatewayOptions } from './gateway';
export * from './types';
export * from './constants';
export { verifyWebhookSignature } from './webhook';
export { EmbedBuilder } from './embed';
export { VoiceManager, VoiceConnection, VOICE_SAMPLE_RATE } from './voice';
export type {
  VoiceJoinResponse,
  VoiceDisconnectReason,
  VoiceOptions,
  PlayOptions,
  PlayPcmOptions,
  PlaybackResult,
  VoiceAudioFrame,
  VoiceAudioSource,
  VoiceSpeakingEvent,
  VoiceConnectionEvents,
} from './voice';
export type { Embed, EmbedField, EmbedFooter, EmbedImage } from './embed';
