import { apiClient } from "./client";

const AUTOMATION_RUN_TIMEOUT_MS = 120_000;

export interface StandupScheduleConfig {
  enabled: boolean;
  run_time: string;
  timezone: string;
}

export interface CalendarBridgeConfig {
  enabled: boolean;
  feed_url_set: boolean;
  name: string;
  include_in_standup: boolean;
  create_captures: boolean;
}

export interface StandupScheduleState {
  scheduled_date: string;
  attempts: number;
  last_attempt_at: string;
  last_success_date: string;
  last_success_at: string;
  last_error: string;
  last_capture_id: string;
  last_capture_path: string;
}

export interface StandupAutomation {
  schedule: StandupScheduleConfig;
  calendar: CalendarBridgeConfig;
  status: {
    running: boolean;
    paused: boolean;
    next_run_at: string;
    state: StandupScheduleState;
  };
}

export interface StandupAutomationUpdate {
  schedule?: Partial<StandupScheduleConfig>;
  calendar?: Partial<
    Omit<CalendarBridgeConfig, "feed_url_set"> & {
      feed_url: string;
      clear_feed_url: boolean;
    }
  >;
}

export interface CalendarEventPreview {
  external_id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location: string;
}

export interface CalendarTestResult {
  date: string;
  event_count: number;
  events: CalendarEventPreview[];
}

export interface CalendarSyncResult {
  date: string;
  event_count: number;
  created: number;
  deduplicated: number;
  capture_ids: string[];
}

export interface StandupResult {
  recap: string;
  date: string;
  notes_modified: number;
  calendar_events: number;
  calendar_error: string;
  capture_id: string;
  capture_path: string;
}

export function getStandupAutomation(
  signal?: AbortSignal,
): Promise<StandupAutomation> {
  return apiClient.get<StandupAutomation>("/api/automations/standup", signal);
}

export function updateStandupAutomation(
  update: StandupAutomationUpdate,
): Promise<StandupAutomation> {
  return apiClient.patch<StandupAutomation>("/api/automations/standup", update);
}

export function testCalendar(
  date = "",
  signal?: AbortSignal,
): Promise<CalendarTestResult> {
  return apiClient.post<CalendarTestResult>(
    "/api/automations/calendar/test",
    { date },
    signal,
    AUTOMATION_RUN_TIMEOUT_MS,
  );
}

export function syncCalendar(
  date = "",
  signal?: AbortSignal,
): Promise<CalendarSyncResult> {
  return apiClient.post<CalendarSyncResult>(
    "/api/automations/calendar/sync",
    { date },
    signal,
    AUTOMATION_RUN_TIMEOUT_MS,
  );
}

export function generateStandup(
  date = "",
  signal?: AbortSignal,
): Promise<StandupResult> {
  return apiClient.post<StandupResult>(
    "/api/agents/standup/generate",
    { date },
    signal,
    AUTOMATION_RUN_TIMEOUT_MS,
  );
}
