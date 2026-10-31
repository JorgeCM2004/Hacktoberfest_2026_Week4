"""Opening the grave: clone a GitHub repo and read the facts of its life from git."""

import os
import re
import shutil
import subprocess
from collections import Counter
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path

import httpx

_URL = re.compile(
    r"^(?:https?://)?(?:www\.)?(?:github\.com/)?(?P<owner>[\w.-]+)/(?P<name>[\w.-]+?)(?:\.git)?(?:/.*)?$"
)
ALIVE_DAYS = 365
CLONE_TIMEOUT = 180


@dataclass
class RepoFacts:
    owner: str
    name: str
    url: str
    born: str
    died: str
    last_words: str
    commit_count: int
    mourners: list[tuple[str, int]]
    archived: bool | None
    stars: int | None
    forks: int | None
    description: str | None
    alive: bool


def parse_github_url(text: str) -> tuple[str, str]:
    text = text.strip()
    host = re.match(r"^(?:https?://)?([^/]+)/", text)
    if host and "." in host.group(1) and host.group(1).lower() not in ("github.com", "www.github.com"):
        raise ValueError(f"Not a GitHub repo URL: {text}")
    match = _URL.match(text)
    if not match:
        raise ValueError(f"Not a GitHub repo URL: {text}")
    return match["owner"], match["name"]


def git(repo_dir: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=repo_dir, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"git {args[0]} failed")
    return result.stdout


def repo_url(owner: str, name: str) -> str:
    return f"https://github.com/{owner}/{name}.git"


def _has_head(repo_dir: Path) -> bool:
    try:
        git(repo_dir, "rev-parse", "--verify", "HEAD")
        return True
    except RuntimeError:
        return False


def clone(owner: str, name: str, cache_dir: Path) -> Path:
    target = cache_dir / f"{owner}__{name}"
    if (target / ".git").exists() and _has_head(target):
        return target
    shutil.rmtree(target, ignore_errors=True)  # a half-made clone from an interrupted run
    partial = cache_dir / f"{owner}__{name}.partial"
    shutil.rmtree(partial, ignore_errors=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    args = ["git", "-c", "credential.helper=", "clone", "--filter=blob:none", "--no-checkout",
            "-c", "core.longpaths=true", repo_url(owner, name), str(partial)]
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never"}
    try:
        result = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace",
                                env=env, timeout=CLONE_TIMEOUT)
    except subprocess.TimeoutExpired:
        shutil.rmtree(partial, ignore_errors=True)
        raise RuntimeError(f"Cloning {owner}/{name} took too long (over {CLONE_TIMEOUT} s). Try a smaller repo.")
    if result.returncode != 0:
        shutil.rmtree(partial, ignore_errors=True)
        raise RuntimeError(f"Could not clone {owner}/{name}: {result.stderr.strip()}")
    partial.rename(target)
    return target


def read_facts(repo_dir: Path, owner: str, name: str, now: datetime) -> RepoFacts:
    try:
        lines = [l for l in git(repo_dir, "log", "--format=%an%x1f%aI%x1f%s", "HEAD").splitlines() if l]
    except RuntimeError:
        lines = []
    if not lines:
        raise RuntimeError(f"{owner}/{name} has no commits: there is no one to summon.")
    commits = [line.split("\x1f", 2) for line in lines]
    authors = Counter(c[0] for c in commits)
    last_date = datetime.fromisoformat(commits[0][1])
    return RepoFacts(
        owner=owner,
        name=name,
        url=f"https://github.com/{owner}/{name}",
        born=commits[-1][1][:10],
        died=commits[0][1][:10],
        last_words=commits[0][2],
        commit_count=len(commits),
        mourners=authors.most_common(5),
        archived=None,
        stars=None,
        forks=None,
        description=None,
        alive=(now - last_date).days < ALIVE_DAYS,
    )


def enrich_from_github(facts: RepoFacts, client: httpx.Client) -> RepoFacts:
    try:
        response = client.get(f"https://api.github.com/repos/{facts.owner}/{facts.name}", timeout=5)
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError):
        return facts
    archived = bool(data.get("archived"))
    return replace(
        facts,
        archived=archived,
        stars=data.get("stargazers_count"),
        forks=data.get("forks_count"),
        description=data.get("description"),
        alive=facts.alive and not archived,
    )
