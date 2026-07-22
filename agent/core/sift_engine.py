"""Local structured-data extraction engine (vendored, single-provider).

Turns a transcript plus a list of {id, type, prompt} field definitions into a
structured dict, using the OpenAI chat completions API. This previously
depended on the external, unpublished `sift-cli` package; that surface was
small enough (one function) to own directly rather than pull in an unpinned
third-party git dependency.
"""

from __future__ import annotations

import logging

import yaml

from core.sift_errors import ExtractionError, ProviderError
from core.sift_openai_provider import OpenAIProvider

logger = logging.getLogger("agent.sift_engine")


def extract_structured_data(
    transcript: str,
    extraction_fields: list[dict],
    phase_name: str = "",
    context: str = "",
) -> dict:
    """Extract structured data from a transcript using the OpenAI provider.

    Args:
        transcript: The raw transcript text.
        extraction_fields: List of {id, type, prompt} dicts defining what to extract.
        phase_name: Name of the current phase (for prompt context).
        context: Additional context from previous phases.

    Returns:
        Dict with extraction field IDs as keys and extracted data as values.

    Raises:
        ProviderError: If the OpenAI API call fails.
        ExtractionError: If the transcript exceeds the provider's context window.
    """
    provider = OpenAIProvider()
    if not provider.is_available():
        raise ProviderError("OPENAI_API_KEY is not configured.", provider=provider.name)

    field_descriptions = [f"- **{f['id']}** (type: {f['type']}): {f['prompt']}" for f in extraction_fields]
    fields_text = "\n".join(field_descriptions)

    system_prompt = (
        "You are a structured data extraction engine. Given a transcript, "
        "extract the requested information and return it as valid YAML. "
        "Be thorough but precise. Only include information that is actually "
        "present in or clearly implied by the transcript. "
        "Do not invent or assume information not supported by the text."
    )

    user_prompt = f"""Here is a transcript from the "{phase_name}" phase of a session:

<transcript>
{transcript}
</transcript>

{f"Additional context from previous phases: {context}" if context else ""}

Please extract the following structured data from this transcript:

{fields_text}

Return your response as valid YAML with each field ID as a top-level key.
For 'list' types, use YAML lists. For 'map' types, use YAML mappings.
For 'text' types, use plain strings. For 'boolean' types, use true/false.

Return ONLY the YAML, no markdown fences, no preamble, no explanation."""

    estimated_tokens = (len(system_prompt) + len(user_prompt)) // 4
    if estimated_tokens > provider.max_context_window:
        raise ExtractionError(
            f"Transcript is too long for {provider.name} ({estimated_tokens:,} estimated tokens, "
            f"limit is {provider.max_context_window:,}). "
            "Try using a model with a larger context window or splitting the session.",
            phase_id=phase_name,
        )

    logger.info("Extracting with %s (%s)...", provider.name, provider.model)

    try:
        response_text = provider.chat(system_prompt, user_prompt, max_tokens=8000).strip()
    except ProviderError:
        raise
    except Exception as e:
        logger.error("Unexpected error during extraction: %s", e)
        raise ProviderError(f"Extraction failed: {e}", provider=provider.name) from e

    response_text = _strip_markdown_fences(response_text)

    try:
        extracted = yaml.safe_load(response_text)
        if not isinstance(extracted, dict):
            extracted = {"raw": extracted}
        return extracted
    except yaml.YAMLError:
        logger.info("Fixing YAML formatting...")
        try:
            fix_prompt = (
                "The following YAML has syntax errors (likely unquoted colons in values). "
                "Fix it and return ONLY valid YAML. Quote any string values that contain colons.\n\n"
                f"{response_text}"
            )
            fixed_text = provider.chat("", fix_prompt, max_tokens=8000).strip()
            fixed_text = _strip_markdown_fences(fixed_text)
            extracted = yaml.safe_load(fixed_text)
            if not isinstance(extracted, dict):
                extracted = {"raw": extracted}
            return extracted
        except (yaml.YAMLError, ProviderError):
            logger.warning("Could not parse extraction as YAML. Saving raw response.")
            return {"_raw_response": response_text}


def _strip_markdown_fences(text: str) -> str:
    """Remove markdown code fences from text."""
    if text.startswith("```"):
        lines = [line for line in text.split("\n") if not line.strip().startswith("```")]
        text = "\n".join(lines)
    return text
