/** Shapes shared by the per-service sections of the connector cards. */

export interface ServiceSectionValues {
  enabled: boolean;
  intervalMinutes: number;
  lookbackDays: number;
  calendarIds: string[];
}

export interface ServiceTestOutcome {
  ok: boolean;
  account: string;
  error: string;
}

export interface ServiceSyncOutcome {
  created: number;
  deduplicated: number;
  failed: number;
  errorLines: string[];
}

export interface ServiceStatusLine {
  last_run: string;
  last_error: string;
  last_created: number;
}
