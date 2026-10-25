"""Formatting kept quotes as Markdown or CSV export."""

import csv
import io
from typing import Any

_INJECTION_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def sanitize_csv_cell(value: str | None) -> str:
    """Neutralize spreadsheet formula injection by prefixing a single quote."""
    if not value:
        return ""
    if value.startswith(_INJECTION_PREFIXES):
        return f"'{value}"
    return value


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


def export_csv(book_quotes: list[dict[str, Any]]) -> str:
    """Format a list of {"book": {...}, "quotes": [...]} into CSV with UTF-8 BOM.

    Header row is title,author,quote. Books are sorted by title order, matching
    Markdown export. Quotes are rendered in their stored order. Pending quotes
    are excluded.
    """
    output = io.StringIO()
    output.write("\ufeff")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(["title", "author", "quote"])

    entries = []
    for bq in book_quotes:
        kept_quotes = [q for q in bq.get("quotes", []) if q.get("status") != "pending"]
        if kept_quotes:
            entries.append({"book": bq["book"], "quotes": kept_quotes})

    sorted_books = sorted(
        entries,
        key=lambda bq: bq["book"]["title"].lower() if bq["book"].get("title") else "",
    )

    for entry in sorted_books:
        book = entry["book"]
        title = sanitize_csv_cell(book.get("title"))
        author = sanitize_csv_cell(book.get("author"))
        for quote in entry["quotes"]:
            quote_text = sanitize_csv_cell(quote.get("text"))
            writer.writerow([title, author, quote_text])

    return output.getvalue()

