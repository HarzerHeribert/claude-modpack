"""Hidden tests for m1-helper: the example command with --human."""
import importlib.util
from pathlib import Path

import click
from click.testing import CliRunner

ROOT = Path(__file__).resolve().parents[1]


def load():
    spec = importlib.util.spec_from_file_location("fs_example", ROOT / "examples" / "filesize" / "filesize.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.cli


def test_is_command():
    assert isinstance(load(), click.Command)


def test_human():
    out = CliRunner().invoke(load(), ["--human", "1536", "0", "1048575"])
    assert out.exit_code == 0, out.output
    assert out.output.splitlines() == ["1.5 KiB", "0 B", "1.0 MiB"]


def test_plain():
    out = CliRunner().invoke(load(), ["1536", "0"])
    assert out.exit_code == 0, out.output
    assert out.output.splitlines() == ["1536", "0"]


def test_no_sizes():
    out = CliRunner().invoke(load(), [])
    assert out.exit_code == 0 and out.output == ""
    assert CliRunner().invoke(load(), ["--human"]).exit_code == 0


def test_human_is_flag_off_by_default():
    opts = [p for p in load().params if isinstance(p, click.Option) and "--human" in p.opts]
    assert opts and opts[0].is_flag and not opts[0].default
