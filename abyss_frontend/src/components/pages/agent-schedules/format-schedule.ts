import type { Schedule } from "@/types";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatScheduleFrequency(schedule: Schedule): string {
  switch (schedule.schedule_type) {
    case "INTERVAL":
      return `Every ${schedule.interval_minutes} min`;
    case "DAILY":
      return `Daily at ${schedule.time_of_day}`;
    case "WEEKLY": {
      const days = (schedule.weekdays ?? [])
        .slice()
        .sort((a, b) => a - b)
        .map((day) => WEEKDAY_LABELS[day])
        .join(", ");
      return `Weekly on ${days || "—"} at ${schedule.time_of_day}`;
    }
    case "MONTHLY":
      return `Monthly on day ${schedule.day_of_month} at ${schedule.time_of_day}`;
    default:
      return "—";
  }
}
