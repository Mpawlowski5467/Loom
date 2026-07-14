"""Read-only adapters that bring external information into Loom captures."""

from bridge.calendar import CalendarEvent, CalendarFeedError

__all__ = ["CalendarEvent", "CalendarFeedError"]
