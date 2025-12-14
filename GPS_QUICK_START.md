# GPS Tracking Implementation Guide

## Quick Start

### 1. Import GPS Tracker Component

```typescript
import GPSTracker from '../src/gps/GPSTracker';
```

### 2. Add to Your App Component

```typescript
export default function App() {
  const webViewRef = useRef<WebView>(null);

  return (
    <>
      {/* GPS Tracker - must be added to enable tracking */}
      <GPSTracker
        webViewRef={webViewRef}
        onLocationUpdate={(location) => {
          console.log('Location updated:', location);
        }}
        onError={(error) => {
          console.error('GPS error:', error);
        }}
        enableBackgroundTracking={false}
        trackingInterval={5000}
        minimumDistance={5}
        accuracy={Location.Accuracy.BestForNavigation}
      />

      {/* Include GPS receiver script in WebView */}
      <WebView
        ref={webViewRef}
        source={{ uri: 'https://timedealing.com/version-test/' }}
        injectedJavaScript={gpsReceiverScript}
        onMessage={handleWebViewMessage}
        // ... other props
      />
    </>
  );
}
```

### 3. Load GPS Receiver Script in WebView

**Option A: Read from file**

```typescript
import * as FileSystem from 'expo-file-system';

useEffect(() => {
  FileSystem.readAsStringAsync(require('../web/gps-receiver.js')).then(script => {
    setGpsReceiverScript(script);
  });
}, []);
```

**Option B: Embed directly**

```typescript
const gpsReceiverScript = `
// ... paste contents of web/gps-receiver.js here ...
`;
```

### 4. Use GPS in WebView (Bubble App)

```html
<!-- Display GPS status -->
<div id="gps-status">GPS: Waiting...</div>
<div id="gps-accuracy">Accuracy: --</div>
<div id="gps-time">Updated: --</div>

<script>
  // Setup custom GPS update handler
  window.onGPSUpdate = function(location) {
    console.log('Map should update to:', location);
    // Update your map center here
    if (typeof naver !== 'undefined' && naver.maps) {
      // Update Naver map center
      const container = document.querySelector('#map');
      if (container && container.__naverMap) {
        container.__naverMap.setCenter(
          new naver.maps.LatLng(location.latitude, location.longitude)
        );
      }
    }
  };

  // Or add a listener
  window.addGPSListener(function(location) {
    console.log('Alternative listener:', location);
  });

  // Check status anytime
  setInterval(() => {
    const status = window.getGPSStatus();
    console.log('Tracking:', status.isTracking);
    console.log('Updates:', status.updateCount);
  }, 10000);
</script>
```

---

## Integration with Your App

### Update `app/index.tsx`

Replace the placeholder in your main App component:

```typescript
import GPSTracker from '../src/gps/GPSTracker';
import * as Location from 'expo-location';

export default function App() {
  const [loading, setLoading] = useState(true);
  const webViewRef = useRef<WebView>(null);
  const insets = useSafeAreaInsets();

  // GPS receiver script - read from file or embed
  const gpsReceiverScript = require('../web/gps-receiver.js');

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
      <View style={[styles.container, { paddingTop: insets.top }]}>
        
        {/* ADD THIS: GPS Tracker Component */}
        <GPSTracker
          webViewRef={webViewRef}
          onLocationUpdate={(location) => {
            console.log('[App] GPS Update:', location);
          }}
          onPermissionDenied={() => {
            console.log('[App] GPS permission denied');
          }}
          onError={(error) => {
            console.error('[App] GPS Error:', error);
          }}
          enableBackgroundTracking={false}
          trackingInterval={5000}
          minimumDistance={5}
          accuracy={Location.Accuracy.BestForNavigation}
        />

        {loading && (
          <View style={styles.splash}>
            {/* ... splash screen content ... */}
          </View>
        )}

        <WebView
          ref={webViewRef}
          originWhitelist={["*"]}
          source={{ uri: WEBVIEW_URL }}
          style={styles.webview}
          onLoadEnd={handleLoadEnd}
          onError={handleLoadError}
          onMessage={handleWebViewMessage}
          injectedJavaScript={gpsReceiverScript}
          javaScriptEnabled={true}
          // ... other props ...
        />

        {insets.bottom > 0 && (
          <View style={[styles.safeAreaPadding, { height: insets.bottom }]} />
        )}
      </View>
    </>
  );
}
```

---

## Native Configuration

### Android: AndroidManifest.xml

Add permissions to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
```

### iOS: Info.plist

Add to `ios/TimeDealing/Info.plist`:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>TimeDealing needs your location to show nearby deals.</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>TimeDealing uses your location for deal recommendations.</string>

<key>UIBackgroundModes</key>
<array>
  <string>location</string>
</array>
```

---

## Configuration Options

### GPSTrackerProps

```typescript
{
  // Required: WebView reference to send locations to
  webViewRef: React.RefObject<WebView>,

  // Optional: Callback when location updates
  onLocationUpdate?: (location: LocationData) => void,

  // Optional: Callback when permission denied
  onPermissionDenied?: () => void,

  // Optional: Callback on errors
  onError?: (error: string) => void,

  // Optional: Enable background tracking (default: false)
  enableBackgroundTracking?: boolean,

  // Optional: Update interval in milliseconds (default: 5000)
  trackingInterval?: number,

  // Optional: Minimum distance to trigger update in meters (default: 5)
  minimumDistance?: number,

  // Optional: Accuracy level (default: BestForNavigation)
  accuracy?: Location.Accuracy,
}
```

### Accuracy Levels

```typescript
// High accuracy - best for real-time tracking (high battery usage)
Location.Accuracy.BestForNavigation

// Balanced accuracy (default)
Location.Accuracy.Best

// Lower accuracy - battery friendly
Location.Accuracy.Lowest
```

---

## WebView GPS API

### Getting Location Updates

**Method 1: Custom Callback**

```javascript
window.onGPSUpdate = function(location) {
  console.log('GPS Update:', location);
  // location.latitude
  // location.longitude
  // location.accuracy
  // location.altitude
  // location.heading
  // location.speed
  // location.timestamp
};
```

**Method 2: Add Listener**

```javascript
window.addGPSListener(function(location) {
  console.log('Location:', location);
});

// Remove listener later
const myListener = function(location) { /* ... */ };
window.removeGPSListener(myListener);
```

### Checking Status

```javascript
// Get last location
const lastLocation = window.getLastLocation();
console.log('Last position:', lastLocation);

// Get full GPS status
const status = window.getGPSStatus();
console.log('Tracking active:', status.isTracking);
console.log('Total updates:', status.updateCount);
console.log('Last location:', status.lastLocation);
console.log('Last update time:', status.lastUpdateTime);
```

### State Object

```javascript
window.__gpsState = {
  isTracking: boolean,        // Is GPS currently tracking
  lastLocation: LocationData, // Last received location
  updateCount: number,        // Total location updates received
  errors: string[],           // Error messages
  listeners: Function[],      // Registered listeners
}
```

---

## Example: Update Map Center

```javascript
// Auto-update Naver map center with GPS
window.onGPSUpdate = function(location) {
  const container = document.querySelector('#map');
  if (!container || !container.__naverMap) return;

  const map = container.__naverMap;
  const newCenter = new naver.maps.LatLng(
    location.latitude,
    location.longitude
  );

  // Smoothly move to new center
  map.panTo(newCenter);
  
  console.log('Map updated to GPS location');
};
```

---

## Testing

### Test Checklist

- [ ] Foreground permission request appears
- [ ] GPS updates appear in console
- [ ] WebView receives location messages
- [ ] Map center updates with location
- [ ] Component cleans up on unmount
- [ ] Errors handled gracefully
- [ ] Permission denial handled
- [ ] Background tracking works (if enabled)

### Debug Commands

In WebView console:

```javascript
// Check if receiver initialized
console.log(window.__gpsState);

// Get current location
console.log(window.getLastLocation());

// Get status
console.log(window.getGPSStatus());

// Manually call update handler
window.onGPSUpdate && window.onGPSUpdate(window.getLastLocation());
```

---

## Common Issues

### GPS Not Updating

1. Check console for "[GPS]" logs
2. Verify location permission granted
3. Enable location services on device
4. Check WebView has `postMessage` available
5. Verify GPS receiver script injected

### WebView Not Receiving Updates

1. Check `webViewRef.current` is available
2. Verify `postMessage` in console shows no errors
3. Check WebView console for "[WebView-GPS]" logs
4. Ensure WebView source loaded successfully

### Permission Denied

1. App permissions revoked in settings
2. Location services disabled
3. Device privacy settings
4. iOS background permission requirements

### Background Tracking Not Working

1. Set `enableBackgroundTracking={true}`
2. Grant background location permission
3. Check Android foreground service notification
4. iOS requires background mode enabled in Xcode

---

## Performance Tips

1. **Battery**: Increase `trackingInterval` for longer periods
2. **Accuracy**: Use `Location.Accuracy.Lowest` for less critical features
3. **Network**: Minimize location processing in callbacks
4. **Memory**: Remove listeners when done with `removeGPSListener`
5. **Battery vs Accuracy**: Balance with your use case

---

## Next Steps

1. Add GPS component to app/index.tsx
2. Inject gps-receiver.js into WebView
3. Update Bubble app to handle GPS updates
4. Test on physical device (not simulator)
5. Monitor battery consumption
6. Add error tracking

For more details, see GPS_TRACKING_GUIDE.md
