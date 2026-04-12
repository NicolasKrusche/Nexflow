from .base import IConnector, ConnectorError
from .gmail import GmailConnector
from .notion import NotionConnector
from .slack import SlackConnector
from .github import GitHubConnector
from .sheets import SheetsConnector
from .calendar import CalendarConnector
from .docs import DocsConnector
from .drive import DriveConnector
from .airtable import AirtableConnector
from .hubspot import HubSpotConnector
from .asana import AsanaConnector
from .typeform import TypeformConnector
from .outlook import OutlookConnector

REGISTRY: dict[str, type[IConnector]] = {
    "gmail": GmailConnector,
    "notion": NotionConnector,
    "slack": SlackConnector,
    "github": GitHubConnector,
    "sheets": SheetsConnector,
    "calendar": CalendarConnector,
    "docs": DocsConnector,
    "drive": DriveConnector,
    "airtable": AirtableConnector,
    "hubspot": HubSpotConnector,
    "asana": AsanaConnector,
    "typeform": TypeformConnector,
    "outlook": OutlookConnector,
}


def get_connector(provider: str) -> IConnector | None:
    cls = REGISTRY.get(provider)
    return cls() if cls else None


__all__ = [
    "IConnector",
    "ConnectorError",
    "GmailConnector",
    "NotionConnector",
    "SlackConnector",
    "GitHubConnector",
    "SheetsConnector",
    "CalendarConnector",
    "DocsConnector",
    "DriveConnector",
    "AirtableConnector",
    "HubSpotConnector",
    "AsanaConnector",
    "TypeformConnector",
    "OutlookConnector",
    "REGISTRY",
    "get_connector",
]
