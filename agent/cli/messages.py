"""Shared formatting helpers for CLI output."""

from __future__ import annotations

from typing import Any

from rich.console import Console
from rich.markdown import Markdown

from agents.exceptions import InputGuardrailTripwireTriggered


def _render_markdown_or_text(console: Console, text: str) -> None:
    """Render markdown only when the payload actually contains markdown syntax."""
    if any(tag in text for tag in ("#", "*", "`", "-", ">")):
        console.print(Markdown(text))
    else:
        console.print(text.strip())


def show_welcome(console: Console) -> None:
    console.print("Welcome to the GPT-5 powered Market Analysis Agent. Type 'exit' to quit.")


def show_success(console: Console, result: Any) -> None:
    console.print("\n[bold green]✔ Query processed successfully![/bold green]")
    console.print("[bold]Agent Response:[/bold]")

    final_output = getattr(result, "final_output", result)
    final_text = str(final_output)
    _render_markdown_or_text(console, final_text)
    console.print("---------------------\n")


def show_error(console: Console, error: Exception | str, *, label: str = "Error") -> None:
    console.print(f"\n[bold red]!!! {label} !!![/bold red]")
    console.print(str(error).strip())
    console.print("------------------\n")


def show_guardrail_warning(console: Console, exception: InputGuardrailTripwireTriggered) -> None:
    console.print("\n[bold yellow]⚠ Guardrail Triggered[/bold yellow]")
    console.print("[yellow]This query is not related to finance.[/yellow]")

    reasoning = getattr(getattr(exception, "output_info", None), "reasoning", None)
    if reasoning:
        console.print(f"[dim]Reasoning: {reasoning}[/dim]")

    console.print(
        "[dim]Please ask about stock prices, market data, financial analysis, "
        "economic indicators, or company financials.[/dim]"
    )
    console.print("------------------\n")


def show_goodbye(console: Console) -> None:
    console.print("Goodbye!")


def show_shutdown(console: Console) -> None:
    console.print("Market Analysis Agent shutdown complete")
