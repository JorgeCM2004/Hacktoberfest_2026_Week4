import os
import subprocess
from pathlib import Path

import pytest


def _git(repo: Path, *args: str, date: str | None = None, author: str = "Alice") -> None:
    env = dict(os.environ)
    env.update(
        GIT_AUTHOR_NAME=author,
        GIT_AUTHOR_EMAIL=f"{author.lower()}@example.com",
        GIT_COMMITTER_NAME=author,
        GIT_COMMITTER_EMAIL=f"{author.lower()}@example.com",
    )
    if date:
        env.update(GIT_AUTHOR_DATE=date, GIT_COMMITTER_DATE=date)
    subprocess.run(["git", *args], cwd=repo, env=env, check=True, capture_output=True)


@pytest.fixture
def git_repo(tmp_path: Path) -> Path:
    """Three commits by two authors, with a README and docs/guide.md."""
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    (repo / "README.md").write_text("# Spooky\nA library that summons ghosts.\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-q", "-m", "Initial commit", date="2015-03-01T10:00:00+00:00")
    (repo / "docs").mkdir()
    (repo / "docs" / "guide.md").write_text("# Guide\nCall summon() to raise the ghost.\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-q", "-m", "Add guide", date="2016-06-15T10:00:00+00:00", author="Bob")
    (repo / "main.py").write_text("print('boo')\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-q", "-m", "Goodbye, world", date="2019-10-31T23:59:00+00:00")
    return repo


@pytest.fixture
def empty_docs_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "bare"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    (repo / "main.c").write_text("int main(){}\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-q", "-m", "Only code", date="2010-01-01T00:00:00+00:00")
    return repo
