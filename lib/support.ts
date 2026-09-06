import { Alert, Linking } from 'react-native';

export const COFFEE_URL = 'https://ko-fi.com/andrej33';

/**
 * A purely voluntary tip prompt — no app feature is gated behind it, and
 * tapping "Buy me a coffee" hands off to the system browser rather than
 * processing any payment inside the app. That combination (no unlocked
 * content, no in-app payment flow) is what keeps a donation link like this
 * outside Apple's and Google's in-app-purchase requirements; turning this
 * into anything that unlocks app functionality would put it back under
 * those rules.
 */
export function showSupportPrompt() {
  Alert.alert(
    'Support this app',
    'This app was developed by a solo developer. If you want to support his work, feel free to buy him a coffee.',
    [
      { text: 'Maybe later', style: 'cancel' },
      { text: 'Buy me a coffee ☕', onPress: () => Linking.openURL(COFFEE_URL) },
    ]
  );
}
