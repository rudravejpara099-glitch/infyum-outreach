export const MICRO = 1000000;
export const CENT = 10000;
export function integer(value: number, signed = false): number {
  if (!Number.isSafeInteger(value) || (!signed && value < 0)) throw new Error("Invalid integer amount");
  return value;
}
export function safe(value: bigint): number { return integer(Number(value), true); }
export function sum(values: number[]): number { return safe(values.reduce((total, value) => total + BigInt(integer(value, true)), 0n)); }
export function roundedRatio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n || numerator < 0n) throw new Error("Invalid ratio");
  return safe((numerator + denominator / 2n) / denominator);
}
export function parseUsd(raw: string): number {
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) throw new Error("Enter a dollar amount with up to six decimal places");
  const [whole, fraction = ""] = raw.split(".");
  return integer(safe(BigInt(whole) * BigInt(MICRO) + BigInt(fraction.padEnd(6, "0"))));
}
export function usd(micros: number, precision = 2): string {
  integer(micros, true);
  if (![2, 4, 6].includes(precision)) throw new Error("Invalid display precision");
  const value = BigInt(micros), absolute = value < 0n ? -value : value;
  const scale = 10n ** BigInt(6 - precision);
  const units = (absolute + scale / 2n) / scale;
  const decimal = 10n ** BigInt(precision);
  return `${value < 0n ? "-" : ""}$${units / decimal}.${String(units % decimal).padStart(precision, "0")}`;
}
export function tokenCostMicros(tokens: number, perMillion: number): number {
  return roundedRatio(BigInt(integer(tokens)) * BigInt(integer(perMillion)), 1000000n);
}
export function monthlyShare(monthlyMicros: number, day: number, days: number): number {
  integer(monthlyMicros); integer(day); integer(days);
  if (days < 28 || days > 31 || day < 1 || day > days) throw new Error("Invalid day");
  const total = BigInt(monthlyMicros), count = BigInt(days), index = BigInt(day);
  return safe(total * index / count - total * (index - 1n) / count);
}
