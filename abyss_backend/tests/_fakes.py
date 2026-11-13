"""Minimal stand-ins for an AsyncSession in unit tests (no database)."""


class FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class FakeSession:
    """Answers every execute() with the same scalar."""

    def __init__(self, value):
        self.value = value
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return FakeResult(self.value)
