# Map Location Persistence Fix - Implementation Summary

## Problem
The map was resetting to default Seoul coordinates (37.566826, 126.9786567) when users changed categories in the WebView, ignoring the latest user location received from React Native GPS tracking.

## Solution Implemented

### 1. **Persistent Location Storage** (`window.__LAST_RN_POS`)
- Created a global window variable to store the most recent GPS location received from React Native
- Stores: `{lat, lng, heading, timestamp}`
- Persists across page reloads and category changes

### 2. **Enhanced `__updateMapFromRN` Function**
- Overrides the original function to capture all incoming RN location updates
- Every GPS update from React Native is:
  - Logged to console with `📍 [Map]` prefix
  - Stored in `window.__LAST_RN_POS`
  - Forwarded to original handler if it exists

### 3. **Map Reset Detection & Recovery**
- Added `__monitorMapReset()` function that:
  - Detects when map center is set to default Seoul coordinates
  - Identifies Leaflet map instances (used by many mapping libraries)
  - Hooks into `moveend` event (triggered when map is moved)
  - Automatically restores map to latest RN location if reset detected
- Runs on page load and checks every 5 seconds via `setInterval`

### 4. **API Call Interception**
- **Fetch Hook**: Intercepts fetch() API calls
  - Detects marker/category/api endpoint calls
  - After each API completes, calls `__monitorMapReset()` to restore location
- **XMLHttpRequest Hook**: Intercepts legacy AJAX calls
  - Same detection and restoration logic
  - Ensures both modern and legacy category change APIs are handled

## Code Location
All changes in: `app/index.tsx` in the `injectedJavaScript` constant (within the WebView's injected script)

## Key Features

✅ **Non-breaking**: Doesn't interfere with existing Bubble map functionality
✅ **Automatic**: Requires no changes to the WebView/Bubble code
✅ **Comprehensive**: Handles both modern (fetch) and legacy (XMLHttpRequest) APIs
✅ **Resilient**: Continuously monitors and restores location if reset
✅ **Well-logged**: Console logs show every step for debugging

## Console Log Signatures
When GPS is received:
```
📍 [Map] RN location received: lat=37.xxx, lng=126.xxx, heading=0
💾 [Map] Saved RN location to __LAST_RN_POS: {...}
```

When map reset is detected:
```
⚠️ [Map] Default Seoul location detected!
📍 [Map] Restoring RN location from __LAST_RN_POS
```

When API calls trigger restoration:
```
📡 [API] Fetch intercepted: ...
🔄 [API] Checking if map needs restoration after category change...
📡 [XHR] XMLHttpRequest intercepted: ...
🔄 [XHR] Checking if map needs restoration after category change...
```

## Testing Instructions

1. **Build & Deploy**
   ```bash
   npx expo run:android
   ```

2. **Verify GPS Updates**
   - App starts and requests location permission
   - Check Metro logs for: `📍 [GPS] 위치 업데이트`
   - Check WebView for: `📍 [Map] RN location received`

3. **Test Category Changes**
   - Open the WebView map page
   - Wait for GPS to update (should see location injected)
   - Change categories (tap different category tabs)
   - **Expected**: Map stays on your location, NOT reset to Seoul
   - Check logs for `⚠️ [Map] Default Seoul location detected!` followed by restoration

4. **Monitor Locations**
   - Check `window.__LAST_RN_POS` in browser console
   - Should always have latest coordinates
   - Format: `{lat: number, lng: number, heading: number, timestamp: number}`

## Browser DevTools Debugging

In the WebView, open browser console and run:
```javascript
// Check if GPS location was received
console.log('Last RN Position:', window.__LAST_RN_POS);

// Manually trigger map monitoring
window.__monitorMapReset();

// Check if Leaflet map is detected
console.log('Leaflet available:', typeof L !== 'undefined');
```

## Expected Behavior

**Before Fix**: Category change → Map resets to Seoul (37.566826, 126.9786567)

**After Fix**: 
1. GPS location received → Stored in `__LAST_RN_POS`
2. Category changed → API call triggers marker refresh
3. If map attempts default reset → Automatically restored to latest RN location
4. Map stays on user location throughout session

## Fallback Handling

If the Leaflet detection fails (different map library):
- GPS location is still stored in `__LAST_RN_POS`
- Can be manually accessed by Bubble workflows
- Fetch/XMLHttpRequest interception still works
- Logs will show what was detected

## Future Enhancements

1. Could add support for Google Maps, Mapbox detection
2. Could intercept map initialization to use RN location on first load
3. Could add zoom level preservation
4. Could add animation/smooth transition when restoring location
