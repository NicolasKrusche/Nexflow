from .base import IConnector, ConnectorError
from .gmail import GmailConnector
from .notion import NotionConnector
from .slack import SlackConnector
from .github import GitHubConnector
from .sheets import SheetsConnector

REGISTRY: dict[str, type[IConnector]] = {
    "gmail": GmailConnector,
    "notion": NotionConnector,
    "slack": SlackConnector,
    "github": GitHubConnector,
    "sheets": SheetsConnector,
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
    "REGISTRY",
    "get_connector",
]
