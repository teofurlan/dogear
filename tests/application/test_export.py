import pytest

from dogear.application.export import export_markdown


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
