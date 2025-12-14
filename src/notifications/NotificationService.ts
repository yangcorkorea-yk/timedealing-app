// ✅ src/notifications/NotificationService.ts
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * ✅ Expo Bare Workflow 푸시 알림 서비스
 * - Android/iOS: expo-notifications가 네이티브 FCM 처리
 * - Web: firebase/messaging 별도 처리 필요 (여기서는 제외)
 * - Expo Push Token 사용 (서버에서 FCM으로 변환)
 */

// ✅ 알림 표시 정책 설정 (모듈 로드 시 즉시 등록)
console.log("🔧 [Notifications] 핸들러 등록 중...");

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    console.log("🔔 [Handler] 알림 수신 감지:", notification.request.identifier);
    
    // Foreground display config (Android/iOS)
    const cfg = {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    };
    
    console.log("✅ [Handler] 포그라운드 표시 설정 반환:", cfg);
    return cfg;
  },
});

console.log("✅ [Notifications] 핸들러 등록 완료");

/**
 * ✅ 푸시 알림 등록 및 토큰 발급
 * @returns Expo Push Token (서버로 전송할 토큰)
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  try {
    console.log("🚀 [Push] 등록 시작...");
    
    // ✅ 1. 실제 기기 체크 (시뮬레이터/에뮬레이터 제외)
    if (!Device.isDevice) {
      console.warn("⚠️ 푸시 알림은 실제 기기에서만 작동합니다.");
      return null;
    }
    console.log("✅ [Push] 실제 디바이스 확인");

    // ✅ 2. 권한 요청
    const { status: existingStatus, canAskAgain, granted } = await Notifications.getPermissionsAsync();
    console.log("🔐 [알림권한] 상태:", { existingStatus, canAskAgain, granted });
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      console.log("🔐 [알림권한] 권한 요청 중...");
      const { status, granted: newGranted } = await Notifications.requestPermissionsAsync();
      console.log("🔐 [알림권한] 요청 결과:", { status, granted: newGranted });
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.error("❌ 알림 권한이 거부되었습니다. 설정에서 권한을 허용해주세요.");
      return null;
    }
    console.log("✅ [알림권한] 승인됨");

    // ✅ 3. Android 알림 채널 생성 (필수!)
    if (Platform.OS === "android") {
      console.log("📡 [Android] 알림 채널 생성 중...");
      
      const channel = await Notifications.setNotificationChannelAsync("default", {
        name: "기본 알림",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#FF231F7C",
        sound: "default",
        enableVibrate: true,
        enableLights: true,
        showBadge: true,
      });
      
      console.log("📡 [Android] 알림 채널 설정 완료:", {
        id: channel?.id,
        name: channel?.name,
        importance: channel?.importance,
      });
      
      // Verify channel was created
      const channels = await Notifications.getNotificationChannelsAsync();
      console.log("📡 [Android] 모든 채널:", channels?.map(c => ({ id: c.id, name: c.name })));
    }

    // ✅ 4. Expo Push Token 발급
    // Bare Workflow에서는 projectId를 명시해야 함
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    
    if (!projectId) {
      console.error("❌ EAS projectId가 설정되지 않았습니다. app.json 확인 필요");
      return null;
    }

    const token = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    const expoPushToken = token.data;
    console.log("📱 Expo Push Token:", expoPushToken);

    // ✅ 5. 로컬 저장 (로그인 후 서버로 전송용)
    await AsyncStorage.setItem("expo_push_token", expoPushToken);

    return expoPushToken;
  } catch (error) {
    console.error("❌ 푸시 알림 등록 실패:", error);
    return null;
  }
}

/**
 * ✅ 저장된 푸시 토큰 가져오기
 */
export async function getSavedPushToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem("expo_push_token");
  } catch (error) {
    console.error("❌ 토큰 조회 실패:", error);
    return null;
  }
}

/**
 * ✅ 로컬 테스트 알림 스케줄러 (디버깅용)
 */
export async function scheduleLocalTestNotification(title = "테스트 알림", body = "로컬 알림 표시 테스트") {
  try {
    console.log("🧪 [로컬알림] 스케줄링 시작:", { title, body });
    
    // Check permissions first
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      console.error("❌ [로컬알림] 권한 없음:", status);
      return null;
    }
    
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: { source: "local-test", timestamp: Date.now() },
        sound: true,
        priority: Notifications.AndroidNotificationPriority.MAX,
      },
      trigger: null, // 즉시
    });
    
    console.log("✅ [로컬알림] 스케줄 완료, ID:", id);
    
    // Verify the notification was scheduled
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    console.log("📋 [로컬알림] 예약된 알림 수:", scheduled.length);
    
    return id;
  } catch (e) {
    console.error("❌ [로컬알림] 스케줄 실패:", e);
    return null;
  }
}

/**
 * ✅ 알림 수신 리스너 등록
 * @param callbacks 콜백 함수들 (선택)
 * @param callbacks.onNotificationReceived 알림 수신 시 콜백
 * @param callbacks.onNotificationTap 알림 클릭 시 콜백
 * @returns cleanup 함수
 */
export function setupNotificationListeners(callbacks?: {
  onNotificationReceived?: (notification: any) => void;
  onNotificationTap?: (data: any) => void;
}) {
  console.log("🎧 [Notifications] 리스너 등록 중...", {
    hasReceivedCallback: !!callbacks?.onNotificationReceived,
    hasTapCallback: !!callbacks?.onNotificationTap,
  });

  // 앱이 포그라운드에 있을 때 알림 수신
  const receivedListener = Notifications.addNotificationReceivedListener(
    (notification) => {
      console.log("📩 [Service] 알림 수신 이벤트:", notification.request.content);
      
      // ✅ 콜백 호출
      if (callbacks?.onNotificationReceived) {
        console.log("🔄 [Service] onNotificationReceived 콜백 호출");
        callbacks.onNotificationReceived(notification.request.content);
      } else {
        console.warn("⚠️ [Service] onNotificationReceived 콜백 없음!");
      }
    }
  );

  // 사용자가 알림을 탭했을 때
  const responseListener = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      console.log("📲 [Service] 알림 탭 이벤트:", response.notification.request.content);
      const data = response.notification.request.content.data;
      
      // ✅ 콜백 호출
      if (callbacks?.onNotificationTap) {
        console.log("🔄 [Service] onNotificationTap 콜백 호출");
        callbacks.onNotificationTap(data);
      } else {
        console.warn("⚠️ [Service] onNotificationTap 콜백 없음!");
      }
    }
  );

  console.log("✅ [Service] 리스너 등록 완료");

  // ✅ cleanup 함수 반환 (useEffect에서 사용)
  return () => {
    console.log("🧹 [Service] 리스너 제거 중...");
    receivedListener.remove();
    responseListener.remove();
    console.log("✅ [Service] 리스너 제거 완료");
  };
}

/**
 * ✅ 서버로 토큰 전송
 * @param token Expo Push Token
 * @param userId 사용자 ID
 */
export async function sendTokenToServer(
  token: string,
  userId: string
): Promise<boolean> {
  try {
    const response = await fetch("https://your-api.com/api/push-tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token,
        userId,
        platform: Platform.OS,
        deviceId: Constants.deviceId,
      }),
    });

    if (!response.ok) {
      throw new Error("서버 전송 실패");
    }

    console.log("✅ 토큰 서버 전송 완료");
    return true;
  } catch (error) {
    console.error("❌ 토큰 서버 전송 실패:", error);
    return false;
  }
}