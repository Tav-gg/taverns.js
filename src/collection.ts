/**
 * taverns.js - Collection
 *
 * A utility class that extends Map with convenience methods,
 * with convenience methods for working with cached data.
 */

export class Collection<K, V> extends Map<K, V> {
  /**
   * Find the first value that satisfies the predicate.
   */
  find(fn: (value: V, key: K, collection: this) => boolean): V | undefined {
    for (const [key, value] of this) {
      if (fn(value, key, this)) return value;
    }
    return undefined;
  }

  /**
   * Filter the collection and return a new Collection with matching entries.
   */
  filter(fn: (value: V, key: K, collection: this) => boolean): Collection<K, V> {
    const result = new Collection<K, V>();
    for (const [key, value] of this) {
      if (fn(value, key, this)) result.set(key, value);
    }
    return result;
  }

  /**
   * Map each value in the collection to a new value.
   */
  map<T>(fn: (value: V, key: K, collection: this) => T): T[] {
    const result: T[] = [];
    for (const [key, value] of this) {
      result.push(fn(value, key, this));
    }
    return result;
  }

  /**
   * Check if any value satisfies the predicate.
   */
  some(fn: (value: V, key: K, collection: this) => boolean): boolean {
    for (const [key, value] of this) {
      if (fn(value, key, this)) return true;
    }
    return false;
  }

  /**
   * Check if every value satisfies the predicate.
   */
  every(fn: (value: V, key: K, collection: this) => boolean): boolean {
    for (const [key, value] of this) {
      if (!fn(value, key, this)) return false;
    }
    return true;
  }

  /**
   * Reduce the collection to a single value.
   */
  reduce<T>(fn: (accumulator: T, value: V, key: K, collection: this) => T, initialValue: T): T {
    let accumulator = initialValue;
    for (const [key, value] of this) {
      accumulator = fn(accumulator, value, key, this);
    }
    return accumulator;
  }

  /**
   * Get the first value(s) in the collection.
   */
  first(): V | undefined;
  first(count: number): V[];
  first(count?: number): V | V[] | undefined {
    if (count === undefined) {
      const iter = this.values();
      return iter.next().value;
    }
    if (count < 0) return this.last(count * -1);
    count = Math.min(this.size, count);
    const result: V[] = [];
    const iter = this.values();
    for (let i = 0; i < count; i++) {
      const next = iter.next();
      if (next.done) break;
      result.push(next.value);
    }
    return result;
  }

  /**
   * Get the last value(s) in the collection.
   */
  last(): V | undefined;
  last(count: number): V[];
  last(count?: number): V | V[] | undefined {
    const arr = [...this.values()];
    if (count === undefined) return arr[arr.length - 1];
    if (count < 0) return this.first(count * -1);
    if (!count) return [];
    return arr.slice(-count);
  }

  /**
   * Get a random value from the collection.
   */
  random(): V | undefined;
  random(count: number): V[];
  random(count?: number): V | V[] | undefined {
    const arr = [...this.values()];
    if (count === undefined) {
      return arr[Math.floor(Math.random() * arr.length)];
    }
    return Array.from({ length: Math.min(count, arr.length) }, () => {
      const index = Math.floor(Math.random() * arr.length);
      return arr.splice(index, 1)[0];
    });
  }

  /**
   * Return an array of all values in the collection.
   */
  toArray(): V[] {
    return [...this.values()];
  }

  /**
   * Return an array of all keys in the collection.
   */
  keyArray(): K[] {
    return [...this.keys()];
  }

  /**
   * Sort the collection by a comparator and return a new Collection.
   */
  sort(compareFn: (a: V, b: V, aKey: K, bKey: K) => number = () => 0): Collection<K, V> {
    const entries = [...this.entries()].sort((a, b) => compareFn(a[1], b[1], a[0], b[0]));
    const sorted = new Collection<K, V>();
    for (const [key, value] of entries) {
      sorted.set(key, value);
    }
    return sorted;
  }

  /**
   * Create a Collection from an array using a key extractor.
   */
  static from<K, V>(items: V[], keyFn: (item: V) => K): Collection<K, V> {
    const collection = new Collection<K, V>();
    for (const item of items) {
      collection.set(keyFn(item), item);
    }
    return collection;
  }
}
