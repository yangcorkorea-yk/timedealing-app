# Bubble Location Update Diagnostic

## Problem
The React Native app is sending location updates via `postMessage`, but the user marker doesn't appear on the map.

## Root Cause Analysis

The RN app expects Bubble to define a function called `window.__updateMapFromRN(lat, lng, heading)` that will:
1. Update the user's marker position on the Naver Map
2. Optionally recenter the map to the user's location
3. Update any heading/rotation indicators

## What RN is Sending

The app sends these message types:
- `LOCATION_INIT` - Immediately after WebView loads (first position)
- `GPS_UPDATE` - Every 3 seconds (continuous tracking)
- `LOCATION_UPDATE` - When "Current Location" button is pressed (immediate fetch)

Message format:
```javascript
{
  type: 'LOCATION_UPDATE',  // or LOCATION_INIT or GPS_UPDATE
  lat: 37.4224962,
  lng: 126.9081766,
  heading: 196.62457275390625,
  accuracy: 10.5,
  timestamp: 1702473924000
}
```

## What Bubble Must Implement

### Option 1: Define `window.__updateMapFromRN` function

Add this to your Bubble page HTML header or in a "Run JavaScript" action on page load:

```javascript
// Define the function that React Native expects
window.__updateMapFromRN = function(lat, lng, heading) {
  console.log('[Bubble] __updateMapFromRN called:', lat, lng, heading);
  
  // TODO: Update your Naver Map marker here
  // Example (adjust to your actual map variable name):
  if (window.myNaverMap && window.userMarker) {
    const position = new naver.maps.LatLng(lat, lng);
    window.userMarker.setPosition(position);
    
    // Optional: recenter map
    window.myNaverMap.setCenter(position);
    
    // Optional: update marker rotation based on heading
    if (heading && window.userMarker.setIcon) {
      window.userMarker.setIcon({
        url: 'YOUR_MARKER_IMAGE_URL',
        rotation: heading
      });
    }
  } else {
    console.warn('[Bubble] Map or marker not ready yet');
  }
};

console.log('[Bubble] window.__updateMapFromRN defined and ready');
```

### Option 2: Use message event listener (alternative)

If you prefer to handle messages directly in Bubble:

```javascript
// Listen for React Native messages
window.addEventListener('message', function(event) {
  try {
    const data = JSON.parse(event.data);
    
    if (data.type === 'LOCATION_UPDATE' || data.type === 'GPS_UPDATE' || data.type === 'LOCATION_INIT') {
      console.log('[Bubble] Location update received:', data);
      
      // Update your map marker here
      if (window.myNaverMap && window.userMarker) {
        const position = new naver.maps.LatLng(data.lat, data.lng);
        window.userMarker.setPosition(position);
        window.myNaverMap.setCenter(position);
      }
    }
  } catch (e) {
    // Not JSON or not relevant
  }
});

console.log('[Bubble] Message listener registered');
```

## Testing Steps

1. **Add the code above to your Bubble page** (HTML header or Run JavaScript action on page load)

2. **Test in Bubble's preview mode first**:
   - Open browser console (F12)
   - Manually call: `window.__updateMapFromRN(37.5665, 126.9780, 0)`
   - Verify marker moves

3. **Test in React Native app**:
   - Build and run the app
   - Check logs for: `[RN→WebView] window.__updateMapFromRN exists? function`
   - If it shows `undefined`, Bubble hasn't defined the function yet

4. **Press "Current Location" button**:
   - Should trigger `REQUEST_CURRENT_LOCATION` → `LOCATION_UPDATE`
   - Check logs for successful call

## Common Issues

### Issue 1: "window.__updateMapFromRN not defined"
**Solution**: Add the function definition to Bubble's HTML header or page load script

### Issue 2: Function exists but marker doesn't move
**Solution**: Check that `window.myNaverMap` and `window.userMarker` variables are correctly named and initialized

### Issue 3: Map resets to default Seoul coordinates
**Solution**: This is already handled by RN's map center preservation system

### Issue 4: Marker appears but doesn't update
**Solution**: Verify the marker's `setPosition` method is being called correctly

## Expected Logs (Success)

```
[RN→WebView] Location message detected: LOCATION_UPDATE
[RN→WebView] window.__updateMapFromRN exists? function
[RN→WebView] Calling window.__updateMapFromRN with lat=37.4224962, lng=126.9081766, heading=196.62
[RN→WebView] ✅ window.__updateMapFromRN called successfully
[Bubble] __updateMapFromRN called: 37.4224962 126.9081766 196.62
```

## Next Steps

1. Implement `window.__updateMapFromRN` in Bubble
2. Test in Bubble preview mode manually
3. Test in RN app with logging
4. Verify marker appears and updates every 3 seconds

---

**Note**: The RN app is already working correctly and sending location data. The issue is that Bubble needs to receive and process these updates by defining the expected function.
