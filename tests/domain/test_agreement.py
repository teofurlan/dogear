from dogear.domain.agreement import compare


def test_identical_readings_agree():
    result = compare("one two three four", "one two three four")

    assert result.agrees
    assert result.missing == []
    assert result.extra == []


def test_the_model_text_is_kept():
    result = compare("one tvvo three", "One two three.")

    assert result.text == "One two three."


def test_ocr_letter_errors_are_not_disagreement():
    # OCR misreads letters inside words; the model's spelling of the same word wins.
    result = compare("the rnountain was clear", "the mountain was clear")

    assert result.agrees


def test_punctuation_and_case_are_ignored():
    assert compare("Hello, world.", "hello world").agrees


def test_words_the_model_dropped_are_reported():
    result = compare("one two three four five six", "one two five six")

    assert not result.agrees
    assert result.missing == ["three", "four"]


def test_words_the_model_added_are_reported():
    result = compare("one two five six", "one two three four five six")

    assert not result.agrees
    assert result.extra == ["three", "four"]


def test_a_single_stray_ocr_token_does_not_flag():
    # OCR often adds one garbage token near the margin; one word alone is tolerated.
    assert compare("one two three ** four five", "one two three four five").agrees


def test_words_merged_or_split_differently_still_agree():
    # OCR often glues or splits short words; the letters are the same.
    assert compare("fuimos ala playa", "fuimos a la playa").agrees
    assert compare("un ejem plo claro", "un ejemplo claro").agrees
