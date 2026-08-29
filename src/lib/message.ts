// 사용자에게 보여 줄 오류 메시지를 추출한다. 폴더 선택 취소는 오류가 아니므로 안내 문구로 바꾼다.
export function messageOf(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return '폴더 선택을 취소했습니다.';
  return error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
}
