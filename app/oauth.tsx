import { View } from 'react-native';

// Legacy OAuth callback screen — kept as a no-op to avoid unintended redirects.
// Native Kakao login no longer uses this page.
export default function OAuth() {
  return <View />;
}
