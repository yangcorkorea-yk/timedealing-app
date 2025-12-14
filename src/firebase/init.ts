// ✅ src/firebase/init.ts
import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAnalytics, isSupported as isAnalyticsSupported, Analytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDFteKDtNjZaagSB5F7Oc-LXsxBevoZmhY",
  authDomain: "timedealing-eac07.firebaseapp.com",
  projectId: "timedealing-eac07",
  storageBucket: "timedealing-eac07.appspot.com",
  messagingSenderId: "466502375753",
  appId: "1:466502375753:web:4c1d16d23000f5dabe6298",
  measurementId: "G-TSLWLJNQ4M",
};

let firebaseApp: FirebaseApp | null = null;
let analytics: Analytics | null = null;

/**
 * ✅ Firebase 초기화 함수
 * - Expo Bare Workflow 완벽 호환
 * - Analytics는 Web 환경에서만 활성화
 * - Messaging은 expo-notifications가 네이티브 레벨에서 처리
 */
export async function ensureFirebaseInitialized() {
  try {
    // Firebase App 초기화
    if (!getApps().length) {
      firebaseApp = initializeApp(firebaseConfig);
      console.log("✅ Firebase initialized successfully");
    } else {
      firebaseApp = getApp();
    }

    // ✅ Auth 초기화 (기본 persistence 사용)
    try {
      getAuth(firebaseApp!);
      console.log("🔐 Firebase Auth initialized");
    } catch (authErr) {
      console.log("ℹ️ Firebase Auth initialization skipped:", authErr);
    }

    // ✅ Analytics (Web 환경에서만)
    if (typeof window !== "undefined" && (await isAnalyticsSupported())) {
      analytics = getAnalytics(firebaseApp!);
      console.log("📊 Firebase Analytics initialized");
    }

  } catch (err) {
    console.error("❌ Firebase initialization error:", err);
  }
}

export function getFirebaseApp(): FirebaseApp {
  if (!firebaseApp) {
    throw new Error("Firebase not initialized. Call ensureFirebaseInitialized() first.");
  }
  return firebaseApp;
}

export { analytics };