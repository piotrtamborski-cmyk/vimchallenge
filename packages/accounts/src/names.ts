/** Player names and email addresses: what is accepted, and how they are normalised. */
import { randomInt } from 'node:crypto';

export const NAME_MIN = 3;
export const NAME_MAX = 24;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** A name others will see: 3 to 24 letters, digits, `-` or `_`, starting with a letter or digit. */
export function validName(name: string): boolean {
  return name.length >= NAME_MIN && name.length <= NAME_MAX && NAME.test(name);
}

/** A name built from a provider's user name (a GitHub login), or undefined if none fits. */
export function nameFrom(login: string | undefined): string | undefined {
  const name = login?.replace(/[^A-Za-z0-9_-]/g, '').replace(/^[-_]+/, '').slice(0, NAME_MAX);
  return name && validName(name) ? name : undefined;
}

/** A fresh name for a new account: `vimmer-` and four digits. */
export const randomName = (): string => `vimmer-${String(randomInt(10_000)).padStart(4, '0')}`;

/** A variant of a taken name: a dash and digits, kept within the length limit. */
export function variant(name: string): string {
  const suffix = `-${randomInt(100, 10_000)}`;
  return name.slice(0, NAME_MAX - suffix.length) + suffix;
}

/** The address in lower case, or undefined when it does not look like one. */
export function normalEmail(email: string): string | undefined {
  const e = email.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(e) ? e : undefined;
}
