"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import {
  Button,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  FormError,
  Input,
  Label,
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Schedule, ScheduleRequest, ScheduleType } from "@/types";

const SCHEDULE_TYPES: { value: ScheduleType; label: string }[] = [
  { value: "INTERVAL", label: "Interval" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
];

const WEEKDAY_OPTIONS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

const INTERVAL_MINUTE_OPTIONS = [15, 30, 45, 60];

const scheduleSchema = z
  .object({
    schedule_type: z.enum(["INTERVAL", "DAILY", "WEEKLY", "MONTHLY"]),
    time_of_day: z.string().optional(),
    day_of_month: z.number().int().min(1).max(31).optional(),
    input_query: z.string().trim(),
  })
  .superRefine((values, ctx) => {
    if (values.schedule_type !== "INTERVAL" && !values.time_of_day) {
      ctx.addIssue({ code: "custom", path: ["time_of_day"], message: "Select a time" });
    }
    if (values.schedule_type === "MONTHLY" && !values.day_of_month) {
      ctx.addIssue({
        code: "custom",
        path: ["day_of_month"],
        message: "Select a day of month",
      });
    }
  });

type ScheduleFieldValues = z.infer<typeof scheduleSchema>;

interface ScheduleFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule?: Schedule | null;
  onSubmit: (payload: ScheduleRequest) => void;
  isSubmitting?: boolean;
}

export function ScheduleFormDrawer({
  open,
  onOpenChange,
  schedule,
  onSubmit,
  isSubmitting = false,
}: ScheduleFormDrawerProps) {
  const isEditing = !!schedule;
  const [scheduleType, setScheduleType] = useState<ScheduleType>("DAILY");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [weekdaysError, setWeekdaysError] = useState<string | undefined>(undefined);
  const [intervalMinutes, setIntervalMinutes] = useState<number | undefined>(undefined);
  const [intervalMinutesError, setIntervalMinutesError] = useState<string | undefined>(
    undefined,
  );
  const [seededKey, setSeededKey] = useState<string | null>(null);
  const openKey = open ? (schedule?.id ?? "__new__") : null;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    control,
    formState: { errors },
  } = useForm<ScheduleFieldValues>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: { schedule_type: "DAILY", input_query: "" },
    mode: "onChange",
  });

  const timeOfDay = useWatch({ control, name: "time_of_day" });
  const dayOfMonth = useWatch({ control, name: "day_of_month" });
  // Computed directly from the currently watched values (mirroring the schema's own
  // superRefine rules) instead of trusting formState.isValid — RHF's cross-field validity
  // doesn't reliably re-settle after switching schedule_type away from a type whose
  // now-hidden field (e.g. MONTHLY's day_of_month) previously held an error.
  const isFrequencyValid =
    (scheduleType === "INTERVAL" || !!timeOfDay) &&
    (scheduleType !== "MONTHLY" || (dayOfMonth != null && dayOfMonth >= 1 && dayOfMonth <= 31));

  if (open && openKey !== seededKey) {
    setSeededKey(openKey);
    setScheduleType(schedule?.schedule_type ?? "DAILY");
    setWeekdays(schedule?.weekdays ?? []);
    setWeekdaysError(undefined);
    setIntervalMinutes(schedule?.interval_minutes ?? undefined);
    setIntervalMinutesError(undefined);
    reset({
      schedule_type: schedule?.schedule_type ?? "DAILY",
      time_of_day: schedule?.time_of_day ?? undefined,
      day_of_month: schedule?.day_of_month ?? undefined,
      input_query: schedule?.input_query ?? "",
    });
  } else if (!open && seededKey !== null) {
    setSeededKey(null);
  }

  const handleTypeChange = (type: ScheduleType) => {
    setScheduleType(type);
    setValue("schedule_type", type);
  };

  const toggleWeekday = (day: number) => {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((value) => value !== day) : [...prev, day],
    );
    setWeekdaysError(undefined);
  };

  const handleIntervalMinutesChange = (minutes: number) => {
    setIntervalMinutes(minutes);
    setIntervalMinutesError(undefined);
  };

  const submit = (values: ScheduleFieldValues) => {
    if (values.schedule_type === "WEEKLY" && weekdays.length === 0) {
      setWeekdaysError("Select at least one day");
      return;
    }
    if (values.schedule_type === "INTERVAL" && !intervalMinutes) {
      setIntervalMinutesError("Select an interval");
      return;
    }

    onSubmit({
      schedule_type: values.schedule_type,
      interval_minutes: values.schedule_type === "INTERVAL" ? intervalMinutes! : null,
      time_of_day: values.schedule_type === "INTERVAL" ? null : values.time_of_day!,
      weekdays: values.schedule_type === "WEEKLY" ? weekdays : null,
      day_of_month: values.schedule_type === "MONTHLY" ? values.day_of_month! : null,
      input_query: values.input_query,
    });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="sm:max-w-md">
        <DrawerHeader>
          <DrawerTitle>{isEditing ? "Edit schedule" : "New schedule"}</DrawerTitle>
          <DrawerDescription>
            Run this agent automatically on a recurring cadence.
          </DrawerDescription>
        </DrawerHeader>

        <form
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4"
          onSubmit={handleSubmit(submit)}
        >
          <div className="flex flex-col gap-1.5">
            <Label>Frequency</Label>
            <div className="inline-flex w-fit rounded-lg border border-border p-1">
              {SCHEDULE_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => handleTypeChange(type.value)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors",
                    scheduleType === type.value && "bg-accent font-medium text-foreground",
                  )}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {scheduleType === "INTERVAL" && (
            <div className="flex flex-col gap-1.5">
              <Label>Every</Label>
              <div className="inline-flex w-fit rounded-lg border border-border p-1">
                {INTERVAL_MINUTE_OPTIONS.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => handleIntervalMinutesChange(minutes)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors",
                      intervalMinutes === minutes && "bg-accent font-medium text-foreground",
                    )}
                  >
                    {minutes} min
                  </button>
                ))}
              </div>
              <FormError message={intervalMinutesError} />
            </div>
          )}

          {scheduleType !== "INTERVAL" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="time_of_day">Time of day</Label>
              <Input id="time_of_day" type="time" {...register("time_of_day")} />
              <FormError message={errors.time_of_day?.message} />
            </div>
          )}

          {scheduleType === "WEEKLY" && (
            <div className="flex flex-col gap-1.5">
              <Label>Days of week</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_OPTIONS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleWeekday(day.value)}
                    className={cn(
                      "rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors",
                      weekdays.includes(day.value) &&
                        "border-primary bg-primary/10 font-medium text-primary",
                    )}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
              <FormError message={weekdaysError} />
            </div>
          )}

          {scheduleType === "MONTHLY" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="day_of_month">Day of month</Label>
              <Input
                id="day_of_month"
                type="number"
                min={1}
                max={31}
                placeholder="1"
                {...register("day_of_month", { valueAsNumber: true })}
              />
              <FormError message={errors.day_of_month?.message} />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="input_query">Prompt (optional)</Label>
            <Textarea
              id="input_query"
              rows={6}
              placeholder="What should the agent do on each run?"
              {...register("input_query")}
            />
            <FormError message={errors.input_query?.message} />
          </div>

          <Button
            type="submit"
            disabled={!isFrequencyValid}
            loading={isSubmitting}
            className="mt-2"
          >
            {isEditing ? "Save changes" : "Create schedule"}
          </Button>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
