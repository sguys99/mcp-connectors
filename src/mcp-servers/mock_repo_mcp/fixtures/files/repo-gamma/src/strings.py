"""문자열 유틸 (sample fixture)."""


def slugify(value: str) -> str:
    # TODO: unicode normalization 추가
    return value.strip().lower().replace(" ", "-")
