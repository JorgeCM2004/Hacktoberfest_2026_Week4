import numpy as np

from ofrenda.rag import Chunk, Index, chunk, read_docs


def test_read_docs_readme_first(git_repo):
    docs = read_docs(git_repo)
    assert [path for path, _ in docs] == ["README.md", "docs/guide.md"]
    assert "summons ghosts" in docs[0][1]


def test_read_docs_empty_repo(empty_docs_repo):
    assert read_docs(empty_docs_repo) == []


def test_chunk_overlap():
    text = "".join(chr(ord("a") + i % 26) for i in range(2000))
    chunks = chunk("x.md", text)
    assert len(chunks) == 3
    assert chunks[1].text.startswith(text[700:710])
    assert all(c.path == "x.md" for c in chunks)


KEYWORDS = ["ghost", "candle", "skull"]


def fake_embed(texts: list[str]) -> np.ndarray:
    return np.array([[1.0 if k in t else 0.0 for k in KEYWORDS] + [0.01] for t in texts])


def test_index_search_fake_embed():
    chunks = [Chunk("a.md", "a candle burns"), Chunk("b.md", "the ghost walks"), Chunk("c.md", "a skull")]
    index = Index.build(chunks, fake_embed)
    assert index.search("where is the ghost?", k=2)[0].path == "b.md"


def test_index_empty():
    assert Index.build([], fake_embed).search("anything") == []
