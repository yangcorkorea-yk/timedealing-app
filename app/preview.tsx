import { View, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";
import { Stack } from "expo-router";

export default function Preview() {
  return (
    <View style={{ flex: 1 }}>
      {/* 상단 네비게이션 타이틀 */}
      <Stack.Screen options={{ title: "Bubble Preview" }} />

      {/* WebView로 Bubble 페이지 띄우기 */}
      <WebView
        source={{ uri: "https://timedealing.com/version-test/" }}
        startInLoadingState
        renderLoading={() => <ActivityIndicator style={{ marginTop: 100 }} />}
        javaScriptEnabled
        domStorageEnabled
      />
    </View>
  );
}