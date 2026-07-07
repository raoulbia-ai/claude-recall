/**
 * Numeric CLI option parsing with loud failures.
 *
 * Bare parseInt/parseFloat on user flags produced silent nonsense:
 * `--limit abc` → NaN → `slice(0, NaN)` → zero results with no hint why;
 * `--confidence abc` stored NaN into the database. Invalid input now exits 2
 * with a message naming the flag.
 */

export function parsePositiveInt(
  value: string | number | undefined,
  flagName: string,
  fallback: number,
): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`❌ Invalid --${flagName}: "${value}" (expected a positive integer)`);
    process.exit(2);
  }
  return n;
}

export function parseUnitFloat(
  value: string | number | undefined,
  flagName: string,
  fallback: number,
): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    console.error(`❌ Invalid --${flagName}: "${value}" (expected a number between 0 and 1)`);
    process.exit(2);
  }
  return n;
}
