"""Hidden tests for the long feature task: click.Duration, as the task's spec states it."""

import datetime as dt
import pathlib

import pytest

import click
from click.testing import CliRunner

D = dt.timedelta


def conv(value):
    return click.Duration().convert(value, None, None)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("120", D(seconds=120)),
        ("0", D(0)),
        ("2d", D(days=2)),
        ("1h30m", D(hours=1, minutes=30)),
        ("45S", D(seconds=45)),
        ("1d2h3m4s", D(days=1, hours=2, minutes=3, seconds=4)),
        ("90m", D(minutes=90)),
        ("1H", D(hours=1)),
    ],
)
def test_valid(value, expected):
    assert conv(value) == expected


def test_timedelta_passes_through():
    value = D(minutes=5)
    assert conv(value) is value


@pytest.mark.parametrize("value", ["", "-5", "1.5h", "5x", "1m1h", "1h1h", "1h 30m", "h", "1d-2h"])
def test_invalid(value):
    with pytest.raises(click.BadParameter) as e:
        conv(value)
    assert f"{value!r} is not a valid duration." in str(e.value)


def test_cli_name_and_metavar():
    @click.command()
    @click.option("--wait", type=click.Duration())
    def cli(wait):
        click.echo(repr(wait))

    assert click.Duration().name == "duration"
    assert "DURATION" in CliRunner().invoke(cli, ["--help"]).output
    ok = CliRunner().invoke(cli, ["--wait", "1h30m"])
    assert ok.output.strip() == repr(D(hours=1, minutes=30))
    bad = CliRunner().invoke(cli, ["--wait", "soon"])
    assert bad.exit_code == 2 and "'soon' is not a valid duration." in bad.output


def test_documented():
    assert "Duration" in pathlib.Path("docs/parameter-types.md").read_text()
