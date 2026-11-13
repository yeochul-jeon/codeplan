# codeplan

[English](README.md) · 한국어

codeplan은 저장소의 계획을 코드 옆에 두고, part와 어느 part가 어느 part를
쓰는지, part를 거치는 scenario를 보여 주는 page를 씁니다. page는 계획에
적은 task도 나열하고, task마다 상태와 만들 파일 가운데 있는 파일 수를
보여 줍니다. 계획 파일이 최신
상태가 아니면 `check` 명령이 0이 아닌 코드로 끝납니다. `check`는 CI에서
돌려 pull request를 막을 수도 있고, CI 없이 pre-push 훅에서나 정해진
주기로 돌릴 수도 있습니다.

계획에는 두 가지 내용이 있습니다. 사람이 쓰는 것: 저장소를 part로 나눈
것과 각 part의 이름과 설명, 어느 part가 어느 part를 쓰는지, part가 쓰는
바깥 시스템(external), 요청 하나를 part를 거쳐 따라가는 scenario, 그리고
task(상태와 만들 파일을 적은 일 단위). 도구가
세는 것: 각 part가 가진 파일과 줄 수이며, 계획 파일의 glob 패턴으로
셉니다. 이 둘로 codeplan은 HTML page 하나를 씁니다. 이 page는 part를
그리고, 읽는 사람이 scenario를 한 step씩 넘겨 볼 수 있게 합니다.

`check`는 감시하는 파일이 어느 part에도 속하지 않을 때, 두 part가 같은
파일을 같은 강도로 가질 때, 코드가 감시 범위 밖에 있을 때, 계획 파일에
오류가 있을 때, page가 계획 파일과 코드에 더 이상 맞지 않을 때
실패합니다. `check`를 CI에서 돌리면 계획은 그것을 바꾸는 코드와 같은 pull
request에서 검토됩니다.

codeplan은 JavaScript와 TypeScript, 그리고 Java와 Kotlin(MyBatis mapper
XML 포함)에서 동작합니다. `codeplan.mjs` 파일 하나이고 Node 22 이상만
있으면 됩니다. 저장소의 의존성에는 아무것도 설치되지 않습니다.

아이디어는 almendili의 architecture-map에서 영감을 받았습니다.

## 빠른 시작

이 저장소를 `/path/to/codeplan`에 체크아웃해 두고, 계획을 만들 저장소에서
다음을 실행합니다:

```sh
mkdir -p docs/codeplan
cp /path/to/codeplan/skill/codeplan/codeplan.mjs docs/codeplan/codeplan.mjs
node docs/codeplan/codeplan.mjs draft > codeplan-draft.json
node -e '
const fs = require("fs");
const draft = JSON.parse(fs.readFileSync("codeplan-draft.json", "utf8"));
const config = fs.existsSync("codeplan.json") ? JSON.parse(fs.readFileSync("codeplan.json", "utf8")) : {};
for (const key of ["languages", "watch", "roots"]) delete config[key];
fs.writeFileSync("docs/codeplan/plan.json", JSON.stringify(draft.plan, null, 2) + "\n");
fs.writeFileSync("codeplan.json", JSON.stringify({ ...config, ...draft.config }, null, 2) + "\n");
'
rm codeplan-draft.json
node docs/codeplan/codeplan.mjs update
node docs/codeplan/codeplan.mjs check
```

`draft`는 디렉터리에서(Java에서는 모듈과 패키지에서) part를 제안하고 계획
파일과 설정 파일을 출력합니다. `draft`와 `update` 사이에
`docs/codeplan/plan.json`에서 part에 이름과 설명을 붙이고 `uses`,
external, scenario를 더합니다.
[계획 파일 참고 문서](skill/codeplan/docs/plan-file.md)를 보십시오. 그런
다음 브라우저에서 `docs/codeplan/codeplan.html`을 엽니다.

`node docs/codeplan/codeplan.mjs summary`는 같은 계획을 mermaid
다이어그램이 든 Markdown으로 출력합니다. pull request나 README에 쓸 수
있습니다.

## 계획한 저장소에 커밋하는 파일

| 파일 | 무엇인지 |
|---|---|
| `docs/codeplan/codeplan.mjs` | 도구 |
| `docs/codeplan/plan.json` | 계획 파일 |
| `codeplan.json` | 설정 파일(기본값이 맞으면 없어도 됩니다) |
| `docs/codeplan/codeplan.html` | page |

page는 `update`가 만들지만, `check`가 page를 `update`가 쓸 내용과 바이트
단위로 비교하므로 page도 커밋합니다. page에는 시간도 절대 경로도 들어
있지 않아서 어느 컴퓨터에서나 같은 바이트가 쓰입니다.

## CI에서

```yaml
name: codeplan
on:
  pull_request:
  push:
    branches: [main]
jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - name: Check out the code
        uses: actions/checkout@v7
      - name: Set up Node
        uses: actions/setup-node@v7
        with:
          node-version: 22
      - name: Check the plan
        run: node docs/codeplan/codeplan.mjs check
```

종료 코드 1은 계획이 코드에 비해 최신 상태가 아니라는 뜻입니다. orphan,
contested, unwatched 파일이 있거나, 계획 파일에 경고가 있거나, `update`가
바꿀 page가 있습니다. `update`를 실행하고 나열된 문제를 고친 뒤
커밋합니다. 종료 코드 2는 설정 파일이나 계획 파일을 쓸 수 없거나 계획
파일에 오류가 있다는 뜻입니다.

pull request에서는 `report`가 계획이 어떤 상태인지와 그 pull request가
어느 part를 바꿨는지를 job summary에 넣을 Markdown으로 씁니다. 그
워크플로는 [CI 참고 문서](skill/codeplan/docs/ci.md)에 있습니다.

## CI 없이

CI가 없거나 CI를 바꿀 수 없는 곳에서는 계획이 최신 상태가 아닌 pull
request를 아무것도 막지 않습니다. 그래도 `check`는 자기 복제본의 pre-push
훅에서나 정해진 주기로 돌릴 수 있습니다. `update`와 `summary`는 CI나 훅
없이 언제든 돌릴 수 있습니다.
정해진 주기로 도는 스크립트는 실행마다 기록 하나를 남길 수 있고,
`history`는 그 기록들로 HTML 파일 하나를 만듭니다.
[CI 없이 쓰기 참고 문서](skill/codeplan/docs/without-ci.md)를 보십시오.

## Claude Code 스킬로

`skill/codeplan`은 스킬 폴더입니다. `SKILL.md`는 에이전트에게 계획을
만들고 유지하는 방법을 알려 주고, `codeplan.mjs`는 에이전트가 저장소에
복사하는 도구입니다. 이 폴더를 스킬 디렉터리에 복사하거나 링크합니다.
예:

```sh
cp -R /path/to/codeplan/skill/codeplan ~/.claude/skills/codeplan
```

## 참고 문서

- [언어](skill/codeplan/docs/languages.md)
- [설정 파일](skill/codeplan/docs/config.md)
- [어느 part가 파일을 갖는지](skill/codeplan/docs/ownership.md)
- [계획 파일](skill/codeplan/docs/plan-file.md)
- [진단](skill/codeplan/docs/diagnostics.md)
- [명령](skill/codeplan/docs/commands.md)
- [page](skill/codeplan/docs/page.md)
- [draft](skill/codeplan/docs/draft.md)
- [summary](skill/codeplan/docs/summary.md)
- [CI](skill/codeplan/docs/ci.md)
- [CI 없이](skill/codeplan/docs/without-ci.md)
- [history](skill/codeplan/docs/history.md)

## 알려진 제한

- part 사이의 선은 사람이 계획 파일에 쓴 uses입니다. `.java` 파일에서 한
  part의 파일이 다른 part의 파일을 import하는데 계획에 use가 없으면
  `check`가 info 줄로 알립니다. 다른 언어의 import는 읽지 않습니다.
- scenario는 손으로 한 step씩 넘깁니다. 자동 재생은 없습니다.
- 테마 선택은 page가 아니라 브라우저마다 저장됩니다.
- 이름에 역슬래시가 든 파일은 `start`로 쓸 수 없습니다.
- `draft`는 설정 파일의 `roots`를 glob이 아니라 일반 경로로만 읽습니다.
- page는 밖에서 아무것도 불러오지 않고 절대 경로나 시간이 들어 있지
  않습니다.

## codeplan 개발

```sh
npm ci
npm run typecheck
npm test
npm run build
```

`npm run build`는 `skill/codeplan/codeplan.mjs`를 씁니다. CI는 커밋된
파일이 새로 빌드한 결과와 바이트 단위로 같은지 확인합니다
(`npm run check:bundle`).

## 라이선스

MIT. [LICENSE](LICENSE)를 보십시오.
