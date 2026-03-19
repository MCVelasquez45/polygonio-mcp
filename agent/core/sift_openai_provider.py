"""OpenAI provider for SIFT — allows using OPENAI_API_KEY for extraction."""

from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger("sift.providers.openai")

DEFAULT_MODEL = "gpt-4o"


class OpenAIProvider:
    """SIFT-compatible provider backed by the OpenAI chat completions API."""

    name = "openai"
    max_context_window = 128000

    def __init__(self) -> None:
        self.api_key = os.environ.get("OPENAI_API_KEY")
        self.model = os.environ.get("SIFT_MODEL") or os.environ.get("OPENAI_MODEL") or DEFAULT_MODEL

    def is_available(self) -> bool:
        return bool(self.api_key)

    def chat(self, system: str, user: str, max_tokens: int = 4000) -> str:
        from openai import OpenAI
        from sift.errors import ProviderAuthError, ProviderError, ProviderModelError, ProviderQuotaError

        client = OpenAI(api_key=self.api_key)

        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user})

        try:
            response = client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_completion_tokens=max_tokens,
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            err_str = str(e).lower()
            if "authentication" in err_str or "invalid api key" in err_str or "401" in err_str:
                raise ProviderAuthError(
                    "OpenAI API key is invalid or expired. Check OPENAI_API_KEY.",
                    provider=self.name,
                    model=self.model,
                ) from e
            if "rate" in err_str and "limit" in err_str or "429" in err_str:
                raise ProviderQuotaError(
                    "OpenAI rate limit exceeded. Wait and retry.",
                    provider=self.name,
                    model=self.model,
                ) from e
            if "model" in err_str and ("not found" in err_str or "does not exist" in err_str):
                raise ProviderModelError(
                    f"Model '{self.model}' not found on OpenAI.",
                    provider=self.name,
                    model=self.model,
                ) from e
            raise ProviderError(
                f"OpenAI API error: {e}",
                provider=self.name,
                model=self.model,
            ) from e

    def transcribe(self, audio_path: Path) -> str | None:
        from openai import OpenAI

        client = OpenAI(api_key=self.api_key)
        with open(audio_path, "rb") as f:
            result = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                response_format="text",
            )
        return result if isinstance(result, str) else str(result)


def register() -> None:
    """Register the OpenAI provider with sift's provider registry."""
    from sift.providers import PROVIDERS, _register_defaults
    from sift.core.secrets import PROVIDER_KEY_ENV

    _register_defaults()
    PROVIDERS["openai"] = OpenAIProvider
    PROVIDER_KEY_ENV["openai"] = "OPENAI_API_KEY"
