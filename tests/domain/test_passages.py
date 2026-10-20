from dogear.domain.passages import Box, Word, group_passages, join_hyphens


def word(text, coverage, x=0, line=(1, 1, 1)):
    return Word(text=text, box=Box(x, 0, 10, 10), confidence=90.0, line=line, coverage=coverage)


def texts(passages):
    return [p.text for p in passages]


def test_consecutive_highlighted_words_form_one_passage():
    words = [word("a", 0.0), word("one", 0.9), word("two", 0.8), word("three", 0.7), word("b", 0.0)]

    assert texts(group_passages(words)) == ["one two three"]


def test_a_word_counts_as_highlighted_from_a_quarter_of_coverage():
    words = [word("in", 0.25), word("also", 0.3), word("yes", 0.5), word("out", 0.24)]

    assert texts(group_passages(words)) == ["in also yes"]


def test_short_gaps_inside_a_passage_are_merged():
    # OCR boxes sometimes miss the highlight on a word or two in the middle of a passage.
    words = [word("one", 0.9), word("two", 0.9), word("gap", 0.1), word("three", 0.9), word("four", 0.9)]

    assert texts(group_passages(words)) == ["one two gap three four"]


def test_long_gaps_split_passages():
    words = [
        word("one", 0.9), word("two", 0.9), word("three", 0.9),
        word("x", 0.0), word("y", 0.0), word("z", 0.0),
        word("four", 0.9), word("five", 0.9), word("six", 0.9),
    ]

    assert texts(group_passages(words)) == ["one two three", "four five six"]


def test_runs_shorter_than_three_words_are_noise():
    words = [word("lone", 0.9), word("pair", 0.9), word("x", 0.0), word("y", 0.0), word("z", 0.0)]

    assert group_passages(words) == []


def test_passage_box_spans_all_its_words():
    words = [word("one", 0.9, x=0), word("two", 0.9, x=20), word("three", 0.9, x=40)]

    (passage,) = group_passages(words)

    assert passage.box == Box(0, 0, 50, 10)


def test_hyphenated_line_ends_are_joined():
    assert join_hyphens(["cami-", "nado", "con"]) == "caminado con"


def test_a_lone_dash_is_kept_as_punctuation():
    assert join_hyphens(["one", "-", "two"]) == "one - two"
