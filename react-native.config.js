module.exports = {
  dependencies: {
    'react-native-webview': {},
    '@react-native-async-storage/async-storage': {},
    '@react-native-seoul/kakao-login': {},
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