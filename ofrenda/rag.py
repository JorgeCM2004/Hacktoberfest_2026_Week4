"""Gathering its writings: read the repo's Markdown and search it with EmbeddingGemma."""

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

import numpy as np

from ofrenda.repo import git

DOC_SUFFIXES = (".md", ".markdown", ".rst", ".txt")
DOC_DIRS = ("", "docs", "doc")
MAX_FILES = 30
MAX_TOTAL = 200_000
MAX_FILE = 40_000

DOC_PREFIX = "title: none | text: "
QUERY_PREFIX = "task: search result | query: "


@dataclass
class Chunk:
    path: str
    text: str


def read_docs(repo_dir: Path) -> list[tuple[str, str]]:
    paths = git(repo_dir, "ls-tree", "-r", "--name-only", "HEAD").splitlines()
    readmes = [p for p in paths if "/" not in p and p.lower().startswith("readme")]
    others = [
        p for p in paths
        if p not in readmes
        and p.lower().endswith(DOC_SUFFIXES)
        and str(PurePosixPath(p).parent).replace(".", "") in DOC_DIRS
    ]
    docs: list[tuple[str, str]] = []
    total = 0
    for path in (readmes + sorted(others))[:MAX_FILES]:
        try:
            text = git(repo_dir, "show", f"HEAD:{path}")[:MAX_FILE]
        except RuntimeError:
            continue
        if total + len(text) > MAX_TOTAL:
            break
        total += len(text)
        docs.append((path, text))
    return docs


def chunk(path: str, text: str, size: int = 800, overlap: int = 100) -> list[Chunk]:
    chunks = []
    start = 0
    while start < len(text):
        chunks.append(Chunk(path, text[start:start + size]))
        if start + size >= len(text):
            break
        start += size - overlap
    return chunks


class Index:
    def __init__(self, chunks: list[Chunk], vectors: np.ndarray, embed: Callable[[list[str]], np.ndarray]):
        self.chunks = chunks
        self.vectors = vectors
        self.embed = embed

    @classmethod
    def build(cls, chunks: list[Chunk], embed: Callable[[list[str]], np.ndarray]) -> "Index":
        if not chunks:
            return cls([], np.zeros((0, 0)), embed)
        vectors = _normalise(np.asarray(embed([DOC_PREFIX + c.text for c in chunks]), dtype=float))
        return cls(chunks, vectors, embed)

    def search(self, query: str, k: int = 4) -> list[Chunk]:
        if not self.chunks:
            return []
        q = _normalise(np.asarray(self.embed([QUERY_PREFIX + query]), dtype=float))[0]
        order = np.argsort(self.vectors @ q)[::-1][:k]
        return [self.chunks[i] for i in order]


def _normalise(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    return vectors / np.where(norms == 0, 1, norms)
