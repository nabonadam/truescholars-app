from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Table:
    """A publication (APA-style) table: the app renders it and exports it to Word/Excel."""

    title: str
    columns: list[str]
    rows: list[list[str]]
    note: str = ""
    # rows whose first cell is a group heading (e.g. a factor variable's name)
    groups: list[int] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"title": self.title, "columns": self.columns, "rows": self.rows, "note": self.note, "groups": self.groups}


@dataclass
class Result:
    log: str
    tables: list[Table] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)  # plain-English warnings (assumptions, small cells...)
    summary: dict = field(default_factory=dict)  # key numbers, for the AI's interpretation
    changes_data: bool = False
    images: list[dict] = field(default_factory=list)  # graphs: {"title", "png" (base64), "width", "height"}

    def as_dict(self) -> dict:
        return {
            "images": self.images,
            "log": self.log,
            "tables": [t.as_dict() for t in self.tables],
            "notes": self.notes,
            "summary": self.summary,
            "changesData": self.changes_data,
        }
