# Production-Ready GPS Tracking for React Native WebView

## Overview
Complete solution for continuous GPS tracking in React Native (Expo SDK 51) with WebView integration on iOS and Android.

---

## Part 1: React Native Component

### File: `app/gps/GPSTracker.tsx`

```typescript
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

// Define the task name for background location tracking
const LOCATION_TASK_NAME = 'background-location-task';

// Define location update events
interface LocationUpdate {
  type: 'LOCATION_UPDATE';
  data: {
    latitude: number;
    longitude: number;
    accuracy: number;
    altitude: number | null;
    heading: number | null;
    speed: number | null;
    timestamp: number;
  };
}

interface PermissionStatus {
  foreground: 'granted' | 'denied' | 'undetermined';
  background: 'granted' | 'denied' | 'undetermined';
}

export interface GPSTrackerProps {
  webViewRef: React.RefObject<WebView>;
  webViewUrl: string;
  onLocationUpdate?: (location: LocationUpdate['data']) => void;
  onPermissionDenied?: () => void;
  onError?: (error: string) => void;
  enableBackgroundTracking?: boolean;
  trackingInterval?: number; // milliseconds
  minimumDistance?: number; // meters
  accuracy?: Location.Accuracy;
}

/**
 * Production-ready GPS tracking component for React Native WebView
 * 
 * Features:
 * - Foreground and background location tracking
 * - Proper permission handling for iOS and Android 12+
 * - Continuous location updates with error recovery
 * - WebView message integration
 * - Automatic cleanup on unmount
 */
export default function GPSTracker({
  webViewRef,
  webViewUrl,
  onLocationUpdate,
  onPermissionDenied,
  onError,
  enableBackgroundTracking = false,
  trackingInterval = 5000,
  minimumDistance = 5,
  accuracy = Location.Accuracy.BestForNavigation,
}: GPSTrackerProps) {
  const [isTracking, setIsTracking] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>({
    foreground: 'undetermined',
    background: 'undetermined',
  });
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const initializationAttemptRef = useRef(0);
  const MAX_INIT_ATTEMPTS = 3;

  /**
   * Request all required location permissions
   * Handles both iOS and Android (12+) permission models
   */
  const requestLocationPermissions = useCallback(async (): Promise<boolean> => {
    try {
      console.log('[GPS] Requesting location permissions...');

      // Step 1: Request foreground location permission
      const foregroundStatus = await Location.requestForegroundPermissionsAsync();
      console.log('[GPS] Foreground permission:', foregroundStatus.status);

      if (foregroundStatus.status !== 'granted') {
        console.warn('[GPS] Foreground location permission denied');
        setPermissionStatus(prev => ({
          ...prev,
          foreground: 'denied',
        }));
        if (onPermissionDenied) onPermissionDenied();
        Alert.alert(
          'Location Permission Required',
          'This app needs access to your location to display maps. Please enable location permission in settings.',
          [{ text: 'OK' }]
        );
        return false;
      }

      setPermissionStatus(prev => ({
        ...prev,
        foreground: 'granted',
      }));
      console.log('[GPS] Foreground location permission granted');

      // Step 2: Request background location permission (for Android 10+)
      if (enableBackgroundTracking) {
        const backgroundStatus = await Location.requestBackgroundPermissionsAsync();
        console.log('[GPS] Background permission:', backgroundStatus.status);

        setPermissionStatus(prev => ({
          ...prev,
          background: backgroundStatus.status as 'granted' | 'denied' | 'undetermined',
        }));

        if (backgroundStatus.status !== 'granted') {
          console.warn('[GPS] Background location permission not granted');
          Alert.alert(
            'Background Location Permission',
            'Background location tracking requires permission to always allow location access.',
            [{ text: 'OK' }]
          );
        } else {
          console.log('[GPS] Background location permission granted');
        }
      }

      return true;
    } catch (error) {
      console.error('[GPS] Permission request failed:', error);
      if (onError) onError(`Permission request failed: ${error}`);
      return false;
    }
  }, [enableBackgroundTracking, onPermissionDenied, onError]);

  /**
   * Check if location services are enabled on the device
   */
  const checkLocationServicesEnabled = useCallback(async (): Promise<boolean> => {
    try {
      const isEnabled = await Location.hasServicesEnabledAsync();
      if (!isEnabled) {
        console.warn('[GPS] Location services are disabled');
        Alert.alert(
          'Location Services Disabled',
          'Please enable location services in device settings.',
          [{ text: 'OK' }]
        );
        if (onError) onError('Location services disabled');
        return false;
      }
      return true;
    } catch (error) {
      console.error('[GPS] Failed to check location services:', error);
      return false;
    }
  }, [onError]);

  /**
   * Send location update to WebView
   */
  const sendLocationToWebView = useCallback(
    (location: Location.LocationObject) => {
      try {
        const update: LocationUpdate = {
          type: 'LOCATION_UPDATE',
          data: {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy ?? 0,
            altitude: location.coords.altitude,
            heading: location.coords.heading,
            speed: location.coords.speed,
            timestamp: location.timestamp,
          },
        };

        // Send via postMessage for WebView communication
        if (webViewRef.current) {
          webViewRef.current.postMessage(JSON.stringify(update));
          console.log('[GPS] Location sent to WebView:', update.data);
        }

        // Call callback if provided
        if (onLocationUpdate) {
          onLocationUpdate(update.data);
        }
      } catch (error) {
        console.error('[GPS] Failed to send location to WebView:', error);
        if (onError) onError(`Failed to send location: ${error}`);
      }
    },
    [webViewRef, onLocationUpdate, onError]
  );

  /**
   * Start foreground location tracking
   */
  const startForegroundTracking = useCallback(async (): Promise<boolean> => {
    try {
      console.log('[GPS] Starting foreground tracking...');
      console.log('[GPS] Config:', {
        interval: trackingInterval,
        distance: minimumDistance,
        accuracy: accuracy,
      });

      // Watch position with specified accuracy and distance filter
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: accuracy,
          timeInterval: trackingInterval,
          distanceInterval: minimumDistance,
        },
        (location) => {
          console.log('[GPS] Position update received:', {
            lat: location.coords.latitude,
            lng: location.coords.longitude,
            accuracy: location.coords.accuracy,
          });
          sendLocationToWebView(location);
        },
        (error) => {
          console.error('[GPS] Location watching error:', error);
          if (onError) onError(`Location tracking error: ${error}`);
        }
      );

      locationSubscriptionRef.current = subscription;
      setIsTracking(true);
      console.log('[GPS] Foreground tracking started successfully');
      return true;
    } catch (error) {
      console.error('[GPS] Failed to start foreground tracking:', error);
      if (onError) onError(`Failed to start tracking: ${error}`);
      return false;
    }
  }, [trackingInterval, minimumDistance, accuracy, sendLocationToWebView, onError]);

  /**
   * Define background location task (for Android 10+ and iOS)
   * This runs even when app is in background
   */
  const defineBackgroundTask = useCallback(async () => {
    try {
      console.log('[GPS] Defining background location task...');

      const isTaskDefined = TaskManager.isTaskDefined(LOCATION_TASK_NAME);
      if (!isTaskDefined) {
        TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
          if (error) {
            console.error('[GPS] Background task error:', error);
            return;
          }

          if (data) {
            const { locations } = data as any;
            if (locations && locations.length > 0) {
              const location = locations[0];
              console.log('[GPS] Background location update:', {
                lat: location.coords.latitude,
                lng: location.coords.longitude,
              });
              sendLocationToWebView(location);
            }
          }
        });
        console.log('[GPS] Background task defined');
      }

      return true;
    } catch (error) {
      console.error('[GPS] Failed to define background task:', error);
      return false;
    }
  }, [sendLocationToWebView]);

  /**
   * Start background location tracking
   * Requires background permission on Android
   */
  const startBackgroundTracking = useCallback(async () => {
    try {
      console.log('[GPS] Starting background tracking...');

      const isTaskDefined = TaskManager.isTaskDefined(LOCATION_TASK_NAME);
      if (!isTaskDefined) {
        console.warn('[GPS] Background task not defined, defining now');
        await defineBackgroundTask();
      }

      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: accuracy,
        timeInterval: trackingInterval,
        distanceInterval: minimumDistance,
        foregroundService: {
          notificationTitle: 'TimeDealing',
          notificationBody: 'Location tracking in progress',
          notificationColor: '#D71920',
        },
      });

      console.log('[GPS] Background tracking started');
      return true;
    } catch (error) {
      console.error('[GPS] Failed to start background tracking:', error);
      if (onError) onError(`Background tracking failed: ${error}`);
      return false;
    }
  }, [accuracy, trackingInterval, minimumDistance, defineBackgroundTask, onError]);

  /**
   * Stop all location tracking
   */
  const stopTracking = useCallback(async () => {
    try {
      console.log('[GPS] Stopping location tracking...');

      // Stop foreground tracking
      if (locationSubscriptionRef.current) {
        locationSubscriptionRef.current.remove();
        locationSubscriptionRef.current = null;
      }

      // Stop background tracking
      if (enableBackgroundTracking) {
        try {
          await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
          console.log('[GPS] Background tracking stopped');
        } catch (error) {
          console.warn('[GPS] Background tracking already stopped');
        }
      }

      setIsTracking(false);
      console.log('[GPS] Location tracking stopped');
    } catch (error) {
      console.error('[GPS] Error stopping tracking:', error);
    }
  }, [enableBackgroundTracking]);

  /**
   * Initialize GPS tracking with retry logic
   */
  const initializeTracking = useCallback(async () => {
    try {
      initializationAttemptRef.current += 1;
      console.log(`[GPS] Initialization attempt ${initializationAttemptRef.current}/${MAX_INIT_ATTEMPTS}`);

      // Check if location services are enabled
      const servicesEnabled = await checkLocationServicesEnabled();
      if (!servicesEnabled) return;

      // Request permissions
      const permissionsGranted = await requestLocationPermissions();
      if (!permissionsGranted) return;

      // Define background task
      if (enableBackgroundTracking) {
        await defineBackgroundTask();
      }

      // Start tracking
      const foregroundStarted = await startForegroundTracking();
      if (!foregroundStarted) {
        if (initializationAttemptRef.current < MAX_INIT_ATTEMPTS) {
          console.log('[GPS] Retrying initialization...');
          setTimeout(initializeTracking, 2000);
        }
        return;
      }

      // Start background tracking if enabled and permission granted
      if (enableBackgroundTracking && permissionStatus.background === 'granted') {
        await startBackgroundTracking();
      }

      initializationAttemptRef.current = 0; // Reset on success
    } catch (error) {
      console.error('[GPS] Initialization error:', error);
      if (onError) onError(`Initialization failed: ${error}`);

      // Retry if max attempts not reached
      if (initializationAttemptRef.current < MAX_INIT_ATTEMPTS) {
        setTimeout(initializeTracking, 2000);
      }
    }
  }, [
    checkLocationServicesEnabled,
    requestLocationPermissions,
    defineBackgroundTask,
    startForegroundTracking,
    startBackgroundTracking,
    enableBackgroundTracking,
    permissionStatus,
    onError,
  ]);

  /**
   * Lifecycle: Initialize on mount
   */
  useEffect(() => {
    initializeTracking();

    return () => {
      stopTracking();
    };
  }, [initializeTracking, stopTracking]);

  return (
    <View style={styles.container}>
      {isTracking ? (
        <View style={styles.statusContainer}>
          <ActivityIndicator size="small" color="#D71920" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 0,
  },
  statusContainer: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
});
```

---

## Part 2: WebView GPS Receiver Script

### File: `web/gps-receiver.js`

```javascript
/**
 * Production-ready GPS receiver for WebView
 * Handles location updates from React Native
 * Integrates with your map or location-based features
 */

(function() {
  'use strict';

  // GPS State
  window.__gpsState = {
    isTracking: false,
    lastLocation: null,
    updateCount: 0,
    errors: [],
    listeners: [],
  };

  /**
   * Initialize GPS receiver
   * Call this after DOM is ready
   */
  window.initializeGPSReceiver = function() {
    console.log('[WebView-GPS] Initializing GPS receiver...');

    // Setup message listener from React Native
    setupMessageListener();

    // Expose API for HTML/JavaScript
    window.getLastLocation = getLastLocation;
    window.getGPSStatus = getGPSStatus;
    window.onGPSUpdate = null; // Custom callback hook
    window.addGPSListener = addGPSListener;
    window.removeGPSListener = removeGPSListener;

    console.log('[WebView-GPS] GPS receiver initialized');
  };

  /**
   * Listen for messages from React Native
   */
  function setupMessageListener() {
    // Handle postMessage from React Native
    window.addEventListener('message', function(event) {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'LOCATION_UPDATE') {
          handleLocationUpdate(message.data);
        }
      } catch (error) {
        // Ignore non-JSON messages
      }
    });

    // For Expo WebView, also listen on document
    if (document.addEventListener) {
      document.addEventListener('message', function(event) {
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'LOCATION_UPDATE') {
            handleLocationUpdate(message.data);
          }
        } catch (error) {
          // Ignore non-JSON messages
        }
      });
    }

    console.log('[WebView-GPS] Message listener setup complete');
  }

  /**
   * Handle location update from React Native
   */
  function handleLocationUpdate(locationData) {
    // Validate location data
    if (!locationData || typeof locationData.latitude !== 'number') {
      console.warn('[WebView-GPS] Invalid location data:', locationData);
      return;
    }

    // Update state
    window.__gpsState.isTracking = true;
    window.__gpsState.lastLocation = locationData;
    window.__gpsState.updateCount += 1;

    // Log update
    console.log('[WebView-GPS] Location update #' + window.__gpsState.updateCount, {
      lat: locationData.latitude,
      lng: locationData.longitude,
      accuracy: locationData.accuracy + ' meters',
      time: new Date(locationData.timestamp).toLocaleTimeString(),
    });

    // Call custom callback if defined
    if (typeof window.onGPSUpdate === 'function') {
      try {
        window.onGPSUpdate(locationData);
      } catch (error) {
        console.error('[WebView-GPS] Error in custom callback:', error);
      }
    }

    // Notify all registered listeners
    notifyListeners(locationData);

    // Update map if available
    updateMapCenter(locationData);

    // Update UI if elements exist
    updateLocationUI(locationData);
  }

  /**
   * Add custom GPS listener
   */
  function addGPSListener(callback) {
    if (typeof callback === 'function') {
      window.__gpsState.listeners.push(callback);
      console.log('[WebView-GPS] Listener added. Total listeners: ' + window.__gpsState.listeners.length);
    }
  }

  /**
   * Remove GPS listener
   */
  function removeGPSListener(callback) {
    const index = window.__gpsState.listeners.indexOf(callback);
    if (index > -1) {
      window.__gpsState.listeners.splice(index, 1);
      console.log('[WebView-GPS] Listener removed. Total listeners: ' + window.__gpsState.listeners.length);
    }
  }

  /**
   * Notify all registered listeners
   */
  function notifyListeners(locationData) {
    window.__gpsState.listeners.forEach(function(callback) {
      try {
        callback(locationData);
      } catch (error) {
        console.error('[WebView-GPS] Listener error:', error);
      }
    });
  }

  /**
   * Get last known location
   */
  function getLastLocation() {
    return window.__gpsState.lastLocation;
  }

  /**
   * Get GPS status
   */
  function getGPSStatus() {
    return {
      isTracking: window.__gpsState.isTracking,
      updateCount: window.__gpsState.updateCount,
      lastLocation: window.__gpsState.lastLocation,
      lastUpdateTime: window.__gpsState.lastLocation ? new Date(window.__gpsState.lastLocation.timestamp) : null,
    };
  }

  /**
   * Update map center (if Naver Maps available)
   */
  function updateMapCenter(locationData) {
    try {
      // Check if Naver Maps is loaded
      if (typeof naver === 'undefined' || !naver.maps) {
        return;
      }

      // Find map container
      const mapContainer = document.querySelector('[data-naver-map], .naver-map, #map');
      if (!mapContainer || !mapContainer.__naverMap) {
        return;
      }

      const map = mapContainer.__naverMap;

      // Update map center only if user has enabled auto-follow
      if (window.__autoFollowLocation !== false) {
        const newCenter = new naver.maps.LatLng(locationData.latitude, locationData.longitude);
        
        // Only update if moved more than 50 meters
        if (map.getCenter) {
          const currentCenter = map.getCenter();
          const distance = calculateDistance(
            currentCenter.lat(),
            currentCenter.lng(),
            locationData.latitude,
            locationData.longitude
          );
          
          if (distance > 50) {
            map.setCenter(newCenter);
            console.log('[WebView-GPS] Map center updated');
          }
        }
      }
    } catch (error) {
      // Silently ignore map update errors
    }
  }

  /**
   * Update location display UI
   */
  function updateLocationUI(locationData) {
    try {
      // Update GPS status display
      const statusElement = document.getElementById('gps-status');
      if (statusElement) {
        statusElement.textContent = 'GPS: ' + locationData.latitude.toFixed(4) + ', ' + locationData.longitude.toFixed(4);
        statusElement.style.color = '#4CAF50'; // Green for active
      }

      // Update accuracy display
      const accuracyElement = document.getElementById('gps-accuracy');
      if (accuracyElement) {
        accuracyElement.textContent = 'Accuracy: ±' + Math.round(locationData.accuracy) + 'm';
      }

      // Update last update time
      const timeElement = document.getElementById('gps-time');
      if (timeElement) {
        const time = new Date(locationData.timestamp);
        timeElement.textContent = 'Updated: ' + time.toLocaleTimeString();
      }
    } catch (error) {
      // Silently ignore UI update errors
    }
  }

  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Auto-initialize when ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.initializeGPSReceiver);
  } else {
    window.initializeGPSReceiver();
  }
})();
```

---

## Part 3: AndroidManifest.xml Configuration

### File: `android/app/src/main/AndroidManifest.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.timedealing.app">

    <!-- ==================== Location Permissions ==================== -->
    
    <!-- Foreground location (required) -->
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    
    <!-- Background location (Android 10+, required for background tracking) -->
    <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
    
    <!-- ==================== Other Required Permissions ==================== -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    
    <!-- ==================== Optional Permissions ==================== -->
    <!-- For improved accuracy in some cases -->
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.CHANGE_NETWORK_STATE" />

    <application
        android:name=".MainApplication"
        android:allowBackup="true"
        android:debuggable="false"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme"
        android:usesCleartextTraffic="false">

        <!-- ==================== Main Activity ==================== -->
        <activity
            android:name=".MainActivity"
            android:configChanges="keyboard|keyboardHidden|orientation|screenSize|uiMode"
            android:exported="true"
            android:label="@string/app_name"
            android:launchMode="singleTask"
            android:screenOrientation="portrait"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

            <!-- Deep Link Schemes -->
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="timedealing" android:host="*" />
            </intent-filter>
        </activity>

        <!-- ==================== Services ==================== -->
        <!-- Required for background location updates -->
        <!-- expo-location automatically registers its service -->

        <!-- Notification icons (optional) -->
        <meta-data
            android:name="com.google.android.gms.version"
            android:value="@integer/google_play_services_version" />

    </application>

</manifest>
```

**Key Points:**
- `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` are required for foreground tracking
- `ACCESS_BACKGROUND_LOCATION` is required for background tracking on Android 10+
- These must be requested at runtime on Android 6+
- expo-location handles most service registration automatically

---

## Part 4: Info.plist Configuration (iOS)

### File: `ios/TimeDealing/Info.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- ==================== Location Permissions ==================== -->
    
    <!-- Required: Why location is needed while using the app -->
    <key>NSLocationWhenInUseUsageDescription</key>
    <string>TimeDealing needs your location to show nearby deals and help you discover offers around you.</string>
    
    <!-- Optional: For background location tracking -->
    <key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
    <string>TimeDealing uses your location to provide background tracking for the best deal recommendations.</string>
    
    <!-- Older iOS versions (if supporting iOS 10) -->
    <key>NSLocationAlwaysUsageDescription</key>
    <string>TimeDealing needs your location for deal discovery and recommendations.</string>
    
    <!-- ==================== Background Modes ==================== -->
    <!-- Required for background location updates -->
    <key>UIBackgroundModes</key>
    <array>
        <string>location</string>
    </array>
    
    <!-- ==================== Other Settings ==================== -->
    <key>NSBonjourServices</key>
    <array/>
    
</dict>
</plist>
```

**Key Points:**
- `NSLocationWhenInUseUsageDescription` is required (shown when requesting foreground permission)
- `NSLocationAlwaysAndWhenInUseUsageDescription` needed for background tracking
- `UIBackgroundModes` must include `location` for background tracking
- Be specific about why you need location for better user trust

---

## Part 5: Usage in Your App

### File: `app/index.tsx` (Updated)

Replace your current injected JavaScript with this integration:

```typescript
import GPSTracker from '../gps/GPSTracker';

// Inside your App component, add:

export default function App() {
  const webViewRef = useRef<WebView>(null);
  // ... other state

  const handleLocationUpdate = (location: any) => {
    console.log('Location updated in app:', location);
    // Optional: do something with the location on the native side
  };

  return (
    <>
      {/* Add GPS Tracker */}
      <GPSTracker
        webViewRef={webViewRef}
        webViewUrl={WEBVIEW_URL}
        onLocationUpdate={handleLocationUpdate}
        onPermissionDenied={() => {
          console.log('Location permission denied');
        }}
        onError={(error) => {
          console.error('GPS Error:', error);
        }}
        enableBackgroundTracking={false} // Set to true if you need background tracking
        trackingInterval={5000} // Update every 5 seconds
        minimumDistance={5} // Update when moved 5 meters
        accuracy={Location.Accuracy.BestForNavigation}
      />

      {/* WebView with GPS receiver injected */}
      <WebView
        ref={webViewRef}
        source={{ uri: WEBVIEW_URL }}
        injectedJavaScript={gpsReceiverScript} // Include the gps-receiver.js content
        onMessage={handleWebViewMessage}
        // ... other props
      />
    </>
  );
}
```

---

## Part 6: Best Practices & Optimization

### 1. **Background Tracking Considerations**
- Background tracking is CPU/battery intensive
- Only enable if truly necessary
- Use larger `minimumDistance` (10-20m) for background tracking
- Use longer `trackingInterval` (30000+ms) for background to save battery

### 2. **Accuracy Levels**
```typescript
// High accuracy (for real-time tracking)
Location.Accuracy.BestForNavigation

// Balanced (default, good for most apps)
Location.Accuracy.Best

// Low power (battery-friendly)
Location.Accuracy.Low
```

### 3. **Error Handling**
- Always implement `onError` callback
- Handle permission denials gracefully
- Implement retry logic with exponential backoff
- Log errors for debugging

### 4. **WebView Integration**
```javascript
// In your HTML/Bubble app:
window.onGPSUpdate = function(location) {
  console.log('New location:', location);
  // Update your map, UI, or API calls
};

// Or use listeners:
window.addGPSListener(function(location) {
  console.log('GPS Update:', location);
});

// Check status anytime:
const status = window.getGPSStatus();
console.log('Tracking:', status.isTracking);
```

### 5. **Performance Tips**
- Keep `trackingInterval` reasonable (minimum 1000ms)
- Use appropriate `minimumDistance` to reduce updates
- Avoid heavy processing in `onGPSUpdate` callback
- Clean up listeners when component unmounts

### 6. **Testing Checklist**
- [ ] Test on Android 6, 10, 12, 13, 14 (different permission models)
- [ ] Test on iOS 14, 15, 16+ (different permission UX)
- [ ] Test with location services disabled
- [ ] Test with permissions denied
- [ ] Test background tracking suspension
- [ ] Test WebView message delivery under poor network
- [ ] Test battery consumption over 1 hour of tracking
- [ ] Test cleanup on app backgrounding
- [ ] Test GPS accuracy improvement over time

### 7. **Debugging**
```javascript
// In WebView console:
console.log(window.__gpsState); // Full GPS state
console.log(window.getLastLocation()); // Last known location
console.log(window.getGPSStatus()); // Current status
```

---

## Summary

**Complete solution includes:**
- ✅ Production-ready React Native component with retry logic
- ✅ Proper permission handling for iOS and Android
- ✅ Foreground and background tracking support
- ✅ WebView message integration
- ✅ Error handling and recovery
- ✅ Full configuration for native platforms
- ✅ Best practices and optimization tips
