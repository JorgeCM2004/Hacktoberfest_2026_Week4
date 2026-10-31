"""The medium: talks to local open-weight models through Ollama."""

import json
import os
from collections.abc import Iterator

import httpx
import numpy as np

DEFAULT_MODEL = os.environ.get("OFRENDA_MODEL", "gemma3:4b")
DEFAULT_EMBED_MODEL = os.environ.get("OFRENDA_EMBED_MODEL", "embeddinggemma")
EMBED_BATCH = 32


class OllamaError(RuntimeError):
    pass


class Ollama:
    def __init__(self, base_url: str = "http://localhost:11434", model: str = DEFAULT_MODEL,
                 embed_model: str = DEFAULT_EMBED_MODEL, transport: httpx.BaseTransport | None = None):
        self.model = model
        self.embed_model = embed_model
        self.http = httpx.Client(base_url=base_url, transport=transport, timeout=httpx.Timeout(600, connect=5))

    def check(self) -> None:
        try:
            response = self.http.get("/api/tags")
            response.raise_for_status()
        except httpx.HTTPError as error:
            raise OllamaError(f"Ollama is not running at {self.http.base_url} ({error}). Start it and try again.")
        installed = {m["name"] for m in response.json().get("models", [])}
        installed |= {name.removesuffix(":latest") for name in installed}
        missing = [m for m in (self.model, self.embed_model) if m not in installed]
        if missing:
            pulls = " && ".join(f"ollama pull {m}" for m in missing)
            raise OllamaError(f"Missing model(s): {', '.join(missing)}. Run: {pulls}")

    def embed(self, texts: list[str]) -> np.ndarray:
        vectors = []
        for start in range(0, len(texts), EMBED_BATCH):
            response = self.http.post("/api/embed", json={"model": self.embed_model,
                                                          "input": texts[start:start + EMBED_BATCH]})
            response.raise_for_status()
            vectors.extend(response.json()["embeddings"])
        return np.array(vectors, dtype=float)

    def chat_json(self, messages: list[dict], schema: dict) -> dict:
        response = self.http.post("/api/chat", json={"model": self.model, "messages": messages,
                                                     "format": schema, "stream": False})
        response.raise_for_status()
        return json.loads(response.json()["message"]["content"])

    def chat_stream(self, messages: list[dict]) -> Iterator[str]:
        with self.http.stream("POST", "/api/chat", json={"model": self.model, "messages": messages,
                                                         "stream": True}) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if not line:
                    continue
                data = json.loads(line)
                if data.get("error"):
                    raise OllamaError(data["error"])
                text = data.get("message", {}).get("content", "")
                if text:
                    yield text
