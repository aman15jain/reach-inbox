import { redis } from "../lib/redis";

// Atomically increment the per-sender hourly counter and compare against the
// limit in a single round trip so concurrent workers can never both read
// "under limit" and both send, blowing past the cap (a plain GET-then-INCR
// from Node would race across worker processes/instances).
const CHECK_AND_INCR_LUA = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
if current > tonumber(ARGV[1]) then
  redis.call("DECR", KEYS[1])
  return 0
end
return 1
`;

function hourWindowKey(senderId: string, at: Date): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, "0");
  const d = String(at.getUTCDate()).padStart(2, "0");
  const h = String(at.getUTCHours()).padStart(2, "0");
  return `ratelimit:sender:${senderId}:${y}${m}${d}${h}`;
}

export function startOfNextHour(from: Date): Date {
  const next = new Date(from);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

/**
 * Tries to reserve one send slot for `senderId` in the current UTC hour
 * window. Returns true if under the limit (and reserves the slot), false if
 * the sender is already at/over `hourlyLimit` for this hour.
 */
export async function tryConsumeHourlySlot(senderId: string, hourlyLimit: number, at: Date = new Date()): Promise<boolean> {
  const key = hourWindowKey(senderId, at);
  const result = await redis.eval(CHECK_AND_INCR_LUA, 1, key, hourlyLimit, 60 * 60 * 1000);
  return result === 1;
}

// Slack should notify once per sender per hour window that gets rate
// limited, not once per delayed job, otherwise a burst of 500 emails
// hitting the cap in the same minute would fire 500 Slack messages.
export async function markHourlyLimitNotified(senderId: string, at: Date = new Date()): Promise<boolean> {
  const key = `${hourWindowKey(senderId, at)}:notified`;
  const result = await redis.set(key, "1", "PX", 60 * 60 * 1000, "NX");
  return result === "OK";
}
