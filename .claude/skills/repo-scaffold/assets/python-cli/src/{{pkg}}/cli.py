"""Command-line entry point."""

import argparse
import sys

from . import __version__


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="{{name}}", description="{{description}}")
    parser.add_argument("--version", action="version", version=__version__)
    parser.add_argument("name", nargs="?", default="world")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    print(f"Hello, {args.name}!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
