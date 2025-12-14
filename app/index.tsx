// app/index.tsx - 카카오 로그인 (GPT 방식: NativeEventEmitter로 이벤트 수신)

import React, { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, StyleSheet, Image, Platform, ActivityIndicator, Linking, NativeEventEmitter, NativeModules, Alert, StatusBar } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack } from "expo-router";
import * as KakaoLogin from "@react-native-seoul/kakao-login";
import * as Notifications from "expo-notifications";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { ensureFirebaseInitialized } from "../src/firebase/init";
import {
  registerForPushNotificationsAsync,
  setupNotificationListeners,
  scheduleLocalTestNotification,
} from "../src/notifications/NotificationService";

SplashScreen.preventAutoHideAsync();

// ==================== 상수 ====================
const BUBBLE_API_BASE = "https://timedealing.com/version-test/api/1.1/wf";
const WEBVIEW_URL = "https://timedealing.com/version-test/";
// Kakao REST API key (used for web flows)
const KAKAO_CLIENT_ID = "734ac84c6c99e27b030a2d8006c9761e";
// Kakao Native App Key (from app.json extra.kakao.nativeAppKey and AndroidManifest meta-data)
const KAKAO_NATIVE_APP_KEY = "d6914396676906ad440f0d308ed139d1";
// iOS redirect scheme pattern: kakao{REST_API_KEY}://oauth (per existing config)
const KAKAO_REDIRECT_URI = `kakao${KAKAO_CLIENT_ID}://oauth`;
// Android native SDK redirect scheme pattern: kakaod{NATIVE_APP_KEY}://oauth
// NOTE: Previous value 'kakaoauth://oauth' was incorrect and prevented deep link handling.
const KAKAO_ANDROID_REDIRECT_URI = `kakaod${KAKAO_NATIVE_APP_KEY}://oauth`;

// ==================== 타입 정의 ====================
interface WebViewMessage {
  type: string;
  userId?: string;
  dealId?: string;
  platform?: string;
  [key: string]: any;
}

interface PlatformInfo {
  platform: string;
  isApp: boolean;
  appVersion: string;
  deviceType: string;
}

// ==================== 푸시 토큰 저장 ====================
// Note: Push token is now sent directly in the Kakao login payload (device_token field)
// This separate endpoint is not needed since Bubble receives it during login
async function savePushTokenToBubble(
  userId: string,
  token: string
): Promise<boolean> {
  try {
    console.log(`📤 [푸시토큰] 이미 로그인 시 전송됨 (device_token) - 별도 저장 불필요`);
    // Push token was already sent with the Kakao login payload
    // No need for a separate API call
    return true;
  } catch (error) {
    console.error("❌ [푸시토큰] 처리 오류:", error);
    return false;
  }
}

// ==================== Haptic Feedback Utility ====================
/**
 * Trigger haptic feedback for UI interactions
 * @param type - Type of haptic feedback ("tab" | "light" | "medium" | "heavy" | "selection")
 */
async function triggerHaptic(type: "tab" | "light" | "medium" | "heavy" | "selection" = "tab"): Promise<void> {
  try {
    if (Platform.OS === "ios") {
      // iOS uses selectionAsync for tab/selection feedback
      if (type === "tab" || type === "selection") {
        await Haptics.selectionAsync();
      } else {
        // Map other types to impact feedback
        const impactStyle = type === "light" 
          ? Haptics.ImpactFeedbackStyle.Light
          : type === "medium"
          ? Haptics.ImpactFeedbackStyle.Medium
          : Haptics.ImpactFeedbackStyle.Heavy;
        await Haptics.impactAsync(impactStyle);
      }
    } else {
      // Android uses impact feedback
      const impactStyle = type === "heavy"
        ? Haptics.ImpactFeedbackStyle.Heavy
        : type === "medium"
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light;
      await Haptics.impactAsync(impactStyle);
    }
  } catch (error) {
    console.warn("⚠️ [Haptic] 햅틱 피드백 실패:", error);
  }
}

// ==================== 메인 컴포넌트 ====================
export default function App() {
  const [loading, setLoading] = useState(true);
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const webViewRef = useRef<WebView>(null);
  const insets = useSafeAreaInsets();
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(null);

  // ==================== 초기화 ====================
  useEffect(() => {
    initializeApp();
  }, []);

  // ==================== 딥링크 이벤트 리스너 (GPT 방식) ====================
  useEffect(() => {
    // ✅ NativeEventEmitter로 Android 이벤트 수신
    if (Platform.OS === "android") {
      try {
        const eventEmitter = new NativeEventEmitter(NativeModules.ToastExample || NativeModules.RCTNativeAppEventEmitter);
        
        const subscription = eventEmitter.addListener("kakaoLogin", async () => {
          console.log("\n╔════════════════════════════════════════╗");
          console.log("🎯 [Android] kakaoLogin 이벤트 수신!");
          console.log("╚════════════════════════════════════════╝\n");
          
          // ✅ 이벤트를 받으면 카카오 로그인 시작
          await handleKakaoLoginRequest("app");
        });

        console.log("✅ [NativeEventEmitter] kakaoLogin 리스너 등록됨");

        return () => {
          subscription.remove();
        };
      } catch (error) {
        console.warn("⚠️ [NativeEventEmitter] 설정 실패:", error);
        // Fallback: 일반 딥링크 리스너 사용
        const subscription = Linking.addEventListener("url", handleDeepLink);
        return () => subscription.remove();
      }
    } else {
      // iOS는 일반 딥링크 리스너 사용
      const subscription = Linking.addEventListener("url", handleDeepLink);
      return () => subscription.remove();
    }
  }, []);

  // ==================== 알림 리스너 설정 ====================
  useEffect(() => {
    console.log("🔔 [알림] 리스너 설정 시작...");
    
    const cleanup = setupNotificationListeners({
      onNotificationReceived: (notification) => {
        console.log("📩 [포그라운드] 알림 수신:", JSON.stringify(notification, null, 2));
      },
      onNotificationTap: (data) => {
        console.log("📲 [알림 클릭] 데이터:", JSON.stringify(data, null, 2));
        
        // ✅ Bubble push notification with URL: navigate WebView
        if (data && data.url) {
          console.log("🔗 [Push] URL 감지, WebView 이동:", data.url);
          
          // Navigate WebView to the URL from push notification
          if (webViewRef.current) {
            webViewRef.current.injectJavaScript(`window.location.href = "${data.url}";`);
          }
        }
        
        // Also send message to WebView for additional handling
        sendMessageToWebView({
          type: "NOTIFICATION_TAP",
          data: data || {},
        });
      },
    });

    console.log("✅ [알림] 리스너 등록 완료");

    return () => {
      console.log("🧹 [알림] 리스너 정리 중...");
      cleanup();
    };
  }, []);

  // ==================== GPS 위치 추적 설정 ====================
  useEffect(() => {
    let mounted = true;

    const startLocationTracking = async () => {
      try {
        console.log("📍 [GPS] 위치 권한 요청 중...");
        
        // Request location permissions
        const { status } = await Location.requestForegroundPermissionsAsync();
        
        if (status !== 'granted') {
          console.warn("⚠️ [GPS] 위치 권한이 거부되었습니다");
          return;
        }

        console.log("✅ [GPS] 위치 권한 승인됨");

        // Start watching position with production-ready settings
        // distanceInterval: 0 means updates are time-based only (every 3 seconds)
        const subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 3000, // Update every 3 seconds
            distanceInterval: 0, // Time-based updates only (no distance filter)
          },
          (location) => {
            if (!mounted) return;

            const lat = location.coords.latitude;
            const lng = location.coords.longitude;
            const heading = location.coords.heading ?? 0;
            const accuracy = location.coords.accuracy ?? 0;
            const altitude = location.coords.altitude ?? null;
            const speed = location.coords.speed ?? null;

            console.log(`[GPS] Location update: lat=${lat}, lng=${lng}, heading=${heading}`);

            // Send location data to WebView via postMessage
            if (webViewRef.current) {
              webViewRef.current.postMessage(JSON.stringify({
                type: 'GPS_UPDATE',
                lat,
                lng,
                heading,
                accuracy,
                altitude,
                speed,
                timestamp: Date.now()
              }));
            }
          }
        );

        locationSubscriptionRef.current = subscription;
        console.log("✅ [GPS] 위치 추적 시작됨 (High accuracy, 3s interval, distance filter disabled)");

      } catch (error) {
        console.error("❌ [GPS] 위치 추적 시작 실패:", error);
      }
    };

    startLocationTracking();

    return () => {
      mounted = false;
      if (locationSubscriptionRef.current) {
        locationSubscriptionRef.current.remove();
        locationSubscriptionRef.current = null;
        console.log("🧹 [GPS] 위치 추적 정리됨");
      }
    };
  }, []);

  // ==================== 강제 위치 업데이트 ====================
  const forceUpdateLocation = useCallback(async () => {
    try {
      console.log("📍 [GPS] 강제 위치 업데이트 시작");
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const lat = location.coords.latitude;
      const lng = location.coords.longitude;
      const heading = location.coords.heading ?? 0;

      console.log(`✅ [GPS] 강제 위치 가져오기 성공: lat=${lat}, lng=${lng}, heading=${heading}`);

      // Send location to WebView using injectJavaScript
      if (webViewRef.current) {
        console.log("📤 [WebView] window.__updateMapFromRN 호출 시도");
        webViewRef.current.injectJavaScript(`
          if (typeof window.__updateMapFromRN === 'function') {
            console.log('[WebView] window.__updateMapFromRN 호출: lat=${lat}, lng=${lng}, heading=${heading}');
            window.__updateMapFromRN(${lat}, ${lng}, ${heading});
            console.log('[WebView] ✅ window.__updateMapFromRN 호출 완료');
          } else {
            console.warn('[WebView] ⚠️ window.__updateMapFromRN이 정의되지 않았습니다');
          }
          true;
        `);
      } else {
        console.error("❌ [GPS] webViewRef.current가 null입니다!");
      }
    } catch (error) {
      console.error("❌ [GPS] 강제 위치 업데이트 실패:", error);
    }
  }, []);

  // ==================== 앱 초기화 ====================
  const initializeApp = useCallback(async () => {
    try {
      console.log("🚀 [앱초기화] 시작...");

      // Firebase 초기화
      await ensureFirebaseInitialized();

      // 푸시 토큰 등록
      const token = await registerForPushNotificationsAsync();
      if (token) {
        console.log("📱 [푸시토큰] 발급 완료:", token);
        setExpoPushToken(token);

        // 저장된 userId가 있으면 토큰 전송
        const savedUserId = await AsyncStorage.getItem("user_id");
        if (savedUserId) {
          await savePushTokenToBubble(savedUserId, token);
        }
      } else {
        console.warn("⚠️ [푸시토큰] 발급 실패");
      }

      console.log("✅ [앱초기화] 완료");

      // 🔥 Cold start: 알림으로 앱이 열렸는지 확인
      try {
        const lastResponse = await Notifications.getLastNotificationResponseAsync();
        if (lastResponse) {
          const data = lastResponse.notification.request.content.data;
          console.log("📲 [Cold Start] 알림으로 앱 시작:", JSON.stringify(data, null, 2));
          
          if (data && data.url) {
            console.log("🔗 [Cold Start Push] URL 감지, WebView 이동 예약:", data.url);
            // Wait for WebView to be ready
            setTimeout(() => {
              if (webViewRef.current) {
                webViewRef.current.injectJavaScript(`window.location.href = "${data.url}"; true;`);
                console.log("✅ [Cold Start] WebView 이동 완료");
              }
            }, 1500);
          }
        } else {
          console.log("ℹ️ [알림] 초기 알림 없음 (일반 앱 시작)");
        }
      } catch (e) {
        console.error("❌ [알림] Cold start 확인 실패:", e);
      }

      // 🧪 로컬 알림 테스트 (개발 중 1회만)
      try {
        const doneKey = "local_notification_test_done";
        const done = await AsyncStorage.getItem(doneKey);
        if (__DEV__ && !done) {
          console.log("🧪 [알림] 로컬 테스트 발송 (5초 후)");
          setTimeout(async () => {
            await scheduleLocalTestNotification("디버그 알림", "포그라운드/백그라운드 모두 표시됩니다");
            console.log("✅ [알림] 로컬 테스트 전송 완료");
          }, 5000);
          await AsyncStorage.setItem(doneKey, "1");
        }
      } catch (e) {
        console.warn("⚠️ [알림] 로컬 테스트 실패:", e);
      }

      // 🔑 Android Kakao KeyHash 로그 (개발자 콘솔 등록용)
      if (Platform.OS === 'android') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const keyHash = await (NativeModules as any).KeyHashModule?.getKeyHash?.();
          console.log("🔑 [Android] Kakao KeyHash:", keyHash);
        } catch (e:any) {
          console.log("⚠️ [Android] KeyHash 가져오기 실패:", e?.message);
        }
      }
    } catch (error) {
      console.error("❌ [앱초기화] 오류:", error);
    }
  }, []);

  // ==================== 일반 딥링크 콜백 (iOS & Fallback) ====================
  const handleDeepLink = useCallback(async (event: { url: string }) => {
    try {
      const url = event.url;
      console.log("🔗 [딥링크] 수신:", url);

      // ✅ 카카오톡에서 돌아온 인증 코드
      if (
  // Accept both iOS (kakao + REST key) and Android (kakaod + native key) schemes
  (url.includes(`kakaod${KAKAO_NATIVE_APP_KEY}`) || url.includes(`kakao${KAKAO_CLIENT_ID}`)) &&
        url.includes("code=")
      ) {
        console.log("✅ [카카오] 인증 코드 받음");
        const codeMatch = url.match(/code=([^&]+)/);
        if (codeMatch && codeMatch[1]) {
          const authCode = codeMatch[1];
          console.log("📝 [카카오] 인증코드:", authCode);
          await exchangeKakaoCode(authCode);
        }
      }
    } catch (error) {
      console.error("❌ [딥링크] 처리 오류:", error);
    }
  }, []);

  // ==================== 카카오 로그인 URL 생성 ====================
  const generateKakaoAuthUrl = useCallback((): string => {
    const redirectUri = Platform.OS === "ios" ? KAKAO_REDIRECT_URI : KAKAO_ANDROID_REDIRECT_URI;
    
    const params = new URLSearchParams({
      client_id: KAKAO_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "profile_nickname,profile_image,account_email",
    });

    const url = `https://kauth.kakao.com/oauth/authorize?${params.toString()}`;
    console.log("🔗 [카카오] 생성된 인증 URL:", url);
    return url;
  }, []);

  // ==================== 카카오 인증 코드 토큰 교환 ====================
  const exchangeKakaoCode = useCallback(async (code: string) => {
    try {
      console.log("🔄 [카카오] 토큰 교환 시작");

      const redirectUri = Platform.OS === "ios" ? KAKAO_REDIRECT_URI : KAKAO_ANDROID_REDIRECT_URI;
      
      const params = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: KAKAO_CLIENT_ID,
        code: code,
        redirect_uri: redirectUri,
      });

      const response = await fetch("https://kauth.kakao.com/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const tokenData = await response.json();
      console.log("✅ [카카오] 토큰 받음");

      const accessToken = tokenData.access_token;
      if (!accessToken) {
        throw new Error("Access Token 없음");
      }

      // 사용자 정보 조회
      await fetchKakaoUserInfo(accessToken);
    } catch (error) {
      console.error("❌ [카카오] 토큰 교환 오류:", error);
      
      // Fallback: 웹 로그인
      sendMessageToWebView({
        type: "SWITCH_TO_WEB_LOGIN",
        reason: "카카오 토큰 교환 실패",
      });
    }
  }, []);

  // ==================== 카카오 사용자 정보 조회 ====================
  const fetchKakaoUserInfo = useCallback(async (accessToken: string) => {
    try {
      console.log("👤 [카카오] 사용자 정보 조회");

      const response = await fetch("https://kapi.kakao.com/v2/user/me", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const userInfo = await response.json();
      console.log("✅ [카카오] 사용자 정보:", userInfo);

      const userId = userInfo.id;
      const email = userInfo.kakao_account?.email || "";
      const nickname = userInfo.kakao_account?.profile?.nickname || "";
      const profileImage = userInfo.kakao_account?.profile?.profile_image_url || "";

      console.log(`✅ [카카오] 사용자: ${nickname} (${email})`);

      // userId 저장
      await AsyncStorage.setItem("user_id", userId.toString());

      // Bubble에 로그인 성공 메시지
      sendMessageToWebView({
        type: "KAKAO_LOGIN_SUCCESS",
        userId: userId.toString(),
        userName: nickname,
        userEmail: email,
        userImage: profileImage,
      });

      // 푸시 토큰 등록
      if (expoPushToken) {
        await savePushTokenToBubble(userId.toString(), expoPushToken);
      }

      console.log("✅ [카카오] 로그인 완료");
    } catch (error) {
      console.error("❌ [카카오] 사용자 조회 오류:", error);
      throw error;
    }
  }, [expoPushToken]);

  // ==================== WebView 이벤트 핸들러 ====================
  const handleLoadEnd = useCallback(async () => {
    console.log("✅ [WebView] 로딩 완료");
    setLoading(false);
    await SplashScreen.hideAsync();
    
    // ✅ CRITICAL: Send initial location immediately after WebView loads
    // This ensures the user marker appears without waiting for GPS watcher
    // GPS watchPositionAsync can be throttled by OS, making it unreliable for initial render
    try {
      console.log("📍 [WebView] 초기 위치 전송 시작");
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const lat = location.coords.latitude;
      const lng = location.coords.longitude;
      const heading = location.coords.heading ?? 0;

      console.log(`✅ [WebView] 초기 위치 가져오기: lat=${lat}, lng=${lng}, heading=${heading}`);

      // Send initial location to WebView using injectJavaScript
      if (webViewRef.current) {
        console.log("📤 [WebView] LOCATION_INIT - window.__updateMapFromRN 호출 시도");
        webViewRef.current.injectJavaScript(`
          if (typeof window.__updateMapFromRN === 'function') {
            console.log('[WebView] LOCATION_INIT: window.__updateMapFromRN 호출');
            window.__updateMapFromRN(${lat}, ${lng}, ${heading});
            console.log('[WebView] ✅ LOCATION_INIT 완료');
          } else {
            console.warn('[WebView] ⚠️ LOCATION_INIT: window.__updateMapFromRN 미정의');
          }
          true;
        `);
      }
    } catch (error) {
      console.error("❌ [WebView] 초기 위치 가져오기 실패:", error);
    }
  }, []);

  const handleLoadError = useCallback((syntheticEvent: any) => {
    const { nativeEvent } = syntheticEvent;
    console.error("❌ [WebView] 로딩 오류:", nativeEvent);
    setLoading(false);
  }, []);

  // ==================== WebView 메시지 핸들링 ====================
  const handleWebViewMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      try {
        const rawData = event.nativeEvent.data;
        
        // Handle simple string messages (like "HAPTIC_TAB")
        if (rawData && typeof rawData === 'string' && !rawData.trim().startsWith('{')) {
          // Check for haptic feedback request
          if (rawData === "HAPTIC_TAB") {
            console.log("📳 [Haptic] Tab 피드백 트리거");
            await triggerHaptic("tab");
            return;
          }
          
          console.log("ℹ️ [WebView] Non-JSON message ignored:", rawData?.substring(0, 50));
          return;
        }
        
        // Skip invalid messages
        if (!rawData || typeof rawData !== 'string') {
          return;
        }
        
        const message: WebViewMessage = JSON.parse(rawData);
        console.log("📨 [WebView] 메시지 수신:", message.type);

        switch (message.type) {
          // ✅ Bubble → App: KAKAO_LOGIN (alias to native login request)
          case "KAKAO_LOGIN": {
            console.log("🔐 [WebView] KAKAO_LOGIN 요청 수신 → 네이티브 로그인 실행");
            await handleKakaoLoginRequest("app");
            break;
          }
          // ✅ WebView에서 감지한 딥링크를 네이티브에서 열기
          case "OPEN_DEEP_LINK": {
            const deeplink = message.url as string;
            if (typeof deeplink === "string" && deeplink.length > 0) {
              console.log("🔗 [딥링크] WebView 요청:", deeplink);
              try {
                Linking.openURL(deeplink);
              } catch (err) {
                console.error("❌ [딥링크] 열기 실패:", err);
              }
            }
            break;
          }
          // ✅ Request current location from native GPS (legacy support)
          case "REQUEST_LOCATION": {
            console.log("📍 [WebView] 현재 위치 요청 수신");
            try {
              const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
              });
              const lat = location.coords.latitude;
              const lng = location.coords.longitude;
              const heading = location.coords.heading ?? 0;
              const accuracy = location.coords.accuracy ?? 0;
              
              console.log(`[GPS] Location update: lat=${lat}, lng=${lng}, heading=${heading}`);
              
              // Send to WebView via postMessage
              if (webViewRef.current) {
                webViewRef.current.postMessage(JSON.stringify({
                  type: 'GPS_UPDATE',
                  lat,
                  lng,
                  heading,
                  accuracy,
                  timestamp: Date.now()
                }));
              }
            } catch (error) {
              console.error("❌ [GPS] 현재 위치 가져오기 실패:", error);
            }
            break;
          }
          // ✅ "Current Location" button handler - force location update
          case "REQUEST_CURRENT_LOCATION": {
            console.log("📍 [WebView] Current Location 버튼 클릭 - 즉시 위치 가져오기");
            console.log("🔍 [Debug] Calling forceUpdateLocation to fetch fresh GPS and send LOCATION_UPDATE");
            await forceUpdateLocation();
            break;
          }
          // ✅ 카카오 로그인 요청
          case "KAKAO_LOGIN_REQUEST":
            await handleKakaoLoginRequest(message.platform);
            break;

          // 로그인 성공
          case "LOGIN_SUCCESS":
            await handleLoginSuccess(message);
            break;

          // 로그아웃
          case "LOGOUT":
            await handleLogout();
            break;

          // 플랫폼 정보 요청
          case "REQUEST_PLATFORM_INFO":
            sendMessageToWebView({
              type: "PLATFORM_INFO",
              data: getPlatformInfo(),
            });
            break;

          default:
            console.log("ℹ️ [WebView] 알 수 없는 메시지:", message.type);
        }
      } catch (error) {
        console.error("❌ [WebView] 메시지 처리 오류:", error);
      }
    },
    [expoPushToken]
  );

  // ==================== 카카오 로그인 요청 ====================
  const handleKakaoLoginRequest = useCallback(async (platform: string) => {
    try {
      console.log(`📱 [카카오] ${platform} 로그인 시작`);

        // ✅ 네이티브 카카오 SDK를 사용한 app-to-app 로그인
        console.log("🚀 [카카오] 네이티브 SDK 로그인 시작 (app-to-app)");
        const kakaoAppAvailable = await KakaoLogin.getAccessToken().then(() => true).catch(() => true); // SDK presence heuristic
        console.log("🔎 [카카오] SDK 가용성:", kakaoAppAvailable);
        console.log("🔗 [카카오] 예상 Redirect(Android):", `kakaod${KAKAO_NATIVE_APP_KEY}://oauth`);
        console.log("🔗 [카카오] 예상 Redirect(iOS):", `kakao${KAKAO_CLIENT_ID}://oauth`);
      
        // ✅ 이메일 스코프를 포함하여 로그인 요청
        console.log("📧 [카카오] 이메일 동의 항목 포함하여 로그인 요청");
        const result = await KakaoLogin.login();
        console.log("✅ [카카오] 네이티브 로그인 성공:", result);
      
        // 액세스 토큰으로 사용자 정보 가져오기
        const profile = await KakaoLogin.getProfile();
        console.log("👤 [카카오] 프로필 정보:", profile);

        // ✅ 이메일 및 프로필 이미지 확인
        if (!profile.email || profile.emailNeedsAgreement) {
          console.warn("⚠️ [카카오] 이메일 정보 없음 - Kakao Developers Console에서 '이메일' 동의 항목을 필수로 설정해주세요");
          console.warn("⚠️ 설정 경로: https://developers.kakao.com/console/app → 제품 설정 → 카카오 로그인 → 동의 항목");
        }
        if (!profile.profileImageUrl || profile.profileNeedsAgreement) {
          console.warn("⚠️ [카카오] 프로필 이미지 정보 없음 - '프로필 정보(닉네임/프로필 사진)' 동의 항목을 필수로 설정해주세요");
        }
      
        // Bubble에 사용자 정보 직접 전송 (모든 토큰 정보 포함)
        const payload = {
          kakao_id: String(profile.id),
          nickname: profile.nickname || "",
          email: profile.email || "",
          profile_image_url: profile.profileImageUrl || profile.thumbnailImageUrl || "",
          thumbnail_image_url: profile.thumbnailImageUrl || "",
          access_token: result.accessToken,
          access_token_expires_at: result.accessTokenExpiresAt || "",
          refresh_token: result.refreshToken || "",
          refresh_token_expires_at: result.refreshTokenExpiresAt || "",
          id_token: result.idToken || "",
          scopes: result.scopes || [],
          device_token: expoPushToken || "",
        };
        
        console.log("📤 [전송 Payload] → Bubble:", payload);
        
        const response = await fetch(`https://timedealing.com/version-test/api/1.1/wf/kakao-native-login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      
        const bubbleResult = await response.json();
        console.log("✅ [Bubble] 카카오 로그인 응답:", bubbleResult);
      
        // ✅ Bubble에서 반환한 code와 user_id 처리
        if (bubbleResult.response?.code) {
          const code = bubbleResult.response.code;
          const userId = bubbleResult.response.user_id;
          
          console.log("🔑 [Bubble] 인증 코드 수신:", code);
          console.log("👤 [Bubble] 사용자 ID:", userId);
          
          // 사용자 ID 저장 (있는 경우)
          if (userId) {
            await AsyncStorage.setItem("user_id", userId);
            console.log("💾 [저장] 사용자 ID:", userId);
            
            // 푸시 토큰 저장
            if (expoPushToken) {
              await savePushTokenToBubble(userId, expoPushToken);
            }
          }
        
          // ✅ WebView를 Bubble의 kakao-login 페이지로 리다이렉트 (code 전달)
          const redirectUrl = `https://timedealing.com/version-test/kakao-login?code=${code}&platform=app`;
          console.log("🔄 [리다이렉트] WebView 페이지 이동:", redirectUrl);
          
          // WebView 네비게이션 실행
          if (webViewRef.current) {
            webViewRef.current.injectJavaScript(`window.location.href = "${redirectUrl}";`);
          }
        } else if (bubbleResult.response?.user_id) {
          // ✅ Fallback: code 없이 user_id만 있는 경우 (기존 로직)
          const userId = bubbleResult.response.user_id;
          await AsyncStorage.setItem("user_id", userId);
          console.log("💾 [저장] 사용자 ID:", userId);
        
          // 푸시 토큰 저장
          if (expoPushToken) {
            await savePushTokenToBubble(userId, expoPushToken);
          }
        
          // WebView를 로그인 후 페이지로 리다이렉트
          const loginUrl = `https://timedealing.com/version-test/index?user_id=${userId}&platform=app`;
          console.log("🔄 [리다이렉트] WebView 페이지 이동:", loginUrl);
          
          // WebView 네비게이션 실행
          if (webViewRef.current) {
            webViewRef.current.injectJavaScript(`window.location.href = "${loginUrl}";`);
          }
        } else {
          // ❌ 응답에 code도 user_id도 없는 경우
          console.error("❌ [Bubble] 응답에 code 또는 user_id가 없습니다:", bubbleResult);
          Alert.alert("로그인 실패", "서버 응답이 올바르지 않습니다.");
        }
      
    } catch (error: any) {
        console.error("❌ [카카오] 네이티브 로그인 실패:", error);
        console.log("🧪 [카카오] 오류 상세:", {
          name: error?.name,
          message: error?.message,
          code: error?.code,
          stack: error?.stack?.split('\n')[0]
        });
      
        // 사용자가 취소한 경우
        if (error?.message?.toLowerCase?.().includes("cancel")) {
          console.log("ℹ️ [카카오] 사용자가 로그인을 취소했습니다");
          Alert.alert("알림", "카카오 로그인이 취소되었습니다.");
        } else {
          // 실패 시 웹 로그인으로 전환
          Alert.alert(
            "카카오 로그인 실패",
            "카카오 앱을 통한 로그인에 실패했습니다. 웹 로그인을 시도하시겠습니까?",
            [
              { text: "취소", style: "cancel" },
              {
                text: "웹 로그인",
                onPress: () => {
                  sendMessageToWebView({
                    type: "SWITCH_TO_WEB_LOGIN",
                    reason: "네이티브 카카오 로그인 실패",
                  });
                },
              },
            ]
          );
        }
    }
    }, [expoPushToken]);

  // ==================== 로그인 성공 처리 ====================
  const handleLoginSuccess = useCallback(
    async (message: WebViewMessage) => {
      try {
        console.log("🔐 [로그인] 성공 처리");

        if (!message.userId) {
          console.warn("⚠️ [로그인] userId 없음");
          return;
        }

        await AsyncStorage.setItem("user_id", message.userId);
        console.log("✅ [저장소] userId 저장:", message.userId);

        if (expoPushToken) {
          await savePushTokenToBubble(message.userId, expoPushToken);
        }
      } catch (error) {
        console.error("❌ [로그인] 오류:", error);
      }
    },
    [expoPushToken]
  );

  // ==================== 로그아웃 ====================
  const handleLogout = useCallback(async () => {
    try {
      console.log("🔓 [로그아웃] 처리");
      await AsyncStorage.removeItem("user_id");
      console.log("✅ [로그아웃] 완료");
    } catch (error) {
      console.error("❌ [로그아웃] 오류:", error);
    }
  }, []);

  // ==================== WebView 통신 ====================
  const sendMessageToWebView = useCallback((message: any) => {
    if (webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify(message));
      console.log("📤 [WebView] 메시지 전송:", message.type);
    } else {
      console.warn("⚠️ [WebView] ref 준비 안 됨");
    }
  }, []);

  // ==================== 플랫폼 정보 ====================
  const getPlatformInfo = useCallback((): PlatformInfo => {
    return {
      platform: Platform.OS,
      isApp: true,
      appVersion: "1.0.0",
      deviceType: Platform.OS === "ios" ? "iPhone" : "Android",
    };
  }, []);

  // ==================== Injected JavaScript ====================
  const injectedJavaScript = `
    (function() {
      try {
        // ==================== Map Center Preservation System ====================
        // Define default Seoul coordinates (should only be used on initial load)
        const DEFAULT_SEOUL_LAT = 37.566826;
        const DEFAULT_SEOUL_LNG = 126.9786567;
        
        // Store the last VALID map center (set by ApplyMapCenter or user interaction)
        // This will be restored if category changes try to reset the map to default
        window.__savedMapCenter = null;
        
        // Track if this is the first map load
        window.__isFirstMapLoad = true;

        window.isNativeApp = true;
        window.platformInfo = {
          platform: "${Platform.OS}",
          isApp: true,
          appVersion: "1.0.0",
          deviceType: "${Platform.OS === "ios" ? "iPhone" : "Android"}"
        };
        
        console.log('[Platform] Native app environment');

        window.sendToNative = function(message) {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify(message));
          }
        };
        
        // ============= Location Update Handler =============
        // Listen for location updates from React Native
        window.addEventListener('message', function(event) {
          try {
            const data = JSON.parse(event.data);
            
            console.log('[RN→WebView] Raw message received:', event.data.substring(0, 100));
            
            // Handle initial location update (sent immediately after WebView loads)
            if (data.type === 'LOCATION_INIT' || data.type === 'LOCATION_UPDATE' || data.type === 'GPS_UPDATE') {
              console.log('[RN→WebView] Location message detected:', data.type);
              console.log('[RN→WebView] window.__updateMapFromRN exists?', typeof window.__updateMapFromRN);
              console.log('[RN→WebView] All window properties with "map":', Object.keys(window).filter(k => k.toLowerCase().includes('map')).join(', '));
              console.log('[RN→WebView] All window properties with "update":', Object.keys(window).filter(k => k.toLowerCase().includes('update')).join(', '));
              
              if (typeof window.__updateMapFromRN === 'function') {
                console.log('[RN→WebView] Calling window.__updateMapFromRN with lat=' + data.lat + ', lng=' + data.lng + ', heading=' + (data.heading || 0));
                try {
                  window.__updateMapFromRN(data.lat, data.lng, data.heading || 0);
                  console.log('[RN→WebView] ✅ window.__updateMapFromRN called successfully');
                } catch (err) {
                  console.error('[RN→WebView] ❌ Error calling window.__updateMapFromRN:', err.message);
                }
              } else {
                console.warn('[RN→WebView] ⚠️ window.__updateMapFromRN not defined');
                console.warn('[RN→WebView] Trying to manually update map using Bubble workflow...');
                
                // Fallback: Try to trigger Bubble's location update workflow directly
                if (typeof window.triggerWorkflow === 'function') {
                  console.log('[RN→WebView] Found window.triggerWorkflow, calling it');
                  window.triggerWorkflow('update_user_location', { lat: data.lat, lng: data.lng, heading: data.heading });
                } else {
                  console.log('[RN→WebView] window.triggerWorkflow not found either');
                }
                
                // Queue the update to retry when function is available
                window.__pendingLocationUpdate = data;
              }
            } else {
              console.log('[RN→WebView] Non-location message type:', data.type || 'unknown');
            }
          } catch (e) {
            console.log('[RN→WebView] Message parse error (probably non-JSON):', e.message);
          }
        });
        
        // Retry queued location update if __updateMapFromRN becomes available
        const checkPendingUpdate = setInterval(function() {
          if (window.__pendingLocationUpdate && typeof window.__updateMapFromRN === 'function') {
            const data = window.__pendingLocationUpdate;
            console.log('[RN→WebView] Applying queued location update');
            window.__updateMapFromRN(data.lat, data.lng, data.heading || 0);
            window.__pendingLocationUpdate = null;
            clearInterval(checkPendingUpdate);
          }
        }, 100);
        setTimeout(function() { 
          clearInterval(checkPendingUpdate);
          if (window.__pendingLocationUpdate) {
            console.error('[RN→WebView] ❌ Timeout: window.__updateMapFromRN never became available after 10s');
            console.error('[RN→WebView] This means Bubble has not defined the function that RN expects');
          }
        }, 10000);

        const style = document.createElement('style');
        style.innerHTML = \`body { padding-bottom: ${insets.bottom}px !important; }\`;
        document.head.appendChild(style);
        
        console.log('[Setup] Injected JavaScript initialized');

        // ============= Deep Link Interception =============
        function isKakaoScheme(u) {
          if (!u || typeof u !== 'string') return false;
          try {
            return /^kakao[a-z0-9]*:\/\//i.test(u) || u.startsWith('intent://') || u.startsWith('kakaolink://');
          } catch (e) { return false; }
        }

        function postDeepLink(u){
          try {
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'OPEN_DEEP_LINK', url: u }));
            }
          } catch (e) { console.error('[DeepLink] Error posting:', e); }
        }

        // ============= Map Center Preservation Logic =============
        // This intercepts setCenter calls to:
        // 1. Allow the FIRST call to default coordinates (initial page load)
        // 2. Store any valid coordinates set by ApplyMapCenter
        // 3. Block subsequent calls to default coordinates (from category handlers)
        // 4. Restore saved center when category changes try to reset it
        
        window.__installMapInterceptor = function() {
          try {
            if (typeof naver === 'undefined' || !naver.maps || !naver.maps.Map) {
              console.log('[Map] Naver Maps not yet loaded, will retry');
              return false;
            }
            
            const OriginalMap = naver.maps.Map;
            
            naver.maps.Map = function(...args) {
              const mapInstance = new OriginalMap(...args);
              const originalSetCenter = mapInstance.setCenter.bind(mapInstance);
              
              mapInstance.setCenter = function(latlng) {
                const lat = latlng?.lat !== undefined ? latlng.lat : (latlng?.y !== undefined ? latlng.y : null);
                const lng = latlng?.lng !== undefined ? latlng.lng : (latlng?.x !== undefined ? latlng.x : null);
                
                if (lat === null || lng === null) {
                  console.log('[Map] setCenter called with invalid coordinates, allowing');
                  return originalSetCenter(latlng);
                }
                
                const isDefaultCoords = Math.abs(lat - DEFAULT_SEOUL_LAT) < 0.00001 && Math.abs(lng - DEFAULT_SEOUL_LNG) < 0.00001;
                const isSavedCenter = window.__savedMapCenter && 
                  Math.abs(lat - window.__savedMapCenter.lat) < 0.00001 && 
                  Math.abs(lng - window.__savedMapCenter.lng) < 0.00001;
                
                console.log('[Map] setCenter called: lat=' + lat + ', lng=' + lng + ', isDefault=' + isDefaultCoords + ', isSaved=' + isSavedCenter);
                
                // Allow first call (even if it's default - it's initial page load)
                if (window.__isFirstMapLoad) {
                  console.log('[Map] First map load - allowing coordinates');
                  window.__isFirstMapLoad = false;
                  
                  // If it's NOT default, save it as the valid center
                  if (!isDefaultCoords) {
                    window.__savedMapCenter = { lat: lat, lng: lng };
                    console.log('[Map] Saved non-default center: lat=' + lat + ', lng=' + lng);
                  }
                  
                  return originalSetCenter(latlng);
                }
                
                // After first load: Block attempts to reset to default coordinates
                if (isDefaultCoords && window.__savedMapCenter) {
                  console.warn('[Map] BLOCKED: Attempt to reset to default Seoul coordinates');
                  console.log('[Map] RESTORING: Saved center lat=' + window.__savedMapCenter.lat + ', lng=' + window.__savedMapCenter.lng);
                  return originalSetCenter(new naver.maps.LatLng(window.__savedMapCenter.lat, window.__savedMapCenter.lng));
                }
                
                // Block attempts to reset to default even if we don't have a saved center
                if (isDefaultCoords && !window.__savedMapCenter) {
                  console.warn('[Map] BLOCKED: Attempt to reset to default Seoul coordinates (no saved center yet)');
                  return;
                }
                
                // Allow any other coordinates (ApplyMapCenter, user pan/zoom, etc)
                if (!isDefaultCoords) {
                  window.__savedMapCenter = { lat: lat, lng: lng };
                  console.log('[Map] Updated saved center: lat=' + lat + ', lng=' + lng);
                }
                
                return originalSetCenter(latlng);
              };
              
              return mapInstance;
            };
            
            // Preserve static methods and properties
            for (let key in OriginalMap) {
              if (OriginalMap.hasOwnProperty(key) && key !== 'prototype') {
                try {
                  naver.maps.Map[key] = OriginalMap[key];
                } catch (e) {}
              }
            }
            
            console.log('[Map] Naver Maps constructor interceptor installed');
            return true;
          } catch (error) {
            console.error('[Map] Error installing interceptor:', error.message);
            return false;
          }
        };
        
        // Try to install interceptor immediately, then retry periodically
        let interceptorInstalled = window.__installMapInterceptor();
        if (!interceptorInstalled) {
          const retryInterval = setInterval(() => {
            if (window.__installMapInterceptor()) {
              clearInterval(retryInterval);
            }
          }, 500);
          setTimeout(() => clearInterval(retryInterval), 10000); // Stop trying after 10 seconds
        }

        // ============= Monitor for map center resets during category changes =============
        // Even with the interceptor, check periodically to catch any resets
        setInterval(() => {
          try {
            if (!window.__savedMapCenter || typeof naver === 'undefined' || !naver.maps) {
              return;
            }
            
            const mapContainers = document.querySelectorAll('[data-naver-map], .naver-map, #map, .map-container');
            mapContainers.forEach(container => {
              if (!container.__naverMap) return;
              
              const mapInstance = container.__naverMap;
              const currentCenter = mapInstance.getCenter ? mapInstance.getCenter() : null;
              
              if (!currentCenter) return;
              
              const lat = currentCenter.lat || currentCenter.y;
              const lng = currentCenter.lng || currentCenter.x;
              
              if (!lat || !lng) return;
              
              const isAtDefault = Math.abs(lat - DEFAULT_SEOUL_LAT) < 0.00001 && Math.abs(lng - DEFAULT_SEOUL_LNG) < 0.00001;
              const isAtSaved = Math.abs(lat - window.__savedMapCenter.lat) < 0.00001 && Math.abs(lng - window.__savedMapCenter.lng) < 0.00001;
              
              if (isAtDefault && !isAtSaved) {
                console.warn('[Map] DETECTED: Map reset to default Seoul! RESTORING saved center...');
                mapInstance.setCenter(new naver.maps.LatLng(window.__savedMapCenter.lat, window.__savedMapCenter.lng));
              }
            });
          } catch (e) {
            // Silently ignore errors in monitoring
          }
        }, 1000);

        // ============= Deep Link Hooks =============
        const _assign = window.location.assign.bind(window.location);
        window.location.assign = function(u){
          if (isKakaoScheme(u)) { postDeepLink(u); return; }
          _assign(u);
        };
        const _replace = window.location.replace.bind(window.location);
        window.location.replace = function(u){
          if (isKakaoScheme(u)) { postDeepLink(u); return; }
          _replace(u);
        };

        const _open = window.open.bind(window);
        window.open = function(u, n, f){
          if (isKakaoScheme(u)) { postDeepLink(u); return null; }
          return _open(u, n, f);
        };

        document.addEventListener('click', function(e){
          try{
            const a = e.target && (e.target.closest ? e.target.closest('a') : null);
            if (a && a.href && isKakaoScheme(a.href)) {
              e.preventDefault();
              postDeepLink(a.href);
            }
          }catch(_){}
        }, true);

        console.log('[System] Map center preservation system activated');
      } catch (error) {
        console.error('[System] Initialization error:', error);
      }
    })();
    true;
  `;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

  {/* StatusBar & Safe area padding to prevent WebView overlapping system UI */}
  <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
  <View style={[styles.container, { paddingTop: insets.top }]}>
        {loading && (
          <View style={styles.splash}>
            <Image
              source={require("../assets/logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.title}>🚀 TimeDealing</Text>
            <ActivityIndicator size="large" color="#fff" style={styles.spinner} />
          </View>
        )}

        <WebView
          ref={webViewRef}
          originWhitelist={["*"]}
          source={{ uri: WEBVIEW_URL }}
          style={styles.webview}
          onShouldStartLoadWithRequest={(request) => {
            const url = request.url;

            console.log("\n═══════════════════════════════════════");
            console.log("📍 [WebView] 링크 감지!");
            console.log("   URL:", url);
            console.log("═══════════════════════════════════════\n");

            // ✅ Remove legacy timedealing://kakao-login interception (handled by native deep link elsewhere)
            if (url.startsWith("timedealing://kakao-login")) {
              console.log("ℹ️ [WebView] timedealing://kakao-login 더 이상 WebView에서 인터셉트하지 않습니다");
              // Allow bubble's internal redirect to finish; native listener will catch deep link.
              return true;
            }

            // ✅ kakaolink:// (카카오 공유)
            if (url.startsWith("kakaolink://")) {
              console.log("📤 kakaolink:// 감지!");
              try {
                Linking.openURL(url);
              } catch (error) {
                console.error("❌ 카카오 공유 실패:", error);
              }
              return false;
            }

            // ✅ intent:// (카카오 내부)
            if (url.startsWith("intent://")) {
              console.log("🔀 intent:// 감지!");
              try {
                Linking.openURL(url);
              } catch (error) {
                console.error("❌ Intent 실패:", error);
              }
              return false;
            }

            // ✅ kakao native schemes (kakao..., kakaod...)
            if (/^kakao[a-z0-9]*:\/\//i.test(url)) {
              console.log("🔐 Kakao 스킴 감지!", url);
              console.log("🔄 [Kakao] 네이티브 SDK 로그인으로 전환합니다...");
              
              // Instead of trying to open the OAuth URL, trigger native SDK login
              handleKakaoLoginRequest("Android")
                .catch(error => {
                  console.error("❌ [Kakao] 네이티브 로그인 호출 실패:", error);
                  // Fallback: Try to open KakaoTalk directly
                  Linking.canOpenURL("kakaotalk://")
                    .then(supported => {
                      if (supported) {
                        return Linking.openURL("kakaotalk://");
                      } else {
                        console.warn("⚠️ KakaoTalk 미설치. Play Store 이동...");
                        return Linking.openURL('market://details?id=com.kakao.talk')
                          .catch(() => Linking.openURL('https://play.google.com/store/apps/details?id=com.kakao.talk'));
                      }
                    })
                    .catch(err => console.error("❌ Fallback 실패:", err));
                });
              
              return false;
            }

            // ✅ Native Kakao redirect scheme now handled by Linking listener; do not intercept
            if (url.startsWith(`kakaod${KAKAO_NATIVE_APP_KEY}://`) || url.startsWith(`kakao${KAKAO_CLIENT_ID}://`)) {
              console.log("ℹ️ [WebView] Kakao native redirect 스킴 WebView 패스스루");
              return true;
            }

            // ✅ HTTP/HTTPS는 정상 로드
            if (url.startsWith("http://") || url.startsWith("https://")) {
              return true;
            }

            return false;
          }}
          onLoadEnd={handleLoadEnd}
          onError={handleLoadError}
          onMessage={handleWebViewMessage}
          injectedJavaScript={injectedJavaScript}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          cacheEnabled={true}
          sharedCookiesEnabled={true}
          thirdPartyCookiesEnabled={true}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          scalesPageToFit={true}
          startInLoadingState={true}
          mixedContentMode="always"
          allowFileAccess={true}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#D71920" />
            </View>
          )}
        />

        {insets.bottom > 0 && (
          <View style={[styles.safeAreaPadding, { height: insets.bottom }]} />
        )}
      </View>
    </>
  );
}

// ==================== 스타일 ====================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  splash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#D71920",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 999,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 10,
  },
  webview: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  safeAreaPadding: {
    backgroundColor: "#fff",
  },
  spinner: {
    marginTop: 20,
  },
});