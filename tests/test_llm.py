import json

import httpx
import numpy as np
import pytest

from ofrenda.llm import Ollama, OllamaError


def client_for(handler) -> Ollama:
    return Ollama(model="gemma4:e4b", embed_model="embeddinggemma", transport=httpx.MockTransport(handler))


def test_chat_stream_yields_tokens():
    lines = [{"message": {"content": "Boo"}, "done": False}, {"message": {"content": "!"}, "done": False},
             {"message": {"content": ""}, "done": True}]
    body = "\n".join(json.dumps(l) for l in lines)
    ollama = client_for(lambda r: httpx.Response(200, text=body))
    assert list(ollama.chat_stream([{"role": "user", "content": "hi"}])) == ["Boo", "!"]


def test_chat_json_parses_content():
    def handler(request):
        sent = json.loads(request.content)
        assert sent["format"] == {"type": "object"} and sent["stream"] is False
        return httpx.Response(200, json={"message": {"content": '{"epitaph": "RIP"}'}})
    assert client_for(handler).chat_json([], {"type": "object"}) == {"epitaph": "RIP"}


def test_embed_returns_matrix():
    ollama = client_for(lambda r: httpx.Response(200, json={"embeddings": [[1, 0], [0, 1]]}))
    assert ollama.embed(["a", "b"]).shape == (2, 2)
    assert isinstance(ollama.embed(["a", "b"]), np.ndarray)


def test_check_missing_model():
    ollama = client_for(lambda r: httpx.Response(200, json={"models": [{"name": "embeddinggemma:latest"}]}))
    with pytest.raises(OllamaError, match="ollama pull gemma4:e4b"):
        ollama.check()


def test_check_ok_with_latest_suffix():
    models = {"models": [{"name": "embeddinggemma:latest"}, {"name": "gemma4:e4b"}]}
    client_for(lambda r: httpx.Response(200, json=models)).check()


def test_check_ollama_down():
    def handler(request):
        raise httpx.ConnectError("refused")
    with pytest.raises(OllamaError, match="not running"):
        client_for(handler).check()
