import { integer } from "./money";
export function isOwner(userId: number, configuredId: string | undefined): boolean {
  return !!configuredId && /^[1-9]\d*$/.test(configuredId) && Number.isSafeInteger(Number(configuredId)) && userId === Number(configuredId);
}
export function canReserve(input: { consent: boolean; ceilingMicros: number; projectedMicros: number }): boolean {
  const { consent, ceilingMicros, projectedMicros } = input;
  integer(ceilingMicros); integer(projectedMicros);
  return consent && ceilingMicros > 0 && BigInt(projectedMicros) * 10n < BigInt(ceilingMicros) * 9n;
}
