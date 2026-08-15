export type ScheduleType = "INTERVAL" | "DAILY" | "WEEKLY" | "MONTHLY";

export type ScheduleRunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";

export interface Schedule {
  id: string;
  agent_id: string;
  schedule_type: ScheduleType;
  interval_minutes: number | null;
  time_of_day: string | null;
  weekdays: number[] | null;
  day_of_month: number | null;
  input_query: string;
  is_active: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  warning: string | null;
}

export interface ScheduleRequest {
  schedule_type: ScheduleType;
  interval_minutes: number | null;
  time_of_day: string | null;
  weekdays: number[] | null;
  day_of_month: number | null;
  input_query: string;
}

export interface ScheduleDeleteResponse {
  message: string;
}

export interface ScheduleRun {
  id: string;
  schedule_id: string;
  scheduled_for: string;
  thread_id: string;
  status: ScheduleRunStatus;
  error_message: string | null;
  created_at: string;
}

export interface ScheduleUpdateRequest {
  is_active?: boolean;
  schedule_type?: ScheduleType;
  interval_minutes?: number | null;
  time_of_day?: string | null;
  weekdays?: number[] | null;
  day_of_month?: number | null;
  input_query?: string;
}
