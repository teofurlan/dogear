"""Formatting kept quotes as Markdown export."""

from typing import Any


def format_quote_markdown(text: str) -> str:
    """Format a single quote as a Markdown blockquote, prepending `>` to every line."""
    lines = text.split("\n")
    formatted_lines = [f"> {line}" if line else ">" for line in lines]
    return "\n".join(formatted_lines)


def export_markdown(book_quotes: list[dict[str, Any]]) -> str:
    """Format a list of {"book": {...}, "quotes": [...]} into Markdown.

    Books are sorted by title order. Quotes are rendered in their stored order.
    Only books that have quotes should be included.
    """
    sorted_books = sorted(
        [bq for bq in book_quotes if bq.get("quotes")],
        key=lambda bq: bq["book"]["title"].lower() if bq["book"].get("title") else "",
    )

    if not sorted_books:
        return ""

    sections = []
    for entry in sorted_books:
        book = entry["book"]
        quotes = entry["quotes"]
        header = f"# {book['title']}\n{book['author']}" if book.get("author") else f"# {book['title']}"
        body = "\n\n".join(format_quote_markdown(q["text"]) for q in quotes)
        sections.append(f"{header}\n\n{body}")

    return "\n\n".join(sections) + "\n"
