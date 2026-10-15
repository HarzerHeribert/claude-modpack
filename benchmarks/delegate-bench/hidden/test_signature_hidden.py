"""Hidden checks for t6-signature: resolve_color_default(*, override=None), callers updated."""

import inspect
import io

import pytest

import click
from click.globals import resolve_color_default


def test_keyword_only_override():
    params = list(inspect.signature(resolve_color_default).parameters.values())
    assert [p.name for p in params] == ["override"]
    assert params[0].kind is inspect.Parameter.KEYWORD_ONLY
    assert params[0].default is None


def test_positional_and_old_name_are_refused():
    with pytest.raises(TypeError):
        resolve_color_default(True)
    with pytest.raises(TypeError):
        resolve_color_default(color=True)


def test_value_passes_through():
    assert resolve_color_default(override=False) is False
    assert resolve_color_default(override=True) is True


def test_echo_still_honours_color():
    out = io.StringIO()
    click.echo(click.style("x", fg="red"), file=out, color=True)
    assert "\x1b[31m" in out.getvalue()
    out = io.StringIO()
    click.echo(click.style("x", fg="red"), file=out, color=False)
    assert out.getvalue() == "x\n"


def test_progressbar_still_honours_color():
    with click.progressbar(range(2), color=False, file=io.StringIO()) as bar:
        assert list(bar) == [0, 1]
