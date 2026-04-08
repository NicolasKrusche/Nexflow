"""IConnector — base interface for all native connectors."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class ConnectorError(Exception):
    """Raised when a connector operation fails."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class IConnector(ABC):
    """
    Contract that every native connector must satisfy.

    Downstream nodes receive the dict returned by `execute()` merged into
    the existing run state.
    """

    @property
    @abstractmethod
    def provider(self) -> str:
        """Provider slug, e.g. 'gmail'."""

    @property
    @abstractmethod
    def supported_operations(self) -> list[str]:
        """List of operation names this connector handles."""

    @abstractmethod
    async def execute(
        self,
        operation: str,
        params: dict[str, Any],
        access_token: str,
    ) -> dict[str, Any]:
        """
        Execute a named operation.

        Args:
            operation: One of `supported_operations`.
            params: Operation-specific parameters from the node config.
            access_token: Valid OAuth access token (refreshed by caller).

        Returns:
            Dict that will be merged into run state for downstream nodes.

        Raises:
            ConnectorError: on provider API errors or missing required params.
        """
