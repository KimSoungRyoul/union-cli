"""union-cli Python Provider 데모 모듈.

`describe()` 는 numbers 리스트를 받아 기본 통계량(dict) 를 반환합니다.
union-cli Python Provider 가 JSON-RPC 로 이 함수를 호출하고, 결과를
`--json` / `--format yaml` 등으로 출력합니다.
"""
from __future__ import annotations

import numpy as np


def describe(numbers: list[float]) -> dict:
    """Return basic descriptive statistics for a list of numbers.

    Parameters
    ----------
    numbers : list[float]
        Input sequence of numeric values.

    Returns
    -------
    dict
        ``{"mean", "std", "min", "max", "count"}``
    """
    if not numbers:
        raise ValueError("numbers must be a non-empty list")

    arr = np.array(numbers, dtype=float)
    return {
        "mean": float(arr.mean()),
        "std": float(arr.std()),
        "min": float(arr.min()),
        "max": float(arr.max()),
        "count": int(len(arr)),
    }


def percentile(numbers: list[float], p: float = 50.0) -> float:
    """Return the p-th percentile of ``numbers`` (0 <= p <= 100)."""
    if not numbers:
        raise ValueError("numbers must be a non-empty list")
    return float(np.percentile(np.array(numbers, dtype=float), p))
