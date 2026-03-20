"""Shared formatting helpers for CLI output."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Iterable

from rich import box
from rich.columns import Columns
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.rule import Rule
from rich.table import Table
from rich.text import Text

from agents.exceptions import InputGuardrailTripwireTriggered

_MARKDOWN_HINTS = ("#", "*", "`", "-", ">")
_HEADING_PATTERN = re.compile(r"^(?:#+\s+)(.+)$")
_TICKER_PATTERN = re.compile(r"\(([A-Z]{1,5})\)")
_DATA_SIGNALS = {
    "earnings": "Earnings",
    "dividend": "Dividends",
    "sentiment": "News & Sentiment",
    "headline": "News Flow",
    "target": "Price Targets",
    "roi": "Performance",
    "macro": "Macro Data",
    "econom": "Economics",
    "option": "Options Flow",
    "risk": "Risk Factors",
}


def _looks_like_markdown(text: str) -> bool:
    return any(tag in text for tag in _MARKDOWN_HINTS)


def _as_renderable(text: str):
    if _looks_like_markdown(text):
        return Markdown(text)
    return Text(text.strip())


def _extract_sections(text: str) -> list[str]:
    """Best-effort heading extraction to mirror the reference dashboard."""
    sections: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        heading = _HEADING_PATTERN.match(stripped)
        if heading:
            sections.append(heading.group(1).strip())
            continue
        if stripped.endswith(":") and len(stripped.split()) <= 8:
            sections.append(stripped.rstrip(":").strip())
    return sections[:6] or ["Market Overview"]


def _extract_tickers(text: str) -> list[str]:
    """Pick out capitalized tickers that usually appear in parentheses."""
    tickers: list[str] = []
    for match in _TICKER_PATTERN.findall(text):
        ticker = match.upper()
        if ticker not in tickers:
            tickers.append(ticker)
        if len(tickers) >= 6:
            break
    return tickers


def _detect_data_signals(text: str) -> list[str]:
    lowered = text.lower()
    signals: list[str] = []
    for key, label in _DATA_SIGNALS.items():
        if key in lowered:
            signals.append(label)
    return signals[:5]


def _build_stats_panel(sections: Iterable[str], tickers: Iterable[str], payload: str) -> Panel:
    section_list = list(sections)
    ticker_list = list(tickers)
    stats_table = Table.grid(padding=(0, 1))
    stats_table.add_column(ratio=3)
    stats_table.add_column(justify="right", ratio=1)
    stats_table.add_row("Focus areas", ", ".join(section_list[:2]) or "General")
    stats_table.add_row("Sections detected", str(len(section_list)))
    stats_table.add_row("Ticker mentions", ", ".join(ticker_list) or "—")
    stats_table.add_row("Response length", f"{len(payload)} chars")
    return Panel(
        stats_table,
        title="Insights Snapshot",
        border_style="cyan",
        padding=(1, 2),
        box=box.ROUNDED,
    )


def _build_coverage_panel(signals: Iterable[str]) -> Panel:
    signal_list = list(signals)
    table = Table.grid(padding=(0, 1))
    if signal_list:
        for label in signal_list:
            table.add_row(f"[green]●[/green] {label}")
    else:
        table.add_row("[dim]Awaiting signal extraction[/dim]")
    return Panel(
        table,
        title="Data Coverage",
        border_style="blue",
        padding=(1, 2),
        box=box.ROUNDED,
    )


def show_welcome(console: Console) -> None:
    title = Text("Polygon Market Intelligence CLI", style="bold cyan")
    subtitle = Text("Type 'exit' to end the session. Live data courtesy of Polygon.io.", style="dim")
    console.print(
        Panel(
            Text.assemble(title, "\n", subtitle),
            border_style="cyan",
            padding=(1, 2),
            box=box.ROUNDED,
        )
    )


def show_success(console: Console, query: str, result: Any) -> None:
    final_output = getattr(result, "final_output", result)
    final_text = str(final_output).strip()

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    sections = _extract_sections(final_text)
    tickers = _extract_tickers(final_text)
    signals = _detect_data_signals(final_text)

    console.print()
    console.print(Rule("[bold green]Market Data Dashboard[/bold green]", characters="="))

    header = Table.grid(expand=True)
    header.add_column(ratio=3)
    header.add_column(justify="right", ratio=1)
    header.add_row(f"[bold white]{query}[/bold white]", f"[dim]{timestamp}[/dim]")
    header.add_row("[dim]AI-enhanced market snapshot[/dim]", "[green]Status: Ready[/green]")

    console.print(
        Panel(
            header,
            title="Active Query",
            border_style="green",
            padding=(1, 2),
            box=box.ROUNDED,
        )
    )

    console.print(
        Columns(
            [_build_stats_panel(sections, tickers, final_text), _build_coverage_panel(signals)],
            expand=True,
        )
    )

    if tickers:
        chip_row = "  ".join(f"[bold magenta]{ticker}[/bold magenta]" for ticker in tickers)
        console.print(
            Panel(
                chip_row,
                title="Ticker Focus",
                border_style="magenta",
                padding=(0, 2),
                box=box.ROUNDED,
            )
        )

    console.print(
        Panel(
            _as_renderable(final_text),
            title="Agent Narrative",
            border_style="white",
            padding=(1, 2),
            box=box.ROUNDED,
        )
    )
    console.print("[dim]Tip: ask to 'save a report' any time to persist the analysis locally.[/dim]")
    console.print(Rule(characters="─"))


def show_error(console: Console, error: Exception | str, *, label: str = "Error") -> None:
    console.print()
    console.print(Rule("[bold red]Agent Interruption[/bold red]", characters="="))
    console.print(
        Panel(
            Text(str(error).strip()),
            title=label,
            border_style="red",
            padding=(1, 2),
            box=box.ROUNDED,
        )
    )


def show_guardrail_warning(console: Console, exception: InputGuardrailTripwireTriggered) -> None:
    reasoning = getattr(getattr(exception, "output_info", None), "reasoning", None)
    body = Text(
        "This query is not finance-related.\n"
        "Ask about tickers, macro indicators, valuation drivers, sentiment, or trading flows.",
        style="yellow",
    )
    if reasoning:
        body.append(f"\n\nReasoning: {reasoning}", style="dim")

    console.print()
    console.print(Rule("[bold yellow]Guardrail Triggered[/bold yellow]", characters="="))
    console.print(
        Panel(
            body,
            border_style="yellow",
            padding=(1, 2),
            box=box.ROUNDED,
        )
    )


def show_goodbye(console: Console) -> None:
    console.print(Panel("Goodbye!", border_style="magenta", padding=(0, 2), box=box.ROUNDED))


def show_shutdown(console: Console) -> None:
    console.print(
        Panel(
            "Market Analysis Agent shutdown complete",
            border_style="dim",
            padding=(0, 2),
            box=box.ROUNDED,
        )
    )
