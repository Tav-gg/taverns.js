/**
 * taverns.js - Embed Types & Builder
 *
 * Types and a fluent builder for creating rich embed content
 * in messages and interaction replies.
 */

export interface EmbedImage {
  url: string;
  width?: number;
  height?: number;
}

export interface EmbedFooter {
  text: string;
  iconUrl?: string;
}

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Embed {
  title?: string;
  description?: string;
  color?: string;
  fields?: EmbedField[];
  footer?: EmbedFooter;
  thumbnail?: EmbedImage;
  image?: EmbedImage;
}

export class EmbedBuilder {
  private readonly data: Embed = {};

  setTitle(title: string): this { this.data.title = title; return this; }
  setDescription(description: string): this { this.data.description = description; return this; }
  setColor(hex: string): this { this.data.color = hex; return this; }
  addField(name: string, value: string, inline = false): this {
    (this.data.fields ??= []).push({ name, value, inline });
    return this;
  }
  setFooter(text: string, iconUrl?: string): this {
    this.data.footer = { text, iconUrl };
    return this;
  }
  setThumbnail(url: string): this { this.data.thumbnail = { url }; return this; }
  setImage(url: string): this { this.data.image = { url }; return this; }
  toJSON(): Embed { return { ...this.data }; }
}
