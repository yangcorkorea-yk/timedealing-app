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
      lat: locationData.latitude.toFixed(4),
      lng: locationData.longitude.toFixed(4),
      accuracy: Math.round(locationData.accuracy) + 'm',
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
