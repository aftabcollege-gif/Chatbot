import * as jalaali from "jalaali-js";

/** Convert a Gregorian Date to Jalali string (e.g. "۱۴۰۳/۱/۱۵") */
export function toJalali(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  const { jy, jm, jd } = jalaali.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return `${jy}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")}`;
}

/** Convert a Gregorian Date to Jalali with Persian digits */
export function toJalaliPersian(date: Date | string | null | undefined): string {
  const str = toJalali(date);
  if (!str) return "";
  return str.replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[parseInt(d)]);
}

/** Format a date as Jalali date + time */
export function toJalaliDateTime(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  const datePart = toJalali(d);
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${datePart} ${hours}:${minutes}`;
}

/** Relative time in Persian (e.g. "۳ ساعت پیش") */
export function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return "لحظاتی پیش";
  if (diffMinutes < 60) return `${diffMinutes} دقیقه پیش`;
  if (diffHours < 24) return `${diffHours} ساعت پیش`;
  if (diffDays < 30) return `${diffDays} روز پیش`;
  return toJalali(d);
}

const MONTH_NAMES_FA = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

/** Format as "۱۵ فروردین ۱۴۰۳" */
export function toJalaliLong(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  const { jy, jm, jd } = jalaali.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return `${jd} ${MONTH_NAMES_FA[jm - 1]} ${jy}`;
}

/** Alias — relative time in Persian (used across admin UI) */
export const getRelativeTime = timeAgo;

/** Alias — full Jalali date + time (used across admin UI) */
export const formatJalaaliDateTime = toJalaliDateTime;
