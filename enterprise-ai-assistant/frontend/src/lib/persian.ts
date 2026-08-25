import jalaali from "jalaali-js";

const FA_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

export function toJalali(iso: string | Date | undefined | null): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso + (iso.endsWith("Z") ? "" : "Z")) : iso;
  if (isNaN(d.getTime())) return "";
  const j = jalaali.toJalaali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  return `${j.jd} ${FA_MONTHS[j.jm - 1]} ${j.jy}`;
}

export function toJalaliDateTime(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso + (iso.endsWith("Z") ? "" : "Z"));
  if (isNaN(d.getTime())) return "";
  const j = jalaali.toJalaali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  const time = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return `${j.jd} ${FA_MONTHS[j.jm - 1]} ${j.jy} - ${time}`;
}

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function toPersianDigits(value: number | string): string {
  return String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

export function relativeTime(iso: string | undefined | null): string {
  if (!iso) return "";
  const then = new Date(iso + (iso.endsWith("Z") ? "" : "Z")).getTime();
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "لحظاتی پیش";
  const min = Math.round(sec / 60);
  if (min < 60) return `${toPersianDigits(min)} دقیقه پیش`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${toPersianDigits(hr)} ساعت پیش`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${toPersianDigits(day)} روز پیش`;
  return toJalali(iso);
}
