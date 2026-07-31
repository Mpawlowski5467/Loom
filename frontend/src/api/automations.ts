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

export interface GitHubBridgeConfig {
  enabled: boolean;
  token_set: boolean;
  repos: string[];
  interval_minutes: number;
  lookback_hours: number;
  include_commits: boolean;
  include_issues: boolean;
  include_pull_requests: boolean;
}

export interface GitHubBridgeStatus {
  running: boolean;
  last_run: string;
  last_error: string;
  last_created: number;
}

export interface GitHubAutomation {
  github: GitHubBridgeConfig;
  status: GitHubBridgeStatus;
}

export interface GitHubAutomationUpdate {
  enabled?: boolean;
  token?: string;
  clear_token?: boolean;
  repos?: string[];
  interval_minutes?: number;
  lookback_hours?: number;
  include_commits?: boolean;
  include_issues?: boolean;
  include_pull_requests?: boolean;
}

export interface GitHubRepoTestResult {
  repo: string;
  ok: boolean;
  private: boolean;
  description: string;
  default_branch: string;
  pushed_at: string;
  error: string;
}

export interface GitHubTestResult {
  repos: GitHubRepoTestResult[];
}

export interface GitHubRepoSyncResult {
  repo: string;
  fetched: number;
  created: number;
  deduplicated: number;
  error: string;
}

export interface GitHubSyncResult {
  synced_at: string;
  repos: GitHubRepoSyncResult[];
  created: number;
  deduplicated: number;
  errors: number;
}

export interface EmailBridgeConfig {
  enabled: boolean;
  host: string;
  port: number;
  use_ssl: boolean;
  username: string;
  password_set: boolean;
  folder: string;
  interval_minutes: number;
  lookback_hours: number;
  max_messages_per_poll: number;
}

export interface EmailBridgeStatus {
  running: boolean;
  last_run: string;
  last_error: string;
  last_created: number;
}

export interface EmailAutomation {
  email: EmailBridgeConfig;
  status: EmailBridgeStatus;
}

export interface EmailAutomationUpdate {
  enabled?: boolean;
  host?: string;
  port?: number;
  use_ssl?: boolean;
  username?: string;
  password?: string;
  clear_password?: boolean;
  folder?: string;
  interval_minutes?: number;
  lookback_hours?: number;
  max_messages_per_poll?: number;
}

export interface EmailTestResult {
  ok: boolean;
  folder: string;
  messages: number;
  error: string;
}

export interface EmailSyncResult {
  synced_at: string;
  folder: string;
  fetched: number;
  created: number;
  deduplicated: number;
  capture_ids: string[];
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

export function getGitHubAutomation(
  signal?: AbortSignal,
): Promise<GitHubAutomation> {
  return apiClient.get<GitHubAutomation>("/api/automations/github", signal);
}

export function updateGitHubAutomation(
  update: GitHubAutomationUpdate,
): Promise<GitHubAutomation> {
  return apiClient.patch<GitHubAutomation>("/api/automations/github", update);
}

export function testGitHub(signal?: AbortSignal): Promise<GitHubTestResult> {
  return apiClient.post<GitHubTestResult>(
    "/api/automations/github/test",
    {},
    signal,
    AUTOMATION_RUN_TIMEOUT_MS,
  );
}

export function syncGitHub(signal?: AbortSignal): Promise<GitHubSyncResult> {
  return apiClient.post<GitHubSyncResult>(
    "/api/automations/github/sync",
    {},
    signal,
    AUTOMATION_RUN_TIMEOUT_MS,
  );
}

export function getEmailAutomation(
  signal?: AbortSignal,
): Promise<EmailAutomation> {
  return apiClient.get<EmailAutomation>("/api/automations/email", signal);
}

export function updateEmailAutomation(
  update: EmailAutomationUpdate,
): Promise<EmailAutomation> {
  return apiClient.patch<EmailAutomation>("/api/automations/email", update);
}

export function testEmail(signal?: AbortSignal): Promise<EmailTestResult> {
  return apiClient.post<EmailTestResult>(
    "/api/automations/email/test",
    {},
    signal,
    AUTOMATION_RUN_TIMEOUT_MS,
  );
}

export function syncEmail(signal?: AbortSignal): Promise<EmailSyncResult> {
  return apiClient.post<EmailSyncResult>(
    "/api/automations/email/sync",
    {},
    signal,
    AUTOMATION_RUN_TIMEOUT_MS,
  );
}

export interface OAuthCalendarConfig {
  enabled: boolean;
  client_id: string;
  client_secret_set: boolean;
  interval_minutes: number;
  lookback_days: number;
  calendar_ids: string[];
}

export interface OAuthCalendarConnection {
  connected: boolean;
  account: string;
}

export interface OAuthCalendarStatus {
  running: boolean;
  last_run: string;
  last_error: string;
  last_created: number;
}

export interface GoogleServiceConfig {
  enabled: boolean;
  interval_minutes: number;
  lookback_days: number;
}

export interface GoogleCalendarServiceConfig extends GoogleServiceConfig {
  calendar_ids: string[];
}

export interface GoogleConnectorConfig {
  client_id: string;
  client_secret_set: boolean;
  calendar: GoogleCalendarServiceConfig;
  gmail: GoogleServiceConfig;
}

export interface GoogleConnectorAutomation {
  google: GoogleConnectorConfig;
  connection: OAuthCalendarConnection;
  services: {
    calendar: OAuthCalendarStatus;
    gmail: OAuthCalendarStatus;
  };
}

export interface GoogleServiceUpdate {
  enabled?: boolean;
  interval_minutes?: number;
  lookback_days?: number;
}

export interface GoogleCalendarServiceUpdate extends GoogleServiceUpdate {
  calendar_ids?: string[];
}

export interface GoogleConnectorUpdate {
  client_id?: string;
  client_secret?: string;
  clear_client_secret?: boolean;
  calendar?: GoogleCalendarServiceUpdate;
  gmail?: GoogleServiceUpdate;
}

export interface GoogleServiceTestResult {
  ok: boolean;
  account: string;
  error: string;
}

export interface GoogleTestResult {
  calendar: GoogleServiceTestResult;
  gmail: GoogleServiceTestResult;
}

export interface OutlookCalendarAutomation {
  outlook: OAuthCalendarConfig;
  connection: OAuthCalendarConnection;
  status: OAuthCalendarStatus;
}

export interface OAuthCalendarUpdate {
  enabled?: boolean;
  client_id?: string;
  client_secret?: string;
  clear_client_secret?: boolean;
  interval_minutes?: number;
  lookback_days?: number;
  calendar_ids?: string[];
}

export interface OAuthCalendarConnectResult {
  authorization_url: string;
  expires_in: number;
}

export interface OAuthCalendarTestResult {
  ok: boolean;
  account: string;
  error: string;
}

export interface OAuthCalendarSliceResult {
  calendar: string;
  fetched: number;
  created: number;
  deduplicated: number;
  error: string;
}

export interface OAuthCalendarSyncResult {
  synced_at: string;
  calendars: OAuthCalendarSliceResult[];
  created: number;
  deduplicated: number;
  errors: number;
}

export interface GmailSyncResult {
  synced_at: string;
  fetched: number;
  created: number;
  deduplicated: number;
  errors: number;
  capture_ids: string[];
}

export function getGoogleConnector(
  signal?: AbortSignal,
): Promise<GoogleConnectorAutomation> {
  return apiClient.get<GoogleConnectorAutomation>(
    "/api/automations/google",
    signal,
  );
}

export function updateGoogleConnector(
  update: GoogleConnectorUpdate,
): Promise<GoogleConnectorAutomation> {
  return apiClient.patch<GoogleConnectorAutomation>(
    "/api/automations/google",
    update,
  );
}

export function connectGoogle(): Promise<OAuthCalendarConnectResult> {
  return apiClient.post<OAuthCalendarConnectResult>(
    "/api/automations/google/connect",
  );
}

export function disconnectGoogle(): Promise<GoogleConnectorAutomation> {
  return apiClient.post<GoogleConnectorAutomation>(
    "/api/automations/google/disconnect",
  );
}

export function testGoogle(signal?: AbortSignal): Promise<GoogleTestResult> {
  return apiClient.post<GoogleTestResult>(
    "/api/automations/google/test",
    {},
    signal,
    AUTOMATION_RUN_TIMEOUT_MS,
  );
}

export function syncGoogleCalendar(
  signal?: AbortSignal,
): Promise<OAuthCalendarSyncResult> {
  return apiClient.post<OAuthCalendarSyncResult>(
    "/api/automations/google/sync/calendar",
    {},
    signal,
    AUTOMATION_RUN_TIMEOUT_MS,
  );
}

export function syncGmail(signal?: AbortSignal): Promise<GmailSyncResult> {
  return apiClient.post<GmailSyncResult>(
    "/api/automations/google/sync/gmail",
    {},
    signal,
    AUTOMATION_RUN_TIMEOUT_MS,
  );
}

export function getOutlookCalendarAutomation(
  signal?: AbortSignal,
): Promise<OutlookCalendarAutomation> {
  return apiClient.get<OutlookCalendarAutomation>(
    "/api/automations/calendar/outlook",
    signal,
  );
}

export function updateOutlookCalendarAutomation(
  update: OAuthCalendarUpdate,
): Promise<OutlookCalendarAutomation> {
  return apiClient.patch<OutlookCalendarAutomation>(
    "/api/automations/calendar/outlook",
    update,
  );
}

export function connectOutlookCalendar(): Promise<OAuthCalendarConnectResult> {
  return apiClient.post<OAuthCalendarConnectResult>(
    "/api/automations/calendar/outlook/connect",
  );
}

export function disconnectOutlookCalendar(): Promise<OutlookCalendarAutomation> {
  return apiClient.post<OutlookCalendarAutomation>(
    "/api/automations/calendar/outlook/disconnect",
  );
}

export function testOutlookCalendar(
  signal?: AbortSignal,
): Promise<OAuthCalendarTestResult> {
  return apiClient.post<OAuthCalendarTestResult>(
    "/api/automations/calendar/outlook/test",
    {},
    signal,
    AUTOMATION_RUN_TIMEOUT_MS,
  );
}

export function syncOutlookCalendar(
  signal?: AbortSignal,
): Promise<OAuthCalendarSyncResult> {
  return apiClient.post<OAuthCalendarSyncResult>(
    "/api/automations/calendar/outlook/sync",
    {},
    signal,
    AUTOMATION_RUN_TIMEOUT_MS,
  );
}
