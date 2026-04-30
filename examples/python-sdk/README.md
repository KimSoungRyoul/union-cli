# python-sdk

> union-cli **Python provider** 데모 — `numpy` 기반 통계 함수를 CLI 로 노출.

## 무엇을 보여주는가

- `provider.type: python` 로 Python 함수를 JSON-RPC over stdio 로 호출
- `persistent: true` 로 python3 프로세스 재사용 (cold-start 제거)
- `httpBodyType: number-array` 로 `--numbers 1,2,3,4,5` 같은 콤마 입력을 자동으로 `[1,2,3,4,5]` 로 파싱
- 외부 의존성을 `requirements.txt` (`numpy`) 로 분리

## Prerequisites

- Node.js 18 이상
- Python 3.10 이상 (`python3 --version`)
- `pip` 또는 `uv`

## 빌드 & 실행

### 1. Python 환경 준비

```bash
# venv 생성 + 의존성 설치
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# (선택) Python 모듈만 단독으로 동작 검증
python -c "from python_module.stats import describe; print(describe([1,2,3,4,5]))"
# -> {'mean': 3.0, 'std': 1.4142135623730951, 'min': 1.0, 'max': 5.0, 'count': 5}
```

> Python provider 는 manifest 의 `venv` 옵션으로 명시적인 venv 경로를 지정하거나,
> 활성화된 venv (`source .venv/bin/activate`) 의 `python3` 를 자동으로 사용합니다.

### 2. Node 환경 준비 + 빌드

```bash
npm install
npm run build
# -> 2 commands generated
```

### 3. 실행

```bash
npx stats --help
npx stats stats numbers describe --numbers 1,2,3,4,5 --json
npx stats stats numbers percentile --numbers 10,20,30,40,50 --p 90 --json
```

개발 모드:

```bash
./bin/dev.js stats numbers describe --numbers 1,2,3,4,5 --json
```

## Expected Output

```bash
$ npx stats stats numbers describe --numbers 1,2,3,4,5 --json
{
  "mean": 3.0,
  "std": 1.4142135623730951,
  "min": 1.0,
  "max": 5.0,
  "count": 5
}
```

전체 출력은 [expected-output.txt](./expected-output.txt) 참고.

## 구조

```
python-sdk/
  python_module/
    __init__.py
    stats.py          # describe, percentile 함수
  plugins/
    stats.yaml        # union-cli manifest
  requirements.txt    # numpy
  package.json        # union-cli 의존성 (file:../..)
```

## 동작 원리

1. union-cli 가 manifest 를 읽고 `provider.type: python` 임을 인식
2. `python_module.stats` 모듈을 import 한 python3 프로세스를 spawn
3. 사용자가 `stats numbers describe --numbers 1,2,3` 을 실행하면
   - flags 가 `httpBodyType: number-array` 에 따라 `[1, 2, 3]` 으로 변환
   - `{"function": "describe", "kwargs": {"numbers": [1,2,3]}}` JSON-RPC 요청 송신
   - python 측에서 `describe(numbers=[1,2,3])` 호출 후 결과를 stdout 으로 반환
4. union-cli 가 결과를 `--json` / `--format yaml` 등으로 포매팅하여 표시

## 참고

- Python provider 구현: [src/providers/python/](../../src/providers/python/)
- JSON-RPC 브릿지 스크립트: [bridge/union_cli_bridge.py](../../bridge/union_cli_bridge.py)
- manifest 검증 (Wave 3 E2E) 에서 4종 example 모두 빌드 + smoke test 가 자동화될 예정입니다.
