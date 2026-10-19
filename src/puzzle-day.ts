// LinkedIn releases the next puzzle of every game at midnight Pacific time
// (10:00 in Finland), so that is when "today" starts. A puzzle week runs from
// Saturday's puzzles to Friday's.
const PUZZLE_TIME_ZONE = "America/Los_Angeles";
const DAY_SECONDS = 86_400;
const SATURDAY = 6;

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
  return toUnix(wallMidnight(nowSeconds));
}

export interface PuzzleWeek {
  /** When Saturday's puzzles were released, as unix seconds. */
  start: number;
  /** The puzzle dates of its Saturday and Friday, at midnight UTC: read them with getUTC*. */
  saturday: Date;
  friday: Date;
}

/** The Saturday–Friday week the current puzzles belong to. */
export function puzzleWeek(nowSeconds: number): PuzzleWeek {
  const today = wallMidnight(nowSeconds);
  const daysSinceSaturday = (new Date(today * 1000).getUTCDay() - SATURDAY + 7) % 7;
  const saturday = today - daysSinceSaturday * DAY_SECONDS;
  return {
    start: toUnix(saturday),
    saturday: new Date(saturday * 1000),
    friday: new Date((saturday + 6 * DAY_SECONDS) * 1000),
  };
}

/** Today's Pacific midnight, as wall-clock seconds (see wallClock). */
function wallMidnight(nowSeconds: number): number {
  const wallNow = wallClock(nowSeconds);
  return wallNow - (wallNow % DAY_SECONDS);
}

/** The instant a Pacific wall-clock time happens. */
function toUnix(wallSeconds: number): number {
  // Start from the offset at that wall time read as UTC, then correct it once:
  // the offset differs across the days DST starts or ends.
  const guess = wallSeconds - utcOffset(wallSeconds);
  return wallSeconds - utcOffset(guess);
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
