import { useEffect } from "react";
import { View, Text, ActivityIndicator, Platform } from "react-native";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";

// ✅ 푸시 토큰 저장 함수 (index.tsx와 동일)
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
        body: JSON.stringify({ user_id, token }),
      }
    );

    const data = await res.json();
    console.log("✅ 푸시 토큰 Bubble 저장 완료:", data);
  } catch (err) {
    console.log("❌ 푸시 토큰 전송 실패:", err);
  }
}

export default function KakaoLogin() {
  const router = useRouter();

  useEffect(() => {
    async function handleRedirect() {
      // ✅ Redirect URL에서 code/state 파싱
      const url = await Linking.getInitialURL();
      console.log("🔗 Redirect URL:", url);
      if (!url) return;

      const parsed = Linking.parse(url);
      const code = parsed.queryParams?.code;
      const state = parsed.queryParams?.state;

      if (!code) {
        console.log("❌ code가 없습니다.");
        return;
      }

      // ✅ Bubble backend로 Kakao token 처리 요청
      try {
        const response = await fetch(
          "https://timedealing.com/version-test/api/1.1/wf/kakao-token-handler",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code,
              uri: "https://timedealing.com/version-test/kakao-login", // redirect URI
              state,
            }),
          }
        );

        const result = await response.json();
        console.log("✅ Bubble 응답:", result);

        // ✅ Bubble이 user_id 반환한다고 가정
        const user_id = result?.response?.user_id;
        if (user_id) {
          await savePushTokenToBubble(user_id);
          console.log("🎯 로그인 + 푸시토큰 저장 완료!");
        } else {
          console.log("⚠️ user_id가 응답에 없습니다:", result);
        }

        // 홈 화면으로 이동
        // Legacy redirect disabled to prevent premature home navigation during native Kakao flow
        // router.replace("/");
      } catch (error) {
        console.log("❌ 카카오 로그인 실패:", error);
      }
    }

    handleRedirect();
  }, []);

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#fff",
      }}
    >
      <ActivityIndicator size="large" color="#D71920" />
      <Text style={{ marginTop: 10 }}>카카오 로그인 중...</Text>
    </View>
  );
}