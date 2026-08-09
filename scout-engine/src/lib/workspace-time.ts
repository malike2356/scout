export function localHourFromTimestamp(isoTimestamp: string, timezone = 'UTC'): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    hour12: false,
    timeZone: timezone,
  }).formatToParts(new Date(isoTimestamp));
  const hourPart = parts.find((part) => part.type === 'hour')?.value ?? '0';
  return Number.parseInt(hourPart, 10);
}

export function isDangerousLocalHour(
  hour: number,
  startHour = 22,
  endHour = 5,
): boolean {
  if (startHour === endHour) return false;
  if (startHour < endHour) {
    return hour >= startHour && hour <= endHour;
  }
  return hour >= startHour || hour <= endHour;
}
