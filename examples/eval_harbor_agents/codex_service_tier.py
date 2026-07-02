"""Codex Harbor agent with eval-controlled service tier support."""

from harbor.agents.installed.base import CliFlag
from harbor.agents.installed.codex import Codex


class CodexWithServiceTier(Codex):
    """Codex adapter extension for Harbor versions without service_tier."""

    CLI_FLAGS = [
        *Codex.CLI_FLAGS,
        CliFlag(
            "service_tier",
            cli="-c",
            type="enum",
            choices=["priority"],
            format="-c service_tier={value}",
        ),
    ]
