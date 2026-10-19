// LinkedIn releases the next puzzle of every game at midnight Pacific time
// (10:00 in Finland), so that is when "today" starts.
const PUZZLE_TIME_ZONE = "America/Los_Angeles";
const DAY_SECONDS = 86_400;

const wallClockFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: PUZZLE_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** When the current puzzles were released, as unix seconds. */
export function puzzleDayStart(nowSeconds: number): number {
  const wallNow = wallClock(nowSeconds);
  const wallMidnight = wallNow - (wallNow % DAY_SECONDS);
  // Midnight's UTC offset can differ from now's on the days DST starts or ends.
  const guess = wallMidnight - utcOffset(nowSeconds);
  return wallMidnight - utcOffset(guess);
}

function utcOffset(unixSeconds: number): number {
  return wallClock(unixSeconds) - unixSeconds;
}

/** Pacific wall-clock time at the given instant, counted in seconds as if it were UTC. */
function wallClock(unixSeconds: number): number {
  const parts = Object.fromEntries(
    wallClockFormat.formatToParts(new Date(unixSeconds * 1000)).map(({ type, value }) => [type, Number(value)]),
  );
  return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!) / 1000;
}
