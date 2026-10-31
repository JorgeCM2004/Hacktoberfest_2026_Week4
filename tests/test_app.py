import json
from datetime import datetime, timezone

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from ofrenda.app import create_app
from ofrenda.llm import OllamaError


class FakeLLM:
    def __init__(self, down=False):
        self.down = down

    def check(self):
        if self.down:
            raise OllamaError("Ollama is not running at http://localhost:11434")

    def embed(self, texts):
        return np.array([[1.0 if "ghost" in t else 0.0, 0.1] for t in texts])

    def chat_json(self, messages, schema):
        return {"epitaph": "Here lies n.", "obituary": "It summoned ghosts.", "legacy": ["a", "b", "c"]}

    def chat_stream(self, messages):
        yield from ["I ", "died ", "tired."]


def make_client(git_repo, llm) -> TestClient:
    github = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(403)))
    app = create_app(llm=llm, open_repo=lambda owner, name: git_repo, github=github,
                     now=lambda: datetime(2026, 10, 31, tzinfo=timezone.utc))
    return TestClient(app)


def events(response) -> list[dict]:
    return [json.loads(line) for line in response.text.splitlines() if line]


def test_summon_bad_url_streams_error(git_repo):
    out = events(make_client(git_repo, FakeLLM()).post("/api/summon", json={"url": "https://gitlab.com/a/b"}))
    assert out[-1]["type"] == "error" and "GitHub" in out[-1]["message"]


def test_summon_happy_path_with_fakes(git_repo):
    out = events(make_client(git_repo, FakeLLM()).post("/api/summon", json={"url": "o/n"}))
    assert out[0]["type"] == "progress"
    last = out[-1]
    assert last["type"] == "ofrenda" and last["id"] == "o/n"
    assert last["facts"]["last_words"] == "Goodbye, world" and last["facts"]["stars"] is None
    assert last["epitaph"] == "Here lies n." and last["legacy"] == ["a", "b", "c"]


def test_summon_ollama_down_streams_error(git_repo):
    out = events(make_client(git_repo, FakeLLM(down=True)).post("/api/summon", json={"url": "o/n"}))
    assert out[-1]["type"] == "error" and "not running" in out[-1]["message"]


def test_summon_clone_failure_streams_error(git_repo):
    def broken(owner, name):
        raise RuntimeError("Could not clone o/n: repository not found")
    app = create_app(llm=FakeLLM(), open_repo=broken, github=httpx.Client(
        transport=httpx.MockTransport(lambda r: httpx.Response(404))))
    out = events(TestClient(app).post("/api/summon", json={"url": "o/n"}))
    assert out[-1] == {"type": "error", "message": "Could not clone o/n: repository not found"}


def test_ask_streams_tokens_then_sources(git_repo):
    client = make_client(git_repo, FakeLLM())
    events(client.post("/api/summon", json={"url": "o/n"}))
    out = events(client.post("/api/ask", json={"id": "o/n", "question": "Where is the ghost?", "history": []}))
    assert "".join(e["text"] for e in out if e["type"] == "token") == "I died tired."
    assert out[-2]["type"] == "sources" and out[-2]["files"][0] in ("README.md", "docs/guide.md")
    assert out[-1] == {"type": "done"}


def test_ask_unknown_id(git_repo):
    out = events(make_client(git_repo, FakeLLM()).post("/api/ask", json={"id": "x/y", "question": "hi"}))
    assert out == [{"type": "error", "message": "That spirit has departed. Summon it again."}]


def test_index_page_served(git_repo):
    response = make_client(git_repo, FakeLLM()).get("/")
    assert response.status_code == 200 and "<canvas" in response.text


class RecordingLLM(FakeLLM):
    def __init__(self):
        super().__init__()
        self.last_messages = None

    def chat_stream(self, messages):
        self.last_messages = messages
        yield "ok"


def test_ask_always_includes_readme_head(git_repo):
    llm = RecordingLLM()
    client = make_client(git_repo, llm)
    events(client.post("/api/summon", json={"url": "o/n"}))
    out = events(client.post("/api/ask", json={"id": "o/n", "question": "Where is the ghost?"}))
    assert "summons ghosts" in llm.last_messages[0]["content"]  # README head, even if search ranks it low
    assert out[-2]["files"][0] == "README.md"


def test_concurrent_summons_open_repo_once(git_repo):
    import threading
    calls = []
    gate = threading.Event()

    def slow_open(owner, name):
        calls.append(name)
        gate.wait(2)
        return git_repo

    app = create_app(llm=FakeLLM(), open_repo=slow_open, github=httpx.Client(
        transport=httpx.MockTransport(lambda r: httpx.Response(404))))
    client = TestClient(app)
    results = []
    threads = [threading.Thread(target=lambda: results.append(
        events(client.post("/api/summon", json={"url": "o/n"})))) for _ in range(2)]
    for t in threads:
        t.start()
    __import__("time").sleep(0.3)  # both requests are inside summon before the clone finishes
    gate.set()
    for t in threads:
        t.join()
    assert calls == ["n"]
    assert all(r[-1]["type"] == "ofrenda" for r in results)


class CountingLLM(RecordingLLM):
    def __init__(self):
        super().__init__()
        self.json_calls = []

    def chat_json(self, messages, schema):
        self.json_calls.append(messages)
        return super().chat_json(messages, schema)


def test_summon_in_spanish_reuses_the_spirit_and_rewrites_the_epitaph(git_repo):
    opened = []
    llm = CountingLLM()
    github = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(403)))
    client = TestClient(create_app(llm=llm, open_repo=lambda o, n: opened.append(n) or git_repo, github=github))
    first = events(client.post("/api/summon", json={"url": "o/n"}))[-1]
    second = events(client.post("/api/summon", json={"url": "o/n", "lang": "es"}))[-1]
    assert opened == ["n"] and first["id"] == second["id"] == "o/n"
    assert len(llm.json_calls) == 2 and "Spanish" in llm.json_calls[1][0]["content"]
    events(client.post("/api/summon", json={"url": "o/n", "lang": "es"}))
    assert len(llm.json_calls) == 2  # cached per language


def test_ask_answers_in_the_chosen_language(git_repo):
    llm = RecordingLLM()
    client = make_client(git_repo, llm)
    events(client.post("/api/summon", json={"url": "o/n"}))
    events(client.post("/api/ask", json={"id": "o/n", "question": "¿Quién eres?", "lang": "es"}))
    assert "Always answer in Spanish" in llm.last_messages[0]["content"]


def test_progress_events_carry_a_step_key(git_repo):
    out = events(make_client(git_repo, FakeLLM()).post("/api/summon", json={"url": "o/n"}))
    steps = [e["step"] for e in out if e["type"] == "progress"]
    assert steps[:2] == ["waiting", "grave"] and "candles" in steps and steps[-1] == "epitaph"


def test_unknown_language_is_rejected(git_repo):
    assert make_client(git_repo, FakeLLM()).post("/api/summon", json={"url": "o/n", "lang": "fr"}).status_code == 422
