/**
 * taverns.js - PermissionsBitField
 *
 * Permissions utility for working with Tavern permission
 * bitfields. Permissions are stored as BigInt flags, matching the server-side
 * TavernPermission enum.
 */

/**
 * All Tavern permission flags. Each flag is a bit position (0-35).
 * The actual bitfield value is `1n << BigInt(position)`.
 */
export const PermissionFlags = {
  // General
  VIEW_CHANNELS: 0n,
  MANAGE_CHANNELS: 1n,
  MANAGE_ROLES: 2n,
  MANAGE_TAVERN: 3n,
  CREATE_INVITE: 4n,
  KICK_MEMBERS: 5n,
  BAN_MEMBERS: 6n,
  MANAGE_NICKNAMES: 7n,
  MANAGE_PERMISSIONS: 8n,
  PIN_MESSAGES: 9n,

  // Text
  SEND_MESSAGES: 10n,
  MANAGE_MESSAGES: 11n,
  ATTACH_FILES: 13n,
  ADD_REACTIONS: 14n,
  MENTION_EVERYONE: 15n,
  EMBED_LINKS: 16n,
  READ_MESSAGE_HISTORY: 17n,
  USE_EXTERNAL_EMOJI: 18n,
  USE_EXTERNAL_STICKERS: 19n,

  // Content
  MANAGE_STICKERS: 12n,

  // Moderation
  MUTE_MEMBERS: 20n,
  BYPASS_SLOWMODE: 21n,

  // Voice
  CONNECT_VOICE: 22n,
  SPEAK: 23n,
  MANAGE_VOICE: 24n,
  VIDEO: 25n,

  // Events
  CREATE_EVENTS: 26n,
  MANAGE_EVENTS: 27n,

  // Polls
  CREATE_POLLS: 28n,
  VOTE_IN_POLLS: 29n,

  // Admin
  ADMINISTRATOR: 30n,

  // Threads
  CREATE_PUBLIC_THREADS: 31n,
  CREATE_PRIVATE_THREADS: 32n,
  MANAGE_THREADS: 33n,
  SEND_MESSAGES_IN_THREADS: 34n,

  // Bots
  MANAGE_BOTS: 35n,
} as const;

export type PermissionFlagName = keyof typeof PermissionFlags;

/** All permission flags OR'd together */
const ALL_PERMISSIONS = (Object.values(PermissionFlags) as bigint[]).reduce(
  (acc: bigint, bit: bigint) => acc | (1n << bit),
  0n,
);

/**
 * A bitfield that represents a set of permissions.
 *
 * @example
 * ```ts
 * const perms = new PermissionsBitField('2048'); // from API string
 *
 * if (perms.has('SEND_MESSAGES')) {
 *   // Bot can send messages
 * }
 *
 * const withAdmin = perms.add('ADMINISTRATOR');
 * console.log(withAdmin.toArray()); // ['SEND_MESSAGES', 'ADMINISTRATOR']
 * ```
 */
export class PermissionsBitField {
  /**
   * Static reference to all permission flags.
   * @example PermissionsBitField.FLAGS.SEND_MESSAGES
   */
  static readonly FLAGS = PermissionFlags;

  /** The raw bitfield value. */
  readonly bitfield: bigint;

  /**
   * Create a new PermissionsBitField.
   * @param bits - A BigInt, numeric string, number, or another PermissionsBitField
   */
  constructor(bits?: bigint | string | number | PermissionsBitField) {
    if (bits === undefined || bits === null) {
      this.bitfield = 0n;
    } else if (bits instanceof PermissionsBitField) {
      this.bitfield = bits.bitfield;
    } else if (typeof bits === 'bigint') {
      this.bitfield = bits;
    } else if (typeof bits === 'string') {
      this.bitfield = BigInt(bits);
    } else {
      this.bitfield = BigInt(bits);
    }
  }

  /**
   * Check if this bitfield has a specific permission.
   * @param permission - Permission flag name or bit position
   */
  has(permission: PermissionFlagName | bigint): boolean {
    const flag = this.resolve(permission);
    // ADMINISTRATOR grants everything
    if ((this.bitfield & (1n << PermissionFlags.ADMINISTRATOR)) !== 0n) {
      return true;
    }
    return (this.bitfield & flag) === flag;
  }

  /**
   * Check if this bitfield has any of the specified permissions.
   */
  hasAny(...permissions: (PermissionFlagName | bigint)[]): boolean {
    return permissions.some((p) => this.has(p));
  }

  /**
   * Check if this bitfield has all of the specified permissions.
   */
  hasAll(...permissions: (PermissionFlagName | bigint)[]): boolean {
    return permissions.every((p) => this.has(p));
  }

  /**
   * Return a new PermissionsBitField with the given permission(s) added.
   */
  add(...permissions: (PermissionFlagName | bigint)[]): PermissionsBitField {
    let bits = this.bitfield;
    for (const perm of permissions) {
      bits |= this.resolve(perm);
    }
    return new PermissionsBitField(bits);
  }

  /**
   * Return a new PermissionsBitField with the given permission(s) removed.
   */
  remove(...permissions: (PermissionFlagName | bigint)[]): PermissionsBitField {
    let bits = this.bitfield;
    for (const perm of permissions) {
      bits &= ~this.resolve(perm);
    }
    return new PermissionsBitField(bits);
  }

  /**
   * Return an array of all permission flag names that are set.
   */
  toArray(): PermissionFlagName[] {
    const result: PermissionFlagName[] = [];
    for (const [name, bit] of Object.entries(PermissionFlags)) {
      const flag = 1n << bit;
      if ((this.bitfield & flag) === flag) {
        result.push(name as PermissionFlagName);
      }
    }
    return result;
  }

  /**
   * Serialize to a decimal string (matches API format).
   */
  toString(): string {
    return this.bitfield.toString();
  }

  /**
   * Serialize to JSON as a decimal string.
   */
  toJSON(): string {
    return this.toString();
  }

  /**
   * Check if this bitfield equals another.
   */
  equals(other: PermissionsBitField | bigint | string): boolean {
    const otherBits = other instanceof PermissionsBitField
      ? other.bitfield
      : BigInt(other);
    return this.bitfield === otherBits;
  }

  /**
   * Get a bitfield with all permissions set.
   */
  static all(): PermissionsBitField {
    return new PermissionsBitField(ALL_PERMISSIONS);
  }

  /**
   * Resolve a permission name or bigint to its bitfield flag.
   */
  private resolve(permission: PermissionFlagName | bigint): bigint {
    if (typeof permission === 'bigint') {
      return 1n << permission;
    }
    const bit = PermissionFlags[permission];
    if (bit === undefined) {
      throw new RangeError(`Unknown permission: ${permission}`);
    }
    return 1n << bit;
  }
}
