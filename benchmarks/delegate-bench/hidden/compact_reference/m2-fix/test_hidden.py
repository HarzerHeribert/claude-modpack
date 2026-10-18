"""Hidden regression tests for m2-fix: clamping an open upper bound lands on the largest value inside the range."""
import click
import pytest


@pytest.mark.parametrize(
    ("kwargs", "value", "expected"),
    [
        ({"max": 5, "max_open": True}, "9", 4),
        ({"max": 5, "max_open": True}, "5", 4),
        ({"max": 5, "max_open": True}, "4", 4),
        ({"min": 0, "max": 10, "max_open": True}, "100", 9),
        ({"min": 0, "max": 10, "min_open": True, "max_open": True}, "100", 9),
        ({"min": 0, "max": 10, "min_open": True, "max_open": True}, "-100", 1),
        ({"min": 0, "min_open": True}, "-3", 1),
        ({"max": 5}, "9", 5),
    ],
)
def test_int_range_clamp(kwargs, value, expected):
    assert click.IntRange(clamp=True, **kwargs).convert(value, None, None) == expected


def test_clamped_value_is_inside_the_range():
    t = click.IntRange(max=5, max_open=True, clamp=True)
    for v in range(-3, 20):
        assert t.convert(str(v), None, None) < 5
