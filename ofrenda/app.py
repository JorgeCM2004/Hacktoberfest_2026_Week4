"""The altar: a FastAPI app that summons spirits and lets you question them."""

import json
import threading
from collections.abc import Callable, Generator, Iterator
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import httpx
from fastapi import FastAPI
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ofrenda.llm import Ollama
from ofrenda.prompts import EPITAPH_SCHEMA, epitaph_messages, oracle_messages, tidy
from ofrenda.rag import Chunk, Index, chunk, read_docs
from ofrenda.repo import RepoFacts, clone, enrich_from_github, parse_github_url, read_facts

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
CACHE = ROOT / ".cache" / "repos"
DEPARTED = "That spirit has departed. Summon it again."


Lang = Literal["en", "es"]


@dataclass
class Words:
    epitaph: str
    obituary: str
    legacy: list[str]


@dataclass
class Spirit:
    facts: RepoFacts
    index: Index
    readme: str
    readme_head: Chunk | None
    words: dict[str, Words] = field(default_factory=dict)  # one ofrenda text per language

    def ofrenda(self, spirit_id: str, lang: str) -> dict:
        w = self.words[lang]
        return {"type": "ofrenda", "id": spirit_id, "facts": asdict(self.facts), "epitaph": w.epitaph,
                "obituary": w.obituary, "legacy": w.legacy}


class SummonRequest(BaseModel):
    url: str
    lang: Lang = "en"


class AskRequest(BaseModel):
    id: str
    question: str
    history: list[dict] = []
    lang: Lang = "en"


def _line(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False) + "\n"


def _ndjson(events: Iterator[dict]) -> StreamingResponse:
    def lines():
        try:
            for event in events:
                yield _line(event)
        except Exception as error:  # every failure ends the stream with a readable message
            yield _line({"type": "error", "message": str(error) or error.__class__.__name__})
    return StreamingResponse(lines(), media_type="application/x-ndjson")


def create_app(llm=None, open_repo: Callable[[str, str], Path] | None = None,
               github: httpx.Client | None = None, now: Callable[[], datetime] | None = None) -> FastAPI:
    llm = llm or Ollama()
    open_repo = open_repo or (lambda owner, name: clone(owner, name, CACHE))
    github = github or httpx.Client(headers={"User-Agent": "ofrenda"})
    now = now or (lambda: datetime.now(timezone.utc))
    spirits: dict[str, Spirit] = {}
    summoning = threading.Lock()  # one local user: summons run one at a time, repeats reuse the spirit

    app = FastAPI(title="Ofrenda")
    app.mount("/static", StaticFiles(directory=STATIC), name="static")

    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html")

    def progress(step: str, message: str, **extra) -> dict:
        return {"type": "progress", "step": step, "message": message, **extra}

    def summon(url: str, lang: str) -> Iterator[dict]:
        owner, name = parse_github_url(url)
        spirit_id = f"{owner}/{name}".lower()
        if spirit_id not in spirits:
            yield progress("waiting", "Waiting at the altar…")
        with summoning:
            spirit = spirits.get(spirit_id)
            if spirit is None:
                spirit = yield from raise_spirit(owner, name)
                spirits[spirit_id] = spirit
            if lang not in spirit.words:
                yield progress("epitaph", "Writing the epitaph…")
                words = llm.chat_json(epitaph_messages(spirit.facts, spirit.readme, lang), EPITAPH_SCHEMA)
                spirit.words[lang] = Words(tidy(words["epitaph"], 25), tidy(words["obituary"], 150),
                                           [tidy(item, 30) for item in words["legacy"]])
            yield spirit.ofrenda(spirit_id, lang)

    def raise_spirit(owner: str, name: str) -> Generator[dict, None, Spirit]:
        llm.check()
        yield progress("grave", "Opening the grave…")
        repo_dir = open_repo(owner, name)
        yield progress("bones", "Reading the bones (git history)…")
        facts = enrich_from_github(read_facts(repo_dir, owner, name, now()), github)
        yield progress("words", "Listening to its last words…")
        yield progress("writings", "Gathering its writings…")
        docs = read_docs(repo_dir)
        chunks = [c for path, text in docs for c in chunk(path, text)]
        yield progress("candles", f"Lighting the candles (embedding {len(chunks)} fragments)…", count=len(chunks))
        index = Index.build(chunks, llm.embed)
        readme = docs[0][1] if docs and docs[0][0].lower().startswith("readme") else ""
        readme_head = chunk(docs[0][0], readme)[0] if readme else None
        return Spirit(facts, index, readme, readme_head)

    def ask(request: AskRequest) -> Iterator[dict]:
        spirit = spirits.get(request.id.lower())
        if spirit is None:
            yield {"type": "error", "message": DEPARTED}
            return
        found = spirit.index.search(request.question)
        context = ([spirit.readme_head] if spirit.readme_head else []) + [c for c in found if c != spirit.readme_head]
        epitaph = (spirit.words.get(request.lang) or next(iter(spirit.words.values()))).epitaph
        messages = oracle_messages(spirit.facts, epitaph, context, request.history, request.question, request.lang)
        for text in llm.chat_stream(messages):
            yield {"type": "token", "text": text}
        yield {"type": "sources", "files": list(dict.fromkeys(c.path for c in context))}
        yield {"type": "done"}

    @app.post("/api/summon")
    def summon_endpoint(request: SummonRequest):
        return _ndjson(summon(request.url, request.lang))

    @app.post("/api/ask")
    def ask_endpoint(request: AskRequest):
        return _ndjson(ask(request))

    return app
