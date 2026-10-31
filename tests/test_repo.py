from datetime import datetime, timezone

import httpx
import pytest

from ofrenda.repo import RepoFacts, enrich_from_github, parse_github_url, read_facts

NOW = datetime(2026, 10, 31, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    "text",
    [
        "https://github.com/o/n",
        "https://github.com/o/n.git",
        "https://github.com/o/n/tree/main/src",
        "github.com/o/n",
        "o/n",
    ],
)
def test_parse_github_url_variants(text):
    assert parse_github_url(text) == ("o", "n")


def test_parse_github_url_rejects_other_hosts():
    with pytest.raises(ValueError):
        parse_github_url("https://gitlab.com/o/n")


def test_read_facts_from_fixture(git_repo):
    facts = read_facts(git_repo, "o", "n", NOW)
    assert facts.born == "2015-03-01"
    assert facts.died == "2019-10-31"
    assert facts.last_words == "Goodbye, world"
    assert facts.commit_count == 3
    assert facts.mourners[0] == ("Alice", 2)
    assert facts.url == "https://github.com/o/n"
    assert facts.stars is None and facts.archived is None


def test_alive_rule(git_repo):
    assert read_facts(git_repo, "o", "n", datetime(2019, 12, 1, tzinfo=timezone.utc)).alive
    assert not read_facts(git_repo, "o", "n", datetime(2020, 12, 5, tzinfo=timezone.utc)).alive


def _facts(alive=True) -> RepoFacts:
    return RepoFacts(
        owner="o", name="n", url="https://github.com/o/n", born="2015-03-01", died="2019-10-31",
        last_words="bye", commit_count=3, mourners=[("Alice", 2)], archived=None, stars=None,
        forks=None, description=None, alive=alive,
    )


def test_enrich_handles_api_failure():
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(403)))
    facts = enrich_from_github(_facts(), client)
    assert facts.stars is None and facts.forks is None and facts.archived is None


def test_enrich_archived_kills_it():
    payload = {"archived": True, "stargazers_count": 42, "forks_count": 7, "description": "boo"}
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=payload)))
    facts = enrich_from_github(_facts(alive=True), client)
    assert facts.archived is True and facts.stars == 42 and facts.forks == 7
    assert facts.description == "boo"
    assert facts.alive is False


def test_clone_disables_credential_prompts_and_times_out(monkeypatch, tmp_path):
    import subprocess
    from ofrenda import repo

    seen = {}

    def fake_run(args, **kwargs):
        seen["args"], seen["kwargs"] = args, kwargs
        raise subprocess.TimeoutExpired(args, kwargs.get("timeout"))

    monkeypatch.setattr(repo.subprocess, "run", fake_run)
    with pytest.raises(RuntimeError, match="took too long"):
        repo.clone("o", "n", tmp_path)
    assert "credential.helper=" in seen["args"]
    assert seen["kwargs"]["env"]["GCM_INTERACTIVE"] == "never"
    assert seen["kwargs"]["timeout"] > 0
    assert not (tmp_path / "o__n").exists()


def test_clone_replaces_a_half_made_clone(monkeypatch, tmp_path, git_repo):
    import subprocess
    from ofrenda import repo

    broken = tmp_path / "cache" / "o__n"
    broken.mkdir(parents=True)
    subprocess.run(["git", "init", "-q"], cwd=broken, check=True)  # .git exists, but no HEAD commit
    monkeypatch.setattr(repo, "repo_url", lambda owner, name: git_repo.as_uri())
    target = repo.clone("o", "n", tmp_path / "cache")
    assert read_facts(target, "o", "n", NOW).commit_count == 3


def test_read_facts_empty_repo_is_friendly(tmp_path):
    import subprocess

    empty = tmp_path / "empty"
    empty.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=empty, check=True)
    with pytest.raises(RuntimeError, match="o/n has no commits"):
        read_facts(empty, "o", "n", NOW)
