"""Hidden tests for m1-helper: click.format_filesize, as the task's spec states it."""
from fractions import Fraction

import pytest

import click
import click.utils

UNITS = ["B", "KiB", "MiB", "GiB", "TiB"]


def reference(n: int) -> str:
    """The spec, with exact arithmetic."""
    if n < 1024:
        return f"{n} B"
    i = 1
    while i < 4 and n >= 1024 ** (i + 1):
        i += 1
    tenths = int(Fraction(n * 10, 1024**i) + Fraction(1, 2))  # half up
    if tenths >= 10240 and i < 4:
        i += 1
        tenths = int(Fraction(n * 10, 1024**i) + Fraction(1, 2))
    return f"{tenths // 10}.{tenths % 10} {UNITS[i]}"


@pytest.mark.parametrize(
    ("n", "expected"),
    [
        (0, "0 B"),
        (1, "1 B"),
        (1023, "1023 B"),
        (1024, "1.0 KiB"),
        (1536, "1.5 KiB"),
        (1280, "1.3 KiB"),  # 1.25 rounds half up
        (1229, "1.2 KiB"),
        (1331, "1.3 KiB"),
        (1048524, "1023.9 KiB"),
        (1048575, "1.0 MiB"),
        (1048576, "1.0 MiB"),
        (5 * 1024**3, "5.0 GiB"),
        (1024**4, "1.0 TiB"),
        (1024**5, "1024.0 TiB"),
        (2048 * 1024**4, "2048.0 TiB"),
        (1024**3 - 1, "1.0 GiB"),
    ],
)
def test_examples(n, expected):
    assert click.format_filesize(n) == expected
    assert click.utils.format_filesize(n) == expected


def test_matches_reference():
    import random

    rng = random.Random(1)
    values = [rng.randrange(0, 1024**5) for _ in range(500)] + [k * 1024**e + d for e in range(1, 5) for k in (1, 2, 3) for d in (-1, 0, 1, 51, 52, 512)]
    for n in values:
        assert click.format_filesize(n) == reference(n), n


def test_returns_str():
    assert isinstance(click.format_filesize(10), str)


def test_negative():
    with pytest.raises(ValueError, match="num_bytes must not be negative"):
        click.format_filesize(-1)
