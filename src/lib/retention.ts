import { REPORT_TTL_DAYS } from "../shared/types";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Reports created before this are expired (R17). */
export const expireBefore = (now: number): number =>
  now - REPORT_TTL_DAYS * DAY_MS;
