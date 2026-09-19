# 네이티브 플러그인

`android/` · `ios/` 는 Capacitor가 생성한 디렉터리라 저장소에 커밋하지 않는다.
플러그인 소스의 원본은 여기서 관리하고, 플랫폼을 다시 만들 때 복사한다.

```bash
npx cap add android
npx cap add ios
cp native/android/java/com/wavve/arstest/*.java android/app/src/main/java/com/wavve/arstest/
cp native/ios/ArsDialerPlugin.swift ios/App/App/
npm run sync
```

`npx cap add android` 직후에는 아래 두 가지를 직접 반영해야 한다(이미 적용된 상태로 생성되어 있다).

- `android/variables.gradle` 의 `minSdkVersion` 을 **29** 로 올린다 (ROLE_DIALER 요구사항)
- `AndroidManifest.xml` 에 권한·`ArsInCallService`·DIAL 인텐트 필터를 병합한다
  (`native/android/AndroidManifest.snippet.xml` 참고)
- `MainActivity.java` 에서 `registerPlugin(ArsDialerPlugin.class)` 호출

## 구성

| 파일 | 역할 |
|---|---|
| `ArsDialerPlugin.java` | Capacitor 브리지. 발신·DTMF·녹음·VAD·전사·통화 종료 |
| `ArsInCallService.java` | 기본 전화앱으로 지정됐을 때 통화를 넘겨받는다. 스피커 라우팅 |
| `CallRecorder.java` | AudioRecord로 16kHz 모노 PCM 녹음. 프레임 RMS 제공, 구간 건너뛰기 |
| `PromptDetector.java` | RMS로 "말했다가 조용해지는" 순간을 감지 (VAD) |
| `SttEngine.java` | SpeechRecognizer 파일 입력(API 31+)으로 한국어 전사. 오프라인 우선 |
| `ArsDialerPlugin.swift` | iOS. `tel:` 스킴 호출만 하고 나머지는 모두 불가로 보고 |

Java로 작성한 이유는 Capacitor Android 템플릿이 Java 전용이기 때문이다.
Kotlin을 쓰려면 Gradle에 Kotlin 플러그인을 추가해야 해서, 빌드 리스크를 줄이려고 Java를 택했다.

## 기기 준비

1. 앱 설치 후 **설정 › 앱 › 기본 앱 › 전화 앱** 에서 이 앱을 선택하거나,
   앱 안에서 `ensureDialerRole()` 을 호출한다.
2. 전화·마이크 권한을 허용한다.
3. 등록 전에는 `getCapabilities()` 가 `autoDial: false` 를 돌려주고 화면이 반자동으로 떨어진다.

**전용 테스트 단말에서만** 기본 전화앱으로 지정할 것. 지정된 동안 그 단말의 일반 통화 사용이 제한된다.

## 실기기에서 확인해야 하는 것

코드로는 검증할 수 없고 통화가 붙어야만 드러나는 부분들이다.

- `CallRecorder.start()` 가 통화 중에 예외 없이 열리는가 (제조사가 막을 수 있다)
- 녹음된 WAV에 ARS 안내가 **알아들을 수 있게** 담기는가
- `PromptDetector.SPEECH_RMS` (현재 600) 가 실제 음량에 맞는가
- `SttEngine` 이 이 단말의 인식기에서 파일 입력을 지원하는가 (미지원 시 빈 문자열 → REVIEW)
- `ArsInCallService.routeToSpeaker()` 가 실제로 스피커로 전환되는가
