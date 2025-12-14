// src/notifications/registerPush.ts
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

export async function registerForPushToken(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('❌ 물리 디바이스에서만 푸시 토큰 발급 가능');
    return null;
  }

  // Android 13+ 권한(POST_NOTIFICATIONS) 요청 포함
  const { status: permStatus } = await Notifications.requestPermissionsAsync();
  if (permStatus !== 'granted') {
    console.log('❌ 알림 권한 거부됨');
    return null;
  }

  // SDK 48+에서는 projectId가 필요할 수 있음 (개발/Dev Client에서 특히)
  // app.json/app.config.js에 extra.eas.projectId가 있다면 자동으로 잡히지만,
  // 안전하게 아래처럼 명시 옵션을 주는 게 좋다.
  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ??
    Constants?.easConfig?.projectId; // 둘 중 하나 존재

  const tokenResponse = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );

  const token = tokenResponse.data;
  console.log('✅ Expo Push Token:', token);
  return token;
}