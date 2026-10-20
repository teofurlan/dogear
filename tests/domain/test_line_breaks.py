from dogear.domain.passages import rejoin_line_breaks


def test_a_word_ocr_saw_split_at_a_line_end_is_rejoined():
    assert rejoin_line_breaks("Ellos han cami-nado mucho", ["Ellos", "han", "cami-", "nado", "mucho"]) == (
        "Ellos han caminado mucho"
    )


def test_accents_and_case_do_not_block_the_rejoin():
    assert rejoin_line_breaks("ha-bía llovido", ["ha-", "bia", "llovido"]) == "había llovido"


def test_a_real_hyphenated_word_is_kept():
    # OCR saw it as one token on one line, so the hyphen belongs to the word.
    assert rejoin_line_breaks("un acuerdo franco-alemán", ["un", "acuerdo", "franco-alemán"]) == (
        "un acuerdo franco-alemán"
    )


def test_whitespace_from_the_model_is_normalized():
    assert rejoin_line_breaks("one\ntwo   three", ["one", "two", "three"]) == "one two three"


def test_a_hyphen_left_before_a_space_is_rejoined():
    assert rejoin_line_breaks("la ven- tana abierta", ["la", "ven-", "tana", "abierta"]) == "la ventana abierta"


def test_a_dangling_hyphen_before_a_lowercase_word_is_a_line_break_even_without_ocr():
    assert rejoin_line_breaks("los ár- boles crecen", ["los", "crecen"]) == "los árboles crecen"


def test_a_spaced_dash_is_punctuation():
    assert rejoin_line_breaks("uno - dos", []) == "uno - dos"
