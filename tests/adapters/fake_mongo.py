"""A tiny in-memory pymongo collection: only the operators the adapters use."""

from copy import deepcopy
from types import SimpleNamespace

from bson import ObjectId


def _matches(row, query):
    for key, want in query.items():
        if key == "$or":
            if not any(_matches(row, branch) for branch in want):
                return False
            continue
        have = row.get(key)
        if isinstance(want, dict):
            for op, value in want.items():
                ok = {
                    "$in": lambda: have in value,
                    "$nin": lambda: have not in value,
                    "$lt": lambda: have is not None and have < value,
                    "$gt": lambda: have is not None and have > value,
                }[op]()
                if not ok:
                    return False
        elif have != want:
            return False
    return True


def _project(row, projection):
    row = deepcopy(row)
    for field, keep in (projection or {}).items():
        if not keep:
            row.pop(field, None)
    return row


class Cursor:
    def __init__(self, rows, projection):
        self.rows, self.projection = rows, projection

    def sort(self, spec, direction=None):
        for field, way in reversed(spec if direction is None else [(spec, direction)]):
            self.rows.sort(key=lambda row: row[field], reverse=way < 0)
        return self

    def limit(self, count):
        self.rows = self.rows[:count]
        return self

    def __iter__(self):
        return iter(_project(row, self.projection) for row in self.rows)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


class FakeCollection:
    def __init__(self):
        self.rows = []

    def _apply(self, row, update):
        row.update(deepcopy(update.get("$set", {})))
        for field, amount in update.get("$inc", {}).items():
            row[field] = row.get(field, 0) + amount

    def insert_one(self, row):
        row = {"_id": ObjectId(), **deepcopy(row)}
        self.rows.append(row)
        return SimpleNamespace(inserted_id=row["_id"])

    def insert_many(self, rows):
        for row in rows:
            self.insert_one(row)

    def find(self, query, projection=None):
        return Cursor([r for r in self.rows if _matches(r, query)], projection)

    def find_one(self, query, projection=None):
        return next(iter(self.find(query, projection)), None)

    def find_one_and_update(self, query, update, sort=None, return_document=None):
        cursor = self.find(query)
        cursor.rows = [r for r in self.rows if _matches(r, query)]
        if sort:
            cursor.sort(sort)
        if not cursor.rows:
            return None
        row = cursor.rows[0]
        self._apply(row, update)
        return deepcopy(row)

    def update_one(self, query, update):
        for row in self.rows:
            if _matches(row, query):
                self._apply(row, update)
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)

    def delete_one(self, query):
        for row in self.rows:
            if _matches(row, query):
                self.rows.remove(row)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    def delete_many(self, query):
        before = len(self.rows)
        self.rows = [r for r in self.rows if not _matches(r, query)]
        return SimpleNamespace(deleted_count=before - len(self.rows))


class FakeDatabase(dict):
    def __missing__(self, name):
        self[name] = FakeCollection()
        return self[name]
