from ofrenda.prompts import epitaph_messages, oracle_messages, tidy
from ofrenda.rag import Chunk
from ofrenda.repo import RepoFacts


def facts(alive=False) -> RepoFacts:
    return RepoFacts(
        owner="request", name="request", url="https://github.com/request/request",
        born="2011-01-22", died="2020-02-11", last_words="Deprecation notice",
        commit_count=2280, mourners=[("Mikeal", 900)], archived=True, stars=25000, forks=3000,
        description="Simplified HTTP request client.", alive=alive,
    )


def _all_text(messages) -> str:
    return "\n".join(m["content"] for m in messages)


def test_epitaph_messages_contain_facts():
    text = _all_text(epitaph_messages(facts(), "# request\nMake HTTP calls."))
    for value in ["request/request", "2011-01-22", "2020-02-11", "Deprecation notice", "Make HTTP calls"]:
        assert value in text


def test_epitaph_messages_truncate_readme():
    text = _all_text(epitaph_messages(facts(), "x" * 10_000))
    assert "x" * 6000 in text and "x" * 6001 not in text


def test_epitaph_messages_alive_variant():
    assert "still breathes" in _all_text(epitaph_messages(facts(alive=True), ""))
    assert "still breathes" not in _all_text(epitaph_messages(facts(alive=False), ""))


def test_oracle_messages_include_context_paths_and_cap_history():
    history = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i}"} for i in range(8)]
    messages = oracle_messages(facts(), "Here lies request.", [Chunk("docs/api.md", "use request.get")],
                               history, "Why did you die?")
    assert messages[0]["role"] == "system"
    assert "docs/api.md" in messages[0]["content"] and "use request.get" in messages[0]["content"]
    assert "The spirits are silent on that." in messages[0]["content"]
    assert [m["content"] for m in messages[1:-1]] == [f"turn {i}" for i in range(2, 8)]
    assert messages[-1]["content"].startswith("Why did you die?")


def test_tidy_cuts_to_last_sentence_within_limit():
    text = "One two three. Four five six. Seven eight nine ten."
    assert tidy(text, max_words=7) == "One two three. Four five six."


def test_tidy_strips_trailing_json_junk():
    assert tidy('It rests in peace.", 3:', max_words=50) == "It rests in peace."


def test_tidy_keeps_short_text():
    assert tidy("Here lies request", max_words=20) == "Here lies request"


def test_oracle_rules_forbid_the_inventions_seen_with_gemma3():
    system = oracle_messages(facts(), "Here lies request.", [], [], "What should I use instead?")[0]["content"]
    assert "Never recommend other projects or libraries" in system
    assert "Only call yourself archived if the facts say so" in system


def test_oracle_question_carries_a_reminder():
    last = oracle_messages(facts(), "Here lies request.", [], [], "What should I use instead?")[-1]
    assert last["role"] == "user" and last["content"].startswith("What should I use instead?")
    assert "not named in your memories" in last["content"]


def test_epitaph_rules_forbid_inventing_archived():
    assert "Only say it was archived if the facts say so" in _all_text(epitaph_messages(facts(), ""))



def test_facts_sheet_formats_big_numbers():
    text = _all_text(epitaph_messages(facts(), ""))
    assert "Stars: 25,000; forks (heirs): 3,000" in text and "Commits: 2,280" in text


def test_epitaph_messages_in_spanish():
    assert "Write every field in Spanish" in _all_text(epitaph_messages(facts(), "", lang="es"))
    assert "Spanish" not in _all_text(epitaph_messages(facts(), ""))


def test_oracle_messages_in_spanish():
    messages = oracle_messages(facts(), "Aquí yace.", [], [], "¿Cómo moriste?", lang="es")
    assert "Always answer in Spanish" in messages[0]["content"]
    assert "Los espíritus callan sobre eso." in messages[0]["content"]
    assert "Answer in Spanish" in messages[-1]["content"]


def test_facts_sheet_says_plainly_when_never_archived():
    alive_on_github = facts()
    alive_on_github.archived = False
    text = _all_text(epitaph_messages(alive_on_github, ""))
    assert "never archived on GitHub" in text