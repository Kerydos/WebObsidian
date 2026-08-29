// 새 노트·폴더 이름이 이미 사용 중이면 뒤에 번호를 붙여 고유한 이름을 만든다.
export function uniqueBaseName(taken: Set<string>, base: string, suffix: string) {
  if (!taken.has(`${base}${suffix}`)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${index}`;
    if (!taken.has(`${candidate}${suffix}`)) return candidate;
  }
}

// 일일 노트의 기본 이름(MMDD_기록)을 만든다.
export function dailyNoteBaseName(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}${day}_기록`;
}
