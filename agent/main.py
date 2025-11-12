"""CLI entrypoint for the Polygon market analysis agent."""

import asyncio

from cli import run_cli


def main() -> None:
    asyncio.run(run_cli())


if __name__ == "__main__":
    main()
