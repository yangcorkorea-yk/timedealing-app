import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

// Define the task name for background location tracking
const LOCATION_TASK_NAME = 'background-location-task';

// Define location update events
export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

interface LocationUpdate {
  type: 'LOCATION_UPDATE';
  data: LocationData;
}

interface PermissionStatus {
  foreground: 'granted' | 'denied' | 'undetermined';
  background: 'granted' | 'denied' | 'undetermined';
}

export interface GPSTrackerProps {
  webViewRef: React.RefObject<WebView>;
  onLocationUpdate?: (location: LocationData) => void;
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
