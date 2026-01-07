import React, { useEffect, useState, useRef } from "react";
import { View, StyleSheet, Platform, AppState, Linking as RNLinking, Alert } from "react-native";
import { WebView } from "react-native-webview";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ensureFirebaseInitialized } from "./src/firebase/init";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import KakaoLogin from "@react-native-seoul/kakao-login";

// ✅ Kakao SDK 초기화
const initializeKakaoSDK = async () => {
  try {
    const kakaoAppKey = "d6914396676906ad440f0d308ed139d1";
    if (Platform.OS === "ios") {
      await KakaoLogin.initWithAppKey(kakaoAppKey);
      console.log("🟢 Kakao SDK iOS 초기화 완료");
    } else if (Platform.OS === "android") {
      await KakaoLogin.initWithAppKey(kakaoAppKey);
      console.log("🟢 Kakao SDK Android 초기화 완료");
    }
  } catch (error) {
    console.error("❌ Kakao SDK 초기화 실패:", error);
  }
};

// ✅ App 시작 시 Kakao 초기화
initializeKakaoSDK();

// ✅ 푸시 알림 설정
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const webViewRef = useRef(null);
  const [expoPushToken, setExpoPushToken] = useState(null);
  const [user, setUser] = useState(null);
  const [webUri, setWebUri] = useState("https://timedealing.com/version-test/index?platform=app");
  const appState = useRef(AppState.currentState);

  const BASE_URL = "https://timedealing.com/version-test/index";
  // Kakao keys (ensure they match developer console settings)
  const KAKAO_NATIVE_APP_KEY = "d6914396676906ad440f0d308ed139d1"; // confirmed native app key
  const KAKAO_REST_API_KEY = "25ececa7ed4e4aff9a0e5a4c6fb090c4"; // REST api key (web flows)
  // Kakao Android native scheme uses 'kakaod' prefix (official new format) + native key
  const ANDROID_REDIRECT_SCHEME = `kakao${KAKAO_NATIVE_APP_KEY}`;
  const IOS_REDIRECT_SCHEME = `kakao${KAKAO_REST_API_KEY}`; // iOS style scheme

  // ✅ URL에 platform=app 자동 추가
  const appendPlatformParam = (url) => {
    try {
      const uri = new URL(url);
      if (!uri.searchParams.has("platform")) {
        uri.searchParams.append("platform", "app");
      }
      return uri.toString();
    } catch {
      return url.includes("?") ? `${url}&platform=app` : `${url}?platform=app`;
    }
  };

  // ✅ 초기화
  useEffect(() => {
    console.log("🟢 useEffect 시작됨");

    try {
      ensureFirebaseInitialized();
    } catch (e) {
      console.log("⚠️ Firebase 초기화 에러:", e);
    }

    initializePushToken();
    handleDeepLinks();

    const defaultUrl = appendPlatformParam(BASE_URL);
    console.log("🚀 초기 WebView URL 설정:", defaultUrl);
    setWebUri(defaultUrl);

    setTimeout(() => {
      console.log("⏳ checkAutoLogin 실행");
      checkAutoLogin();
    }, 800);

    // ✅ 앱 상태 변화 감지
    const subscription = AppState.addEventListener("change", async (nextAppState) => {
      if (appState.current.match(/inactive|background/) && nextAppState === "active") {
        const lastUrl = await AsyncStorage.getItem("last_webview_url");
        if (lastUrl) {
          console.log("🔁 복귀 시 WebView 복원:", lastUrl);
          setWebUri(appendPlatformParam(lastUrl));
        }
      }
      appState.current = nextAppState;
    });

    return () => subscription.remove();
  }, []);

  // ✅ 푸시 토큰 등록
  async function initializePushToken() {
    const storedToken = await AsyncStorage.getItem("expo_push_token");
    if (storedToken) {
      console.log("📦 기존 푸시 토큰 사용:", storedToken);
      setExpoPushToken(storedToken);
    } else {
      const newToken = await registerForPushNotificationsAsync();
      if (newToken) {
        await AsyncStorage.setItem("expo_push_token", newToken);
        setExpoPushToken(newToken);
      }
    }
  }

  // ✅ 자동 로그인 확인
  async function checkAutoLogin() {
    const storedUser = await SecureStore.getItemAsync("user");
    if (storedUser) {
      const userData = JSON.parse(storedUser);
      setUser(userData);
      const uri = appendPlatformParam(`${BASE_URL}?user_id=${userData.user_id}`);
      console.log("🔐 자동 로그인 유지:", uri);
      setWebUri(uri);
    } else {
      const uri = appendPlatformParam(BASE_URL);
      console.log("👋 비로그인 상태:", uri);
      setWebUri(uri);
    }
  }

  // ✅ 딥링크 감지 (App to App 로그인 후)
  function handleDeepLinks() {
    const subscription = Linking.addEventListener("url", async ({ url }) => {
      console.log("🔗 [딥링크 감지됨]:", url);
      const code = url.split("code=")[1];
      if (code) {
        console.log("🎟 [카카오 로그인 코드]:", code);
        try {
          const res = await fetch("https://timedealing.com/api/1.1/wf/kakao-token-handler", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code,
              redirect_uri: "timedealing://kakao-login",
              device_token: expoPushToken || "",
            }),
          });
          const data = await res.json();

          if (data && data.user_id) {
            console.log("✅ 로그인 성공:", data.user_id);
            await SecureStore.setItemAsync("user", JSON.stringify(data));
            const uri = appendPlatformParam(`${BASE_URL}?user_id=${data.user_id}`);
            setUser(data);
            setWebUri(uri);
          } else {
            console.log("❌ 로그인 실패 응답:", data);
          }
        } catch (err) {
          console.error("🔥 로그인 처리 실패:", err);
        }
      }
    });
    return () => subscription.remove();
  }

  // ✅ 로그아웃 처리 (Bubble → App)
  async function handleLogout() {
    console.log("🚪 로그아웃 요청 수신");
    await SecureStore.deleteItemAsync("user");
    setUser(null);
    const uri = appendPlatformParam(BASE_URL);
    setWebUri(uri);
  }

  // ✅ 카카오 로그인 처리 (Native SDK)
  async function handleKakaoLoginRequest() {
    try {
      console.log("🚀 [KAKAO] 로그인 시도");
      const result = await KakaoLogin.login(); // App-to-App 로그인
      console.log("✅ [카카오] 네이티브 로그인 성공:", result);
      
      const user = await KakaoLogin.getProfile(); // 프로필 정보 획득
      console.log("👤 [카카오] 프로필 정보:", user);

      const payload = {
        kakao_id: String(user.id),
        nickname: user.nickname || "",
        email: user.email || "",
        profile_image_url: user.profileImageUrl || user.thumbnailImageUrl || "",
        thumbnail_image_url: user.thumbnailImageUrl || "",
        access_token: result.accessToken,
        access_token_expires_at: result.accessTokenExpiresAt || "",
        refresh_token: result.refreshToken || "",
        refresh_token_expires_at: result.refreshTokenExpiresAt || "",
        id_token: result.idToken || "",
        scopes: result.scopes || [],
        device_token: expoPushToken || "",
      };

      console.log("📤 [전송 Payload] → Bubble", payload);

      const res = await fetch("https://timedealing.com/version-test/api/1.1/wf/kakao-native-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      console.log("✅ [Bubble] 카카오 로그인 응답:", data);

      // ✅ Bubble에서 반환한 code와 user_id 처리
      if (data?.response?.code) {
        const code = data.response.code;
        const userId = data.response.user_id;
        
        console.log("🔑 [Bubble] 인증 코드 수신:", code);
        console.log("👤 [Bubble] 사용자 ID:", userId);
        
        // 사용자 ID 저장 (있는 경우)
        if (userId) {
          await SecureStore.setItemAsync("user", JSON.stringify(data.response));
          setUser(data.response);
          console.log("💾 [저장] 사용자 정보 완료");
        }
        
        // ✅ WebView를 Bubble의 kakao-login 페이지로 리다이렉트 (code 전달)
        const redirectUrl = `https://timedealing.com/version-test/kakao-login?code=${code}&platform=app`;
        console.log("🔄 [리다이렉트] WebView 페이지 이동:", redirectUrl);
        setWebUri(appendPlatformParam(redirectUrl));
        
      } else if (data?.response?.user_id) {
        // ✅ Fallback: code 없이 user_id만 있는 경우 (기존 로직)
        console.log("✅ [Bubble] 로그인 완료 → user_id:", data.response.user_id);
        await SecureStore.setItemAsync("user", JSON.stringify(data.response));
        setUser(data.response);
        setWebUri(appendPlatformParam(`${BASE_URL}?user_id=${data.response.user_id}`));
        
      } else {
        // ❌ 응답에 code도 user_id도 없는 경우
        console.warn("❌ [Bubble] 로그인 실패:", data);
        Alert.alert("로그인 실패", "카카오 로그인에 실패했습니다.");
      }
    } catch (e) {
      console.error("🔥 [KAKAO] 로그인 오류:", e);
      Alert.alert("오류", "카카오 로그인 중 오류가 발생했습니다: " + e.message);
    }
  }

  // ✅ WebView URL 저장 (네비게이션 변화)
  const handleNavigationChange = async (navState) => {
    if (navState.url && !navState.url.includes("kakao-login")) {
      await AsyncStorage.setItem("last_webview_url", navState.url);
      console.log("📍 [NAV] 현재 URL 저장됨:", navState.url);
    }
  };

  // ✅ **WebView 링크 인터셉트 - Bubble 딥링크 처리**
  const handleShouldStartLoadWithRequest = (request) => {
    const url = request.url;

    console.log("\n═══════════════════════════════════════");
    console.log("📍 WebView 링크 감지!");
    console.log("   URL:", url);
    console.log("═══════════════════════════════════════\n");

    // Extract potential embedded kakao scheme inside wrapper URLs (e.g. hash or query)
  const decoded = decodeURIComponent(url);
  // Accept either correct schemes (kakaod..., kakao...) or mistakenly formatted 'kakao-' and normalize
  // Match kakao{appKey}:// or kakao-{appKey}:// (Bubble may inject a hyphen). App key is 32 hex chars.
  const embeddedKakaoMatch = decoded.match(/(kakao-?[a-f0-9]{32}:\/\/[^"'\s]*)/i);
    const kakaoDeepLink = embeddedKakaoMatch ? embeddedKakaoMatch[1] : null;

    // ✅ 1. New generic Kakao deep link interception (Bubble sandbox can't navigate it itself)
    if (kakaoDeepLink) {
      let toOpen = kakaoDeepLink;
      const tail = toOpen.includes('://') ? toOpen.split('://').slice(1).join('://') : '';
      // Prefer official Android scheme with 'kakaod' prefix
      toOpen = `kakaod${KAKAO_NATIVE_APP_KEY}://` + tail;
      console.log("🛠 [KAKAO] 스킴 보정(official kakaod prefix 적용) →", toOpen);
      console.log("🔗 [KAKAO] 임베디드 딥링크 감지:", toOpen);
      RNLinking.canOpenURL(toOpen)
        .then(can => {
          console.log("🔍 [KAKAO] canOpenURL 결과:", can);
          if (!can) {
            console.warn("⚠️ [KAKAO] KakaoTalk 미설치 또는 스킴 미등록. Play Store 이동 시도...");
            RNLinking.openURL('market://details?id=com.kakao.talk').catch(()=>RNLinking.openURL('https://play.google.com/store/apps/details?id=com.kakao.talk'));
            return;
          }
          return RNLinking.openURL(toOpen).then(()=>console.log("✅ [KAKAO] openURL 성공"));
        })
        .catch(e => console.error("❌ [KAKAO] openURL 실패:", e.message));
      return false;
    }

    // ✅ 2. timedealing://kakao-login 처리 (legacy internal hand-off)
    if (url.startsWith("timedealing://kakao-login")) {
      console.log("🔗 [1] timedealing://kakao-login 스킴 감지!");
      console.log("   → Bubble에서 카카오 로그인 요청");

      try {
        console.log("   → Linking.openURL() 호출 중...");
        RNLinking.openURL(url);
        console.log("✅ [1] Linking.openURL 성공!");
      } catch (error) {
        console.error("❌ [1] Linking.openURL 실패:", error.message);
        Alert.alert("오류", "링크를 열 수 없습니다: " + error.message);
      }

      console.log("   → WebView 로드 방지 (return false)\n");
      return false;
    }

  // ✅ 3. timedealing:// 일반 스킴
    if (url.startsWith("timedealing://")) {
      console.log("🔗 [2] timedealing:// 일반 스킴 감지!");

      try {
        console.log("   → Linking.openURL() 호출 중...");
        RNLinking.openURL(url);
        console.log("✅ [2] Linking.openURL 성공!");
      } catch (error) {
        console.error("❌ [2] Linking.openURL 실패:", error.message);
      }

      console.log("   → WebView 로드 방지 (return false)\n");
      return false;
    }

  // ✅ 4. kakaolink:// 처리 (카카오 공유)
    if (url.startsWith("kakaolink://")) {
      console.log("📤 [3] kakaolink:// 스킴 감지!");

      try {
        RNLinking.openURL(url);
        console.log("✅ [3] 카카오 공유 실행!");
      } catch (error) {
        console.error("❌ [3] 카카오 공유 실패:", error.message);
      }

      return false;
    }

  // ✅ 5. intent:// 처리 (카카오 내부 인텐트)
    if (url.startsWith("intent://")) {
      console.log("🔀 [4] intent:// 스킴 감지!");

      try {
        RNLinking.openURL(url);
        console.log("✅ [4] Intent 실행!");
      } catch (error) {
        console.error("❌ [4] Intent 실행 실패:", error.message);
      }

      return false;
    }

    // ✅ 6. Direct kakao native schemes (kakaod{nativeAppKey} / kakao{restApiKey})
    if (/^kakao-?[a-f0-9]{32}:\/\//i.test(url)) {
      const tail = url.includes('://') ? url.split('://').slice(1).join('://') : '';
      const toOpen = `kakaod${KAKAO_NATIVE_APP_KEY}://` + tail;
      console.log("🔐 [KAKAO] 직접 스킴 감지 (official kakaod 적용):", toOpen);
      RNLinking.canOpenURL(toOpen)
        .then(can => {
          console.log("🔍 [KAKAO] canOpenURL 결과 (direct):", can);
          if (!can) {
            console.warn("⚠️ [KAKAO] KakaoTalk 미설치 또는 스킴 미등록. Play Store 이동 시도...");
            RNLinking.openURL('market://details?id=com.kakao.talk').catch(()=>RNLinking.openURL('https://play.google.com/store/apps/details?id=com.kakao.talk'));
            return;
          }
          return RNLinking.openURL(toOpen).then(()=>console.log("✅ [KAKAO] openURL 성공 (direct)"));
        })
        .catch(error => console.error("❌ [KAKAO] direct open 실패:", error.message));
      return false;
    }

  // ✅ 7. HTTP/HTTPS는 WebView에서 정상 로드
    if (url.startsWith("http://") || url.startsWith("https://")) {
      console.log("🌐 [6] HTTP(S) URL 감지!");
      console.log("   → WebView에서 정상 로드\n");
      return true;
    }

    // ❌ 8. 알 수 없는 스킴
    console.warn("⚠️ [X] 알 수 없는 스킴 - 무시됨:", url, "\n");
    return false;
  };

  // Inject JS to intercept Bubble sandbox location changes setting kakao schemes
  const injectedJavaScript = `(() => {
    function isKakao(u){return /^kakao[d]?[a-f0-9]{32}:\/\//i.test(u) || u.startsWith('kakaolink://') || u.startsWith('intent://');}
    function post(u){try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'OPEN_DEEP_LINK', url:u}));}catch(e){}}
    const origAssign = window.location.assign.bind(window.location);
    window.location.assign = (u)=>{ if(isKakao(u)){ post(u); return; } origAssign(u); };
    const origReplace = window.location.replace.bind(window.location);
    window.location.replace = (u)=>{ if(isKakao(u)){ post(u); return; } origReplace(u); };
    const origOpen = window.open.bind(window);
    window.open = (u,n,f)=>{ if(isKakao(u)){ post(u); return null; } return origOpen(u,n,f); };
    document.addEventListener('click', (e)=>{ const a = e.target && e.target.closest && e.target.closest('a'); if(a && a.href && isKakao(a.href)){ e.preventDefault(); post(a.href); } }, true);
    console.log('[Injected] Kakao deep link interception active');
  })(); true;`;

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: webUri }}
        userAgent={`TimedealingApp/1.0 (Expo ${Platform.OS})`}
        injectedJavaScript={injectedJavaScript}
        
        // ✅ **[핵심] 딥링크 처리 설정들**
        onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
        originWhitelist={['*']}  // ✅ 모든 URL 스킴 허용 (중요!)
        mixedContentMode="always"  // ✅ HTTP/HTTPS 혼합 콘텐츠 허용
        
        // ✅ **JavaScript & 로컬 스토리지**
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowFileAccess={true}
        startInLoadingState={true}
        
        // ✅ **로드 이벤트**
        onLoadStart={(event) => {
          console.log("🌐 [WebView 로드 시작]:", event.nativeEvent.url);
        }}
        onLoadEnd={() => {
          console.log("✅ [WebView 로드 완료]");
          console.log("   → 이제 딥링크 처리 준비됨!");
          
          let retryCount = 0;
          const interval = setInterval(() => {
            webViewRef.current?.injectJavaScript(`
              if (window.bubble_fn_app_platform) {
                bubble_fn_app_platform("app");
                console.log("📡 bubble_fn_app_platform('app') 호출됨 ✅");
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: "platform_injected" }));
              }
            `);
            retryCount++;
            if (retryCount > 10) clearInterval(interval);
          }, 1000);
        }}
        
        // ✅ **Bubble → App 메시지 처리 (postMessage 방식)**
        onMessage={async (event) => {
          try {
            const rawData = event.nativeEvent.data;
            
            // Skip non-JSON messages (like HTML fragments from Bubble)
            if (!rawData || typeof rawData !== 'string' || !rawData.trim().startsWith('{')) {
              console.log("ℹ️ [App] Non-JSON message ignored:", rawData?.substring(0, 50));
              return;
            }
            
            const message = JSON.parse(rawData || "{}");
            
            console.log("\n╔════════════════════════════════════╗");
            console.log("📨 [App] onMessage 수신:");
            console.log("   type:", message.type);
            console.log("╚════════════════════════════════════╝\n");
            
            // ✅ 로그아웃 처리
            if (message.type === "logout") {
              console.log("🚪 로그아웃 메시지 수신");
              await handleLogout();
            }
            

            // ✅ 카카오 로그인 처리 (postMessage 방식)
            if (message.type === "KAKAO_LOGIN" || message.type === "kakao-login") {
              console.log("🔐 [App] Kakao 로그인 요청 수신");
              await handleKakaoLoginRequest();
            }

            if (message.type === "OPEN_DEEP_LINK" && message.url) {
              console.log("🔗 [OPEN_DEEP_LINK] 요청 수신:", message.url);
              try {
                RNLinking.openURL(message.url);
              } catch (e) {
                console.error("❌ OPEN_DEEP_LINK 실패:", e.message);
              }
            }
            
            // ✅ 기타 메시지 처리
            console.log("📝 메시지 처리 완료:", message.type);
          } catch (err) {
            console.error("❌ onMessage 처리 오류:", err);
          }
        }}
        
        // ✅ **에러 핸들러**
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          console.error("\n❌ ═════════════════════════════════════");
          console.error("❌ [WebView] 에러 발생!");
          console.error("❌ 코드:", nativeEvent.code);
          console.error("❌ 설명:", nativeEvent.description);
          console.error("❌ URL:", nativeEvent.url);
          console.error("❌ ═════════════════════════════════════\n");
        }}
        
        // ✅ **네비게이션 상태 변화**
        onNavigationStateChange={(navState) => {
          handleNavigationChange(navState);
          console.log("🔄 [WebView] 네비게이션 변경:");
          console.log("   URL:", navState.url);
          console.log("   진행 중:", navState.loading);
        }}
        
        // ✅ **기본 설정**
        cacheEnabled={true}
        allowsBackForwardNavigationGestures
      />
      <StatusBar style="auto" />
    </View>
  );
}

// ✅ 푸시 토큰 발급 함수
async function registerForPushNotificationsAsync() {
  let token;
  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      alert("푸시 알림 권한이 거부되었습니다 ❌");
      return null;
    }

    token = (await Notifications.getExpoPushTokenAsync()).data;
    console.log("✅ [푸시 토큰 발급]:", token);

    if (Platform.OS === "android") {
      Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
      });
    }
  } else {
    alert("실제 기기에서만 푸시 알림을 받을 수 있습니다 ⚠️");
  }

  return token;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
});