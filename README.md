# ARS 메뉴 테스트

`ARS변경내역_최종_0904.xlsx` 의 **27년최종ARS메뉴** 시트에서 테스트 시나리오를 뽑아,
휴대폰에서 전화를 걸며 ARS 메뉴 트리를 검증하는 **단일 HTML 도구**를 만든다.

- 시나리오 **101건** (대메뉴 10개, depth 1~3)
- 산출물은 `dist-single/ars-test.html` **파일 하나**. 서버·설치·네트워크가 필요 없다.
- 원본 xlsx 는 **읽기 전용**. 추출기가 실행 전후로 SHA-256 을 확인하고 달라지면 빌드를 멈춘다.

## 사용

```bash
npm install
npm run build     # → dist-single/ars-test.html
npm test          # 생성된 HTML 을 실제 DOM 에 올려 검증
```

만들어진 HTML 파일을 휴대폰으로 옮기면 끝이다(AirDrop·메신저·메일·드라이브 무엇이든).
iOS 는 **파일 앱**, Android 는 다운로드한 HTML을 **Chrome 등 외부 브라우저**로 연다. 파일 미리보기나 메신저 내장 뷰어에서는 전화 앱 실행이 제한될 수 있다.

## 동작 방식

메뉴 트리와 전화 링크를 **빌드 시점에 전부 HTML 로 찍어 둔다.**

| 기능 | 구현 | 스크립트 필요? |
|---|---|---|
| 대 → 중 → 소 메뉴 펼치기 | `<details>` | ❌ |
| 전화 걸기 | `<a href="tel:...">` | ❌ |
| 설정 반영 (대기시간·계좌번호·종목코드) | JS | ⭕ |
| 메뉴별 자동/직접입력 선택 | JS | ⭕ |
| PASS/FAIL 기록 · CSV | JS | ⭕ |

iOS 파일 앱 미리보기처럼 스크립트가 제한되는 환경에서도 메뉴와 전화는 그대로 동작한다.
그때는 `<noscript>` 안내가 뜨고, 계좌번호·종목코드는 통화 중에 직접 눌러야 한다.

## 다이얼 문자열

쉼표 1개가 약 2초 대기다. `#` 은 URL 프래그먼트 구분자라 `%23` 으로 인코딩해야 하며,
그대로 두면 뒤가 잘려 계좌번호까지만 전송된다.

```
tel:0263016001,,,,3,,1,,1,,,,12345678901%23,,,,0000,,,,005930%23
     ARS번호   초기 대 중 소   계좌번호  #    비번      종목코드 #
```

## 설정

기본 ARS 발신 번호는 `0263016001`이다. 개인 계좌번호는 저장소에 넣지 않는다. `config/ars.config.json`(gitignore)에
두면 빌드 시 구워지고, 없으면 `ars.config.sample.json` 의 기본 ARS 번호가 들어간다.

```bash
cp config/ars.config.sample.json config/ars.config.json
# number / credentials.accountNo.value / credentials.stockCode.value 를 채운 뒤 빌드
```

값을 구워 두면 스크립트 없이도 자동 입력되고, 비워 두면 앱 설정 화면에서 입력받는다.

## 확정되지 않은 값

아래는 시트에 정보가 없어 **추정**한 것이다. 전부 앱 설정 화면에서 조정할 수 있고,
실측값이 나오면 `config/ars.config.json` 에 반영해 기본값으로 굳힌다.

| 값 | 현재 | 비고 |
|---|---|---|
| 쉼표 1개 지속시간 | 2000ms | 단말마다 다르다 |
| 초기 대기 / 단계간 대기 | 8000 / 4000ms | |
| 계좌번호 앞 대기 | 7000ms | 안내 멘트가 메뉴보다 길다 |
| 계좌번호를 묻는 시점 | 메뉴를 다 누른 뒤 | 대메뉴·중메뉴 직후로 바꿀 수 있다 |
| 인증 필요 메뉴 | 42건 (대메뉴 2·3·4·5) | |
| 종목코드 필요 메뉴 | 10건 (메뉴명으로 추정) | 설정에서 모든 메뉴에 켤 수 있다 |

앱의 **직접 다이얼** 칸에서 문자열을 직접 만들어 걸어보며 되는 조합을 찾는 것이 가장 빠르다.

## 구성

```
ARS변경내역_최종_0904.xlsx   원본 (읽기 전용)
tools/extract-menu.mjs      xlsx → src/assets/*.json (+ 해시 검증)
tools/build-html.mjs        JSON → dist-single/ars-test.html
config/                     설정 (실값은 gitignore)
test/                       생성된 HTML 의 DOM 검증
_archive/                   이전 버전(React + Capacitor + Android/iOS). 참고용 보관
```

`_archive/` 는 Android 완전 자동(기본 전화앱 등록 + 통화 녹음 + STT + 배치 실행)을
목표로 만들었던 앱이다. 현재 도구와는 무관하며 빌드·테스트에서 제외된다.

## Android / iOS 전화 호환

스크립트 실행 시 Android를 감지하면 메뉴와 직접 다이얼에 `intent:` +
`android.intent.action.DIAL`을 사용한다. iOS와 다른 환경은 기존 `tel:`을 유지한다.
공통 설정의 **전화 앱 열기 방식**에서 Android 또는 기본 전화 링크로 수동 전환할 수 있다.
스크립트가 차단된 경우에는 미리 생성한 `tel:` 링크를 사용한다.
전화 앱에서 번호를 확인하고 통화 버튼을 누른다. 쉼표 대기와 ARS 자동 입력은
단말·전화 앱에 따라 달라 실제 Android/iOS 단말에서 확인해야 한다.

참고: [Chrome Android Intent 문서](https://developer.chrome.com/docs/android/intents).
