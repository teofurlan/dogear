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
    # Sort books by title order (case-insensitive or natural string ordering)
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
        parts = [f"# {book['title']}"]
        if book.get("author"):
            parts.append(book["author"])
        
        quote_blocks = [format_quote_markdown(q["text"]) for q in quotes]
        # Quotes grouped under book title/author separated by blank lines
        body = "\n\n".join(quote_blocks)
        parts.append("")
        parts.append(body)
        sections.append("\n".join(parts[:2]) + "\n\n" + body if book.get("author") else f"# {book['title']}\n\n{body}")

    return "\n\n".join(sections) + "\n"
