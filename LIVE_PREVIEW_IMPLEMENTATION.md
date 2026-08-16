# WebObsidian 라이브 프리뷰(Live Preview) 실시간 서식 변환 기술 가이드

본 문서는 웹 브라우저에서 마크다운을 입력할 때 분할 화면(Split View) 없이 **편집 화면 자체에서 즉시 마크다운 서식이 적용(In-place Rendering)되는 기능**의 구현 가능 여부, 작동 원리 및 3가지 기술적 접근 방식을 다룹니다.

---

## 1. 결론: 구현 가능 여부

**네, 완벽하게 가능합니다.**
실제 데스크톱 **옵시디언(Obsidian v0.13+)의 '라이브 프리뷰(Live Preview)' 기능 자체가 웹 기술(CodeMirror 6 기반)**로 만들어져 있으며, 현대 브라우저 환경에서 동일한 원리로 100% 구현할 수 있습니다.

---

## 2. 라이브 프리뷰(Live Preview)의 핵심 작동 원리

마크다운을 즉시 적용하는 방식은 크게 **"커서 기반 데코레이션(Cursor-aware Decoration)"** 기법을 사용합니다.

```
[사용자 입력 상태]
1. 사용자가 `**중요한 내용**`을 입력
2. 커서가 해당 단어를 벗어남 (Focus Out)
   ➔ `**` 기호가 화면에서 숨겨지고(Hidden), 텍스트는 **중요한 내용** (Bold) 스타일로 즉시 렌더링
3. 사용자가 마우스로 클릭하거나 방향키로 해당 단어 안으로 이동 (Focus In)
   ➔ 숨겨졌던 `**` 기호가 다시 나타나며 `**중요한 내용**` 원본 수정 모드로 전환
```

---

## 3. 웹에서 구현하는 3가지 대표 엔진 비교

| 비교 항목 | 1. CodeMirror 6 (옵시디언 방식 - 추천) | 2. Milkdown (ProseMirror 기반) | 3. Vditor (Typora 스타일) |
| :--- | :--- | :--- | :--- |
| **데이터 원본** | 100% 순수 플레인 마크다운 텍스트 | 내부 AST 노드 ➔ 마크다운 변환 | 마크다운 텍스트 / DOM 믹스 |
| **작동 메커니즘** | ViewPlugin + RangeSet + Replace Decoration | InputRules + 리치 텍스트 노드 변환 | Instant Rendering (IR) 모드 엔진 |
| **성능 (대용량)** | 매우 뛰어남 (가상 뷰포트 렌더링) | 보통 (대용량 문서 시 메모리 소모) | 양호 |
| **옵시디언 유사도** | 100% 동일 (옵시디언 엔진 자체) | Notion / Logseq 스타일 혼합 | Typora와 유사 |
| **구현 난이도** | 중상 (확장 플러그인 구성 필요) | 중 (플러그인 생태계 활용) | 낮음 (라이브러리 즉시 임포트) |

---

## 4. CodeMirror 6 기반 실시간 인라인 서식 렌더링 코드

CodeMirror 6의 `syntaxTree`와 `Decoration.replace`를 사용하여 `**볼드**`, `# 제목`, `- [ ] 체크박스`를 입력 즉시 실시간 렌더링하는 핵심 구현 예제입니다.

```typescript
// src/components/editor/extensions/livePreviewExtension.ts
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      // 문서 내용이 변경되거나 커서 위치(selection)가 바뀔 때마다 데코레이션 재계산
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const cursor = view.state.selection.main.head;

      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            const nodeFrom = node.from;
            const nodeTo = node.to;
            const isCursorInside = cursor >= nodeFrom && cursor <= nodeTo;

            // 1. 헤딩 (# Heading 1) 실시간 서식 적용
            if (node.name.startsWith('ATXHeading')) {
              const level = parseInt(node.name.replace('ATXHeading', ''), 10) || 1;
              const fontSize = 2.2 - level * 0.2; // H1: 2.0rem, H2: 1.8rem 등
              
              builder.add(
                nodeFrom,
                nodeTo,
                Decoration.line({
                  attributes: {
                    style: `font-size: ${fontSize}rem; font-weight: 700; color: #f8fafc; line-height: 1.3;`,
                  },
                })
              );

              // 커서가 없는 라인에서는 '#' 기호 숨김
              if (!isCursorInside) {
                const headerMark = node.node.firstChild;
                if (headerMark && headerMark.name === 'HeaderMark') {
                  builder.add(
                    headerMark.from,
                    headerMark.to + 1, // '#' 및 뒤 공백 포함
                    Decoration.replace({})
                  );
                }
              }
            }

            // 2. 볼드체 (**굵은 글씨**) 실시간 적용
            if (node.name === 'Emphasis' || node.name === 'StrongEmphasis') {
              if (!isCursorInside) {
                // 커서가 없을 때: 마크다운 기호(**)를 숨기고 굵은 글씨 적용
                builder.add(
                  nodeFrom,
                  nodeTo,
                  Decoration.mark({
                    attributes: { style: 'font-weight: bold; color: #38bdf8;' },
                  })
                );
              }
            }

            // 3. 인라인 코드 (`code`) 실시간 적용
            if (node.name === 'InlineCode') {
              if (!isCursorInside) {
                builder.add(
                  nodeFrom,
                  nodeTo,
                  Decoration.mark({
                    attributes: {
                      style: 'background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-family: monospace;',
                    },
                  })
                );
              }
            }
          },
        });
      }

      return builder.finish();
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
```

---

## 5. 실시간 인터랙티브 위젯 (체크박스, 수식, 위키링크)

인라인 텍스트 서식 외에도 마크다운 특수 요소를 클릭 가능한 HTML 위젯으로 실시간 치환할 수 있습니다:

1. **체크박스 (`- [ ]`, `- [x]`)**:
   - `Decoration.replace`로 `[ ]` 텍스트를 실제 HTML `<input type="checkbox">` 엘리먼트로 치환.
   - 브라우저에서 체크박스를 클릭하면 백그라운드 텍스트가 `- [ ]` ↔ `- [x]`로 즉시 변경되도록 이벤트 바인딩.
2. **수식 (`$E=mc^2$`)**:
   - 커서가 벗어나면 KaTeX 렌더러를 호출하여 실시간 수학 수식 렌더링.
3. **위키링크 (`[[Note]]`)**:
   - 클릭 가능한 보라색 뱃지 위젯으로 치환되어 클릭 시 해당 노트로 즉시 이동.
