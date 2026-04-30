/**
 * union-cli JS Provider 데모 모듈.
 *
 * union-cli JS provider 는 args 와 flags 를 병합한 단일 객체를 인자로 전달합니다.
 * 따라서 함수는 destructuring 패턴으로 인자를 받습니다.
 */

export interface BinaryOpInput {
  a: number
  b: number
}

export interface NumbersInput {
  numbers: number[] | string
}

/** 두 수를 더합니다. */
export function add({a, b}: BinaryOpInput): number {
  return Number(a) + Number(b)
}

/** 두 수를 곱합니다. */
export function multiply({a, b}: BinaryOpInput): number {
  return Number(a) * Number(b)
}

/**
 * 숫자 배열의 합을 반환합니다.
 *
 * `httpBodyType: number-array` 가 적용되면 ``"1,2,3"`` 같은 문자열도 자동으로
 * ``[1, 2, 3]`` 로 변환됩니다. 안전을 위해 string 입력도 한 번 더 처리합니다.
 */
export function sum({numbers}: NumbersInput): number {
  const arr = typeof numbers === 'string'
    ? numbers.split(',').map((n) => Number(n.trim()))
    : numbers
  return arr.reduce((acc, n) => acc + Number(n), 0)
}
