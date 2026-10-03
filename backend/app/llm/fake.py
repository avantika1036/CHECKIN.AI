"""A scripted stand-in for a real model, used by tests (and by `LLM_PROVIDER=none` dev runs).

Give it a list of answers; each call returns the next one. An Exception in the list is raised.
"""
import json

from pydantic import BaseModel


class FakeProvider:
    name = "fake"

    def __init__(self, script):
        self.script = list(script) if isinstance(script, (list, tuple)) else script
        self.calls: list[dict] = []

    def generate_json(self, system: str, user: str, schema: type[BaseModel]) -> str:
        self.calls.append({"system": system, "user": user})
        item = self.script(user) if callable(self.script) else self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item if isinstance(item, str) else json.dumps(item)
