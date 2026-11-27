import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Whether the module at `url` (its `import.meta.url`) is the script Node was started with. The
 * services start scripts through the `~/current` symlink, and Node gives a module its real path,
 * so the two are compared after resolving links; a plain comparison never matched and the script
 * did nothing.
 */
export function isMain(url: string): boolean {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
}
