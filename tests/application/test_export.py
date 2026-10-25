import pytest

from dogear.application.export import export_csv, export_markdown


def test_empty_export():
    assert export_markdown([]) == ""


def test_single_book_without_author():
    books = [
        {
            "book": {"id": "b1", "title": "The Hobbit", "author": None},
            "quotes": [
                {"id": "q1", "text": "In a hole in the ground there lived a hobbit."}
            ],
        }
    ]
    expected = (
        "# The Hobbit\n\n"
        "> In a hole in the ground there lived a hobbit.\n"
    )
    assert export_markdown(books) == expected


def test_single_book_with_author():
    books = [
        {
            "book": {"id": "b1", "title": "The Hobbit", "author": "J.R.R. Tolkien"},
            "quotes": [
                {"id": "q1", "text": "In a hole in the ground there lived a hobbit."}
            ],
        }
    ]
    expected = (
        "# The Hobbit\n"
        "J.R.R. Tolkien\n\n"
        "> In a hole in the ground there lived a hobbit.\n"
    )
    assert export_markdown(books) == expected


def test_multiline_quotes_get_blockquote_on_every_line():
    books = [
        {
            "book": {"id": "b1", "title": "Poems", "author": "Ada"},
            "quotes": [
                {"id": "q1", "text": "Line one\nLine two\n\nLine three"}
            ],
        }
    ]
    expected = (
        "# Poems\n"
        "Ada\n\n"
        "> Line one\n"
        "> Line two\n"
        ">\n"
        "> Line three\n"
    )
    assert export_markdown(books) == expected


def test_multiple_quotes_in_stored_order_separated_by_blank_line():
    books = [
        {
            "book": {"id": "b1", "title": "A Book", "author": "Author"},
            "quotes": [
                {"id": "q1", "text": "First quote."},
                {"id": "q2", "text": "Second quote."},
            ],
        }
    ]
    expected = (
        "# A Book\n"
        "Author\n\n"
        "> First quote.\n\n"
        "> Second quote.\n"
    )
    assert export_markdown(books) == expected


def test_multiple_books_sorted_by_title_and_separated_by_blank_line():
    books = [
        {
            "book": {"id": "b2", "title": "Zebra", "author": "Zoey"},
            "quotes": [{"id": "q1", "text": "Zebra quote."}],
        },
        {
            "book": {"id": "b1", "title": "Ant", "author": "Andy"},
            "quotes": [{"id": "q2", "text": "Ant quote."}],
        },
    ]
    expected = (
        "# Ant\n"
        "Andy\n\n"
        "> Ant quote.\n\n"
        "# Zebra\n"
        "Zoey\n\n"
        "> Zebra quote.\n"
    )
    assert export_markdown(books) == expected


def test_csv_empty_export():
    assert export_csv([]) == "\ufefftitle,author,quote\r\n"


def test_csv_single_book_without_author():
    books = [
        {
            "book": {"id": "b1", "title": "The Hobbit", "author": None},
            "quotes": [
                {"id": "q1", "text": "In a hole in the ground there lived a hobbit."}
            ],
        }
    ]
    expected = (
        "\ufefftitle,author,quote\r\n"
        "The Hobbit,,In a hole in the ground there lived a hobbit.\r\n"
    )
    assert export_csv(books) == expected


def test_csv_single_book_with_author():
    books = [
        {
            "book": {"id": "b1", "title": "The Hobbit", "author": "J.R.R. Tolkien"},
            "quotes": [
                {"id": "q1", "text": "In a hole in the ground there lived a hobbit."}
            ],
        }
    ]
    expected = (
        "\ufefftitle,author,quote\r\n"
        "The Hobbit,J.R.R. Tolkien,In a hole in the ground there lived a hobbit.\r\n"
    )
    assert export_csv(books) == expected


def test_csv_quoting_commas_and_double_quotes():
    books = [
        {
            "book": {"id": "b1", "title": "War, Peace, and More", "author": 'Leo "Tolstoy"'},
            "quotes": [
                {"id": "q1", "text": 'He said, "Truth is elusive", and wept.'}
            ],
        }
    ]
    expected = (
        "\ufefftitle,author,quote\r\n"
        '"War, Peace, and More","Leo ""Tolstoy""","He said, ""Truth is elusive"", and wept."\r\n'
    )
    assert export_csv(books) == expected


def test_csv_multiline_quotes():
    books = [
        {
            "book": {"id": "b1", "title": "Poems", "author": "Ada"},
            "quotes": [
                {"id": "q1", "text": "Line one\nLine two\n\nLine three"}
            ],
        }
    ]
    expected = (
        "\ufefftitle,author,quote\r\n"
        "Poems,Ada,\"Line one\nLine two\n\nLine three\"\r\n"
    )
    assert export_csv(books) == expected


def test_csv_formula_injection_neutralization():
    books = [
        {
            "book": {"id": "b1", "title": "=SUM(A1:B2)", "author": "+1234567"},
            "quotes": [
                {"id": "q1", "text": "-10 percent discount"},
                {"id": "q2", "text": "@handle with care"},
                {"id": "q3", "text": "\tindented quote"},
                {"id": "q4", "text": "\rreturn quote"},
            ],
        }
    ]
    res = export_csv(books)
    # Each injected cell should be prefixed with a single quote character (')
    assert "'=SUM(A1:B2)" in res
    assert "'+1234567" in res
    assert "'-10 percent discount" in res
    assert "'@handle with care" in res
    assert "'\tindented quote" in res
    assert "'\rreturn quote" in res


def test_csv_utf8_bom():
    books = [
        {
            "book": {"id": "b1", "title": "Crónica", "author": "García Márquez"},
            "quotes": [{"id": "q1", "text": "El coronel no tiene quien le escriba."}],
        }
    ]
    csv_str = export_csv(books)
    assert csv_str.startswith("\ufeff")
    encoded = csv_str.encode("utf-8")
    assert encoded.startswith(b"\xef\xbb\xbf")


def test_csv_pending_quotes_are_excluded():
    books = [
        {
            "book": {"id": "b1", "title": "Book One", "author": "Author A"},
            "quotes": [
                {"id": "q1", "text": "Kept quote", "status": "kept"},
                {"id": "q2", "text": "Pending quote", "status": "pending"},
            ],
        },
        {
            "book": {"id": "b2", "title": "Book Two", "author": "Author B"},
            "quotes": [
                {"id": "q3", "text": "Only pending quote", "status": "pending"},
            ],
        },
    ]
    csv_str = export_csv(books)
    assert "Kept quote" in csv_str
    assert "Pending quote" not in csv_str
    assert "Book Two" not in csv_str


def test_csv_multiple_books_sorted_and_stored_order_quotes():
    books = [
        {
            "book": {"id": "b2", "title": "Zebra", "author": "Zoey"},
            "quotes": [
                {"id": "q1", "text": "Zebra quote 1"},
                {"id": "q2", "text": "Zebra quote 2"},
            ],
        },
        {
            "book": {"id": "b1", "title": "Ant", "author": "Andy"},
            "quotes": [{"id": "q3", "text": "Ant quote"}],
        },
    ]
    expected = (
        "\ufefftitle,author,quote\r\n"
        "Ant,Andy,Ant quote\r\n"
        "Zebra,Zoey,Zebra quote 1\r\n"
        "Zebra,Zoey,Zebra quote 2\r\n"
    )
    assert export_csv(books) == expected

