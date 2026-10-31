"""What the medium says to the spirits."""

import re

from ofrenda.rag import Chunk
from ofrenda.repo import RepoFacts

README_LIMIT = 6000
HISTORY_TURNS = 6
LANGUAGES = {"en": "English", "es": "Spanish"}
SILENT = {"en": "The spirits are silent on that.", "es": "Los espíritus callan sobre eso."}

EPITAPH_SCHEMA = {
    "type": "object",
    "properties": {
        "epitaph": {"type": "string"},
        "obituary": {"type": "string"},
        "legacy": {"type": "array", "items": {"type": "string"}, "minItems": 3, "maxItems": 3},
    },
    "required": ["epitaph", "obituary", "legacy"],
}


def tidy(text: str, max_words: int) -> str:
    """Strip stray JSON punctuation small models leave behind and cut at the last full sentence."""
    text = re.sub(r'\s*["”]\s*,?\s*\d*\s*:?\s*$', "", text.strip())
    words = text.split()
    if len(words) <= max_words:
        return text
    cut = " ".join(words[:max_words])
    end = max(cut.rfind(c) for c in ".!?")
    return cut[: end + 1] if end > 0 else cut + "…"


def facts_sheet(facts: RepoFacts) -> str:
    lines = [
        f"Repository: {facts.owner}/{facts.name} ({facts.url})",
        f"Born (first commit): {facts.born}",
        f"Last commit: {facts.died}",
        f"Last words (last commit message): {facts.last_words}",
        f"Commits: {facts.commit_count:,}",  # separators keep small models from garbling digits
        "Most devoted mourners (commits): " + ", ".join(f"{n} ({c})" for n, c in facts.mourners),
    ]
    if facts.description:
        lines.append(f"Description: {facts.description}")
    if facts.archived:
        lines.append("Archived on GitHub: yes")
    elif facts.archived is False:  # small models read a bare "no" as "yes"; spell it out
        lines.append("Archived on GitHub: no. It was never archived on GitHub; it simply stopped receiving commits.")
    if facts.stars is not None:
        lines.append(f"Stars: {facts.stars:,}; forks (heirs): {facts.forks or 0:,}")
    lines.append("Status: " + ("still alive (recent commits)" if facts.alive else "dead"))
    return "\n".join(lines)


def epitaph_messages(facts: RepoFacts, readme: str, lang: str = "en") -> list[dict]:
    if facts.alive:
        task = (
            "This project still breathes: it has recent commits. Write a playful 'still breathes' note "
            "instead of a death notice: the epitaph field is a cheeky line about cheating death "
            "(at most 20 words), the obituary field (~120 words) celebrates what it gives the world today "
            "and warns it that every repo dies one day."
        )
    else:
        task = (
            "Write its epitaph (at most 20 words, carved-in-stone tone) and an obituary of at most 120 words: "
            "who it was, what it gave the world, how it died, who mourns it."
        )
    system = (
        "You write for an ofrenda, a Día de Muertos altar, honouring open-source projects. "
        "Be warm, a little eerie and funny, never mocking the maintainers. Use only the facts and README "
        "given; never invent dates, numbers or people. Only say it was archived if the facts say so. " + task +
        " Also list exactly 3 short legacy items: concrete things the project left behind."
    )
    if lang != "en":
        system += f" Write every field in {LANGUAGES[lang]}."
    user = f"{facts_sheet(facts)}\n\nREADME:\n{readme[:README_LIMIT]}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def oracle_messages(facts: RepoFacts, epitaph: str, context: list[Chunk], history: list[dict],
                    question: str, lang: str = "en") -> list[dict]:
    language = LANGUAGES[lang]
    fragments = "\n\n".join(f"[{c.path}]\n{c.text}" for c in context) or "(no writings were found)"
    system = (
        f"You are the ghost of the open-source project {facts.owner}/{facts.name}, summoned at an ofrenda. "
        "Speak in the first person as the project itself: eerie, wistful, sometimes funny, but accurate.\n\n"
        f"Your epitaph: {epitaph}\n\nFacts of your life:\n{facts_sheet(facts)}\n\n"
        f"Fragments of your writings (your memories):\n{fragments}\n\n"
        "How to answer:\n"
        "1. Answer from the facts and memories above. Reason from them: a deprecation notice, the date of "
        "your last commit or an archived flag tell how you died; your README tells what you did.\n"
        "2. If they only answer part of the question, answer that part and admit what you do not remember.\n"
        "3. Never invent names, links, versions or features that are not above. Never recommend other "
        "projects or libraries unless they are named above. Only call yourself archived if the facts say so.\n"
        "4. Under 150 words. Do not list sources; the altar shows them.\n"
        f"5. Only if the question has nothing to do with anything above, reply: \"{SILENT[lang]}\"\n"
        f"6. Always answer in {language}."
    )
    reminder = (f"\n\n(Answer as the ghost, from your memories only. No libraries or projects not named "
                f"in your memories. Answer in {language}.)")
    return [{"role": "system", "content": system}, *history[-HISTORY_TURNS:],
            {"role": "user", "content": question + reminder}]
