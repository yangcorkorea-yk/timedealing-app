// app/index.tsx - 카카오 로그인 (GPT 방식: NativeEventEmitter로 이벤트 수신)

import React, { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, StyleSheet, Image, Platform, ActivityIndicator, Linking, NativeEventEmitter, NativeModules, Alert, StatusBar } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack } from "expo-router";
import { initializeKakaoSDK } from "@react-native-kakao/core";
import { login } from "@react-native-kakao/user";
import * as Notifications from "expo-notifications";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { ensureFirebaseInitialized } from "../src/firebase/init";
import {
  registerForPushNotificationsAsync,
  setupNotificationListeners,
  scheduleLocalTestNotification,
} from "../src/notifications/NotificationService";

// ==================== 상수 ====================
const BUBBLE_API_BASE = "https://timedealing.com/version-test/api/1.1/wf";
const WEBVIEW_URL = "https://timedealing.com/version-test/";
// Kakao Native login handled via @react-native-kakao/user (no OAuth redirect URIs needed)

// ==================== 타입 정의 ====================
interface WebViewMessage {
  type: string;
  payload?: any;
}

export default function App() {
  const [webViewUrl, setWebViewUrl] = useState<string>(WEBVIEW_URL);
  const [isWebViewLoading, setIsWebViewLoading] = useState(true);
  const [isAppReady, setIsAppReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isKakaoLoginInProgress, setIsKakaoLoginInProgress] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const locationSubscriptionRef = useRef<any>(null);
  const kakaoLoginInFlightRef = useRef(false);
  const insets = useSafeAreaInsets();
  const [expoPushToken, setExpoPushToken] = useState<string | undefined>(undefined);

  // Kakao SDK must be initialized once on app start (use Native App Key)
  useEffect(() => {
    initializeKakaoSDK("d6914396676906ad440f0d308ed139d1");
    console.log("✅ Kakao SDK initialized");
  }, []);

  // Safe splash hide helper (avoid unregistered splash rejection in dev client)
  const hideSplashSafe = useCallback(async () => {
    try {
      await SplashScreen.hideAsync();
    } catch (err) {
      console.warn("⚠️ [Splash] hideAsync 실패, 무시합니다:", err?.message || err);
    }
  }, []);

  // Keep splash screen until first meaningful load; ignore errors if already hidden/absent.
  useEffect(() => {
    SplashScreen.preventAutoHideAsync().catch((err) => {
      console.warn("⚠️ [Splash] preventAutoHideAsync 실패, 무시합니다:", err?.message || err);
    });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await ensureFirebaseInitialized();
        console.log("✅ Firebase initialized");
      } catch (error) {
        console.error("❌ Firebase initialization failed:", error);
      }

      const token = await registerForPushNotificationsAsync();
      setExpoPushToken(token);
      console.log("📱 Expo Push Token:", token);
    })();

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

  // ==================== 카카오 네이티브 로그인 ====================
  const handleKakaoLogin = useCallback(async () => {
    try {
      console.log("🔑 [카카오] 네이티브 로그인 시작");
      const token = await login();

      console.log("✅ [카카오] 로그인 성공, 토큰:", token.accessToken.substring(0, 20) + "...");

      // Fetch user info with access token
      await fetchKakaoUserInfo(token.accessToken);
    } catch (error) {
      console.error("❌ [카카오] 네이티브 로그인 실패:", error);
      Alert.alert("로그인 실패", "카카오 로그인에 실패했습니다.");
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
    await hideSplashSafe();
    
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

  // ==================== Haptic Feedback ====================
  const triggerHaptic = useCallback(async (type: string) => {
    try {
      if (type === "tab") {
        await Haptics.selectionAsync();
      } else if (type === "impact") {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } else if (type === "notification-success") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (type === "notification-error") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (error) {
      console.warn("⚠️ [Haptic] 피드백 실패:", error);
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
  // ==================== 카카오 로그인 (Native SDK) ====================
  const kakaoLogin = async (): Promise<string> => {
    console.log("🚀 [카카오] 카카오 로그인 시작");
    try {
      console.log("📞 [카카오] login() 호출 중...");
      
      // Add timeout to detect if login() never resolves
      const loginPromise = login();
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error("로그인 타임아웃 (30초)")), 30000)
      );
      
      const result = await Promise.race([loginPromise, timeoutPromise]);
      
      console.log("📦 [카카오] login() 결과 수신:", JSON.stringify(result).substring(0, 100));

      if (!result?.accessToken) {
        throw new Error("AccessToken 없음");
      }

      console.log("✅ [카카오] 로그인 성공, 토큰:", result.accessToken.substring(0, 20) + "...");
      return result.accessToken;
    } catch (error: any) {
      console.error("❌ [카카오] 로그인 실패:", error?.message || error);
      Alert.alert("카카오 로그인 오류", error?.message || "알 수 없는 오류");
      throw error;
    }
  };

  // ✅ Step 2: Bubble Backend 호출
  const callBubbleBackend = async (accessToken: string): Promise<any> => {
    console.log("📡 [Bubble] Backend 호출 시작");
    console.log("🔑 [accessToken]", accessToken.substring(0, 30) + "...");
    
    const res = await fetch(
      "https://timedealing.com/version-test/api/1.1/wf/kakao-login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: accessToken,
          device_token: expoPushToken || ""
        })
      }
    );

    const result = await res.json();
    console.log("✅ [Bubble] Backend 응답:", result);
    
    return result;
  };

  // ✅ Step 3: 웹뷰에 결과 전달
  const sendKakaoLoginResultToWebView = (bubbleResponse: any) => {
    console.log("📨 [WebView] 카카오 로그인 결과 전달");
    if (webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify({
        type: "KAKAO_LOGIN_SUCCESS",
        payload: bubbleResponse
      }));
    }
  };

  // ✅ 카카오 로그인 요청 핸들러
  const handleKakaoLoginRequest = useCallback(async (platform: string) => {
    try {
      if (kakaoLoginInFlightRef.current) {
        console.log("⏳ [카카오] 로그인 이미 진행 중, 요청 무시");
        return;
      }

      kakaoLoginInFlightRef.current = true;
      setIsKakaoLoginInProgress(true);
      console.log(`📱 [카카오] ${platform} 로그인 시작`);
      
      // Step 1: 카카오 SDK로 로그인
      const accessToken = await kakaoLogin();
      
      // Step 2: Bubble Backend 호출
      const bubbleResponse = await callBubbleBackend(accessToken);
      
      // Step 3: 웹뷰로 결과 전달
      sendKakaoLoginResultToWebView(bubbleResponse);
      
      // Step 4: AsyncStorage에 사용자 ID 저장
      const userId = bubbleResponse.response?.user_id;
      if (userId) {
        await AsyncStorage.setItem("user_id", userId);
        console.log("💾 [저장] 사용자 ID:", userId);
        // Legacy flag removed to avoid auto-navigation logic elsewhere
        // await AsyncStorage.setItem("isLoggedIn", "true");
      }
    } catch (error: any) {
      console.error("❌ [카카오] 로그인 실패:", error?.message || error);
      Alert.alert("카카오 로그인 실패", error?.message || "카카오 로그인에 실패했습니다.");
      
      // 실패 시에도 웹뷰에 알림
      sendKakaoLoginResultToWebView({ error: error?.message });
    } finally {
      kakaoLoginInFlightRef.current = false;
      setIsKakaoLoginInProgress(false);
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
        // ==================== CRITICAL: Disable Bubble's Kakao Web OAuth ====================
        // Override Kakao SDK methods to prevent Bubble from running Web OAuth
        // This ensures only RN Native SDK handles Kakao login
        console.log('[RN→WebView] Installing Kakao Web OAuth blocker...');
        
        // Wait for Kakao SDK to load, then override it
        const disableKakaoWebAuth = () => {
          if (typeof window.Kakao !== 'undefined' && window.Kakao.Auth) {
            console.log('[RN→WebView] ⚠️ Kakao JS SDK detected → Disabling Web OAuth methods');
            
            // Override authorize (Web OAuth redirect)
            window.Kakao.Auth.authorize = function() {
              console.log('[RN→WebView] 🚫 Kakao.Auth.authorize blocked (RN Native only)');
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'KAKAO_LOGIN' }));
              }
            };
            
            // Override login (Web OAuth popup)
            window.Kakao.Auth.login = function() {
              console.log('[RN→WebView] 🚫 Kakao.Auth.login blocked (RN Native only)');
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'KAKAO_LOGIN' }));
              }
            };
            
            console.log('[RN→WebView] ✅ Kakao Web OAuth disabled successfully');
          }
        };
        
        // Try immediately
        disableKakaoWebAuth();
        
        // Retry periodically for 5 seconds (in case SDK loads later)
        let attempts = 0;
        const checkInterval = setInterval(() => {
          attempts++;
          if (typeof window.Kakao !== 'undefined' && window.Kakao.Auth) {
            disableKakaoWebAuth();
            clearInterval(checkInterval);
          } else if (attempts > 50) { // 50 * 100ms = 5 seconds
            clearInterval(checkInterval);
            console.log('[RN→WebView] Kakao SDK not detected after 5s → assuming not loaded');
          }
        }, 100);
        
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
            const loweredUrl = url.toLowerCase();
            const isKakaoFlow = isKakaoLoginInProgress || kakaoLoginInFlightRef.current;

            console.log("\n═══════════════════════════════════════");
            console.log("📍 [WebView] 링크 감지!");
            console.log("   URL:", url);
            console.log("═══════════════════════════════════════\n");

            // ✅ CRITICAL: Block ALL oauth page navigation (Bubble's Web OAuth)
            // This prevents Bubble's Kakao JS SDK from hijacking the login flow
            if (loweredUrl.includes("/oauth") || loweredUrl.includes("oauth-login") || loweredUrl.includes("kakao-callback")) {
              console.log("🚫 [WebView] OAuth 페이지 차단 (Bubble Web OAuth 무력화)", url);
              // Force redirect back to main page
              if (webViewRef.current) {
                setTimeout(() => {
                  console.log("🔄 [WebView] 메인 페이지로 강제 리다이렉트");
                  webViewRef.current?.injectJavaScript(`window.location.href = "${WEBVIEW_URL}"; true;`);
                }, 100);
              }
              return false;
            }

            // ✅ Block Kakao OAuth authorize URLs
            if (loweredUrl.includes("kauth.kakao.com") && loweredUrl.includes("authorize")) {
              console.log("🚫 [WebView] Kakao Web OAuth authorize 차단", url);
              return false;
            }

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
              // WebView 대신 OS에 위임
              Linking.canOpenURL(url)
                .then((supported) => (supported ? Linking.openURL(url) : Promise.reject(new Error("KakaoTalk 미설치"))))
                .catch((err) => console.warn("⚠️ Kakao 스킴 처리 실패:", err?.message || err));
              return false;
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