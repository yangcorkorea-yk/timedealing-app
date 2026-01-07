module.exports = {
  dependencies: {
    'react-native-webview': {},
    '@react-native-async-storage/async-storage': {},
    '@react-native-kakao/core': {},
    '@react-native-kakao/user': {},
  },
  project: {
    android: {
      sourceDir: './android',
    },
    ios: {
      sourceDir: './ios',
    },
  },
};