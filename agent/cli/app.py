"""Interactive CLI entrypoint orchestration."""

from __future__ import annotations

from typing import Optional

from rich.console import Console

from agents import SQLiteSession
from agents.exceptions import InputGuardrailTripwireTriggered
from agents.mcp import MCPServerStdio

from core.polygon_agent import create_polygon_mcp_server, run_analysis

from .messages import (
    show_error,
    show_goodbye,
    show_guardrail_warning,
    show_shutdown,
    show_success,
    show_welcome,
)


async def run_cli(
    *,
    session: Optional[SQLiteSession] = None,
    server: Optional[MCPServerStdio] = None,
    console: Optional[Console] = None,
) -> None:
    """Run the CLI experience. Optional dependencies ease testing."""
    console = console or Console()
    show_welcome(console)

    session_obj = session
    if session_obj is None:
        try:
            session_obj = SQLiteSession("cli_default_session")
        except Exception as exc:  # pragma: no cover - defensive initialization
            show_error(console, exc, label="Setup Error")
            show_shutdown(console)
            return

    owns_server = server is None
    server_obj = server
    mcp_failed = False
    if server_obj is None:
        try:
            server_obj = create_polygon_mcp_server()
        except Exception as exc:
            # MCP failed - continue without it (native Polygon tools still work)
            console.print(
                f"[yellow]⚠ MCP server unavailable ({exc}). "
                "Continuing with native Polygon REST API tools.[/yellow]"
            )
            mcp_failed = True
            server_obj = None

    async def _cli_loop() -> None:
        while True:
            try:
                user_input = input("> ").strip()
            except (EOFError, KeyboardInterrupt):
                show_goodbye(console)
                break

            if user_input.lower() == "exit":
                show_goodbye(console)
                break

            if len(user_input) < 2:
                console.print("Please enter a valid query (at least 2 characters).")
                continue

            try:
                result = await run_analysis(user_input, session=session_obj, server=server_obj, skip_mcp=(server_obj is None))
                show_success(console, user_input, result)
            except InputGuardrailTripwireTriggered as exc:
                show_guardrail_warning(console, exc)
            except Exception as exc:  # pragma: no cover - protect CLI loop
                show_error(console, exc, label="Agent Error")

    try:
        if owns_server and server_obj is not None:
            try:
                async with server_obj:
                    await _cli_loop()
            except Exception as mcp_exc:
                # MCP failed during connection - fallback to native tools
                console.print(
                    f"[yellow]⚠ MCP connection failed ({mcp_exc}). "
                    "Continuing with native Polygon REST API tools.[/yellow]"
                )
                server_obj = None  # Clear the failed server
                await _cli_loop()
        else:
            # Either server was passed in, MCP failed, or not using MCP
            await _cli_loop()
    except Exception as exc:  # pragma: no cover - guard unforeseen runtime issues
        show_error(console, exc, label="Unexpected Error")
    finally:
        show_shutdown(console)
