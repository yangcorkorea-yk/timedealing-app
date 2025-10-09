import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, Image, Platform, Alert } from "react-native";
import { WebView } from "react-native-webview";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

// 스플래시 자동 숨김 방지
SplashScreen.preventAutoHideAsync();

/**
 * 📌 로그인 후 푸시 토큰을 Bubble로 저장
 */
async function savePushTokenToBubble(user_id: string) {
  try {
    const token = await AsyncStorage.getItem("expo_push_token");
    if (!token) {
      console.log("⚠️ 저장된 푸시 토큰이 없습니다.");
      return;
    }

    const res = await fetch(
      "https://timedealing.com/version-test/api/1.1/wf/save_push_token",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, user_id }),
      }
    );

    const data = await res.json();
    console.log("✅ 푸시 토큰 Bubble 저장 완료:", data);
  } catch (err) {
    console.log("❌ 푸시 토큰 전송 실패:", err);
  }
}

/**
 * 📌 Bubble 로그인 (테스트용 — 실제 로그인화면에서만 호출)
 */
async function bubbleLogin(email: string, password: string) {
  try {
    const res = await fetch(
      "https://timedealing.com/version-test/api/1.1/wf/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      }
    );

    const data = await res.json();
    console.log("🔐 로그인 응답:", data);

    if (data?.status === "success") {
      console.log("✅ 로그인 성공:", data.response);
      await savePushTokenToBubble(data.response.user_id);
      return data.response;
    } else {
      console.log("⚠️ 로그인 실패:", data);
      return null;
    }
  } catch (error) {
    console.error("❌ Bubble 로그인 오류:", error);
    return null;
  }
}

/**
 * 메인 앱 컴포넌트
 */
export default function App() {
  const [loading, setLoading] = useState(true);
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);

  // 📌 앱 실행 시 푸시 토큰만 발급
  useEffect(() => {
    async function init() {
      const token = await registerForPushNotificationsAsync();
      if (token) {
        console.log("📲 발급된 Expo Push Token:", token);
        setExpoPushToken(token);
        await AsyncStorage.setItem("expo_push_token", token); // 로컬 저장
      }
    }

    init();

    // 📩 알림 수신 리스너
    const subscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log("🔔 알림 수신:", notification);
      }
    );

    // 📨 알림 클릭 리스너
    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        console.log("👉 알림 클릭:", response);
        // TODO: 예약 상세 등 특정 페이지로 이동
      });

    return () => {
      subscription.remove();
      responseSubscription.remove();
    };
  }, []);

  // 📌 WebView 로딩 완료 시 스플래시 제거
  const handleLoadEnd = async () => {
    setLoading(false);
    await SplashScreen.hideAsync();
  };

  return (
    <View style={{ flex: 1 }}>
      {/* 스플래시 로딩 화면 */}
      {loading && (
        <View style={styles.splash}>
          <Image
            source={require("../assets/logo.png")}
            style={{ width: 120, height: 120, marginBottom: 20 }}
          />
          <Text style={styles.title}>🚀 TimeDealing</Text>
          <Text style={styles.subtitle}>세상에 없던 시간거래</Text>
        </View>
      )}

      {/* WebView (Bubble 프론트엔드 표시) */}
      <WebView
        source={{ uri: "https://timedealing.com/version-test/" }}
        style={{ flex: 1 }}
        onLoadEnd={handleLoadEnd}
      />
    </View>
  );
}

/**
 * 📌 푸시 토큰 발급 함수
 */
async function registerForPushNotificationsAsync() {
  try {
    let token;
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      Alert.alert("푸시 알림 권한이 필요합니다.");
      return null;
    }

    const projectId = "c1ff80a7-1688-4042-8204-8f07131e8564";
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

    console.log("🔑 registerForPushNotificationsAsync → token:", token);

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
      });
    }

    return token;
  } catch (error) {
    console.log("❌ 푸시 등록 중 오류 발생:", error);
    return null;
  }
}

const styles = StyleSheet.create({
  splash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#D71920",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: "#fff",
  },
});