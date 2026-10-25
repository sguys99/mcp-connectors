"""공통 에러 클래스. ToolError 기반."""

from __future__ import annotations

from fastmcp.exceptions import ToolError


class InvalidInputError(ToolError):
    """INVALID_INPUT 코드 대응."""


class NotFoundError(ToolError):
    """*_NOT_FOUND 코드 대응 (파일/리비전/엔티티 등)."""


class AccessDeniedError(ToolError):
    """ACCESS_DENIED 코드 대응."""


class BackendUnavailableError(ToolError):
    """BACKEND_UNAVAILABLE / *_TIMEOUT 코드 대응."""


class ResponseTooLargeError(ToolError):
    """*_TOO_LARGE 코드 대응."""
