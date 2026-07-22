"""Exceptions for the local SIFT-style structured extraction engine."""

from __future__ import annotations


class SiftError(Exception):
    """Base class for extraction errors."""

    def __init__(self, message: str, context: dict | None = None):
        self.context = context or {}
        super().__init__(message)


class ProviderError(SiftError):
    """Base class for AI provider errors."""

    def __init__(self, message: str, provider: str = "", model: str = "", context: dict | None = None):
        ctx = {"provider": provider, "model": model}
        if context:
            ctx.update(context)
        super().__init__(message, context=ctx)


class ProviderAuthError(ProviderError):
    """Raised when the API key is missing or invalid."""


class ProviderQuotaError(ProviderError):
    """Raised when the provider quota/rate limit is exceeded."""


class ProviderModelError(ProviderError):
    """Raised when the requested model is not found."""


class ProviderUnavailableError(ProviderError):
    """Raised when no provider is configured or the requested one is unknown."""


class ExtractionError(SiftError):
    """Raised when structured extraction fails (e.g. transcript too long)."""

    def __init__(self, message: str, phase_id: str = ""):
        super().__init__(message, context={"phase": phase_id})
