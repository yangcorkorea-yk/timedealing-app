# Map Center Preservation Fix for React Native WebView

## Problem Statement

In the React Native WebView, when using the Bubble application:
1. User taps "Set Current Location" → Saves coordinates to `saved_lat` / `saved_lng`
2. Bubble's `ApplyMapCenter` workflow runs → Sets map center to those coordinates
3. **BUG**: When user switches categories, the map jumps back to default HTML coordinates (37.566826, 126.9786567)
4. This occurs despite the saved coordinates being stored

The issue does NOT occur on web - only in the React Native WebView environment.

## Root Cause

The Bubble HTML application's category change handlers contain code that reinitializes the map or calls `setCenter()` with the default coordinates. Even though `saved_lat` / `saved_lng` are stored and `ApplyMapCenter` works, any subsequent category/filter changes trigger the map to reset.

## Solution: Map Center Preservation System

The fix involves injecting JavaScript into the WebView that:

1. **Intercepts Naver Maps Constructor** - Overrides `naver.maps.Map` to intercept all `setCenter()` calls
2. **Allows First Load** - Permits the initial map load (which uses default coordinates) to proceed
3. **Stores Valid Centers** - Saves any non-default coordinates set by `ApplyMapCenter` workflow
4. **Blocks Default Reset** - Prevents any subsequent `setCenter(37.566826, 126.9786567)` calls
5. **Restores Saved Center** - When category changes try to reset the map, redirects to the saved coordinates
6. **Monitors for Escapes** - Continuously checks if map somehow gets reset and restores it

## Implementation Details

### Key Variables

```javascript
window.__savedMapCenter = null;      // Stores the last valid map center {lat, lng}
window.__isFirstMapLoad = true;      // Tracks if this is the first map load
```

### Core Function: `window.__installMapInterceptor()`

This function:
1. Checks if Naver Maps library is loaded
2. Replaces `naver.maps.Map` constructor with a wrapper
3. Overrides the `setCenter()` method on all map instances

```javascript
mapInstance.setCenter = function(latlng) {
  // Extract lat/lng from various Naver Maps coordinate formats
  const lat = latlng?.lat !== undefined ? latlng.lat : (latlng?.y !== undefined ? latlng.y : null);
  const lng = latlng?.lng !== undefined ? latlng.lng : (latlng?.x !== undefined ? latlng.x : null);
  
  // Detect if coordinates are the default Seoul location
  const isDefaultCoords = Math.abs(lat - 37.566826) < 0.00001 && 
                          Math.abs(lng - 126.9786567) < 0.00001;
  
  // Decision logic:
  // 1. First load (window.__isFirstMapLoad === true):
  //    - Allow the call to proceed
  //    - Save non-default coordinates for later
  //
  // 2. Subsequent calls trying to reset to default:
  //    - If we have a saved center, redirect to it
  //    - Otherwise, block the call
  //
  // 3. Any other coordinates:
  //    - Allow and save as new valid center
}
```

### Monitoring Loop

Even with the constructor interceptor, a periodic check (every 1 second) verifies:
- If map is currently at default Seoul coordinates
- If we have a saved center
- If they don't match, restore the saved center

```javascript
setInterval(() => {
  const currentCenter = mapInstance.getCenter();
  const isAtDefault = matches(currentCenter, 37.566826, 126.9786567);
  
  if (isAtDefault && window.__savedMapCenter) {
    // Reset the map to saved coordinates
    mapInstance.setCenter(new naver.maps.LatLng(
      window.__savedMapCenter.lat,
      window.__savedMapCenter.lng
    ));
  }
}, 1000);
```

## Behavioral Flow

### Scenario 1: Initial Page Load

```
1. Page loads → injected JavaScript runs
2. window.__isFirstMapLoad = true
3. Bubble initializes map → calls setCenter(37.566826, 126.9786567)
4. Interceptor allows it (first load)
5. window.__savedMapCenter remains null (default coords not saved)
```

### Scenario 2: User Sets Location via ApplyMapCenter

```
1. User taps "Set Current Location" → saves coordinates (37.123, 127.456)
2. Bubble runs ApplyMapCenter → calls setCenter(37.123, 127.456)
3. Interceptor:
   - Detects it's not default coordinates
   - Sets window.__isFirstMapLoad = false
   - Saves window.__savedMapCenter = {lat: 37.123, lng: 127.456}
   - Allows the call
4. Map center is now (37.123, 127.456)
```

### Scenario 3: User Switches Categories

```
1. User taps category filter
2. Category handler calls setCenter(37.566826, 126.9786567) [the default]
3. Interceptor:
   - Detects isDefaultCoords = true
   - Detects window.__savedMapCenter exists
   - BLOCKS the call
   - REDIRECTS to: setCenter(37.123, 127.456) [saved center]
4. Map stays at (37.123, 127.456) - no jump!
```

### Scenario 4: User Pans/Zooms Map

```
1. User pans map to (37.654, 127.123)
2. Map fires setCenter(37.654, 127.123)
3. Interceptor:
   - Detects it's not default coordinates
   - Updates window.__savedMapCenter = {lat: 37.654, lng: 127.123}
   - Allows the call
4. New location is now the saved center
5. Future category changes will reset to this new location
```

## Console Logging

When the system is active, you'll see logs like:

```
[Platform] Native app environment
[Setup] Injected JavaScript initialized
[Map] Naver Maps constructor interceptor installed
[Map] setCenter called: lat=37.566826, lng=126.9786567, isDefault=true, isSaved=false
[Map] First map load - allowing coordinates

[Map] setCenter called: lat=37.123, lng=127.456, isDefault=false, isSaved=false
[Map] Updated saved center: lat=37.123, lng=127.456

[Map] setCenter called: lat=37.566826, lng=126.9786567, isDefault=true, isSaved=false
[Map] BLOCKED: Attempt to reset to default Seoul coordinates
[Map] RESTORING: Saved center lat=37.123, lng=127.456
```

## Testing Procedures

### Test 1: Map initializes correctly
1. Open app
2. Open WebView map page
3. Verify: Map shows Seoul default location initially
4. Verify: Browser console shows "[Map] First map load - allowing coordinates"

### Test 2: ApplyMapCenter works
1. Tap "Set Current Location" button in the app
2. Verify: Coordinates are saved to `saved_lat` / `saved_lng` in Bubble
3. Verify: Map moves to the new location
4. Verify: Console shows "[Map] Updated saved center: lat=<your_lat>, lng=<your_lng>"

### Test 3: Category switches don't reset map
1. User with saved location set (from Test 2)
2. Click different category tabs (전체, 푸드/카페, 헤어/뷰티, etc)
3. Verify: Map center DOES NOT move back to Seoul
4. Verify: Console shows "[Map] BLOCKED: Attempt to reset to default Seoul" repeatedly

### Test 4: Monitoring catch any escapes
1. Perform Test 3 steps
2. Verify: If map somehow gets reset (unlikely but possible), the 1-second monitor detects it
3. Verify: Console shows "[Map] DETECTED: Map reset to default Seoul! RESTORING saved center..."

## Technical Notes

### Why This Approach?

- **Constructor Override**: Catches all map instances at creation time
- **setCenter Interception**: Intercepts before Bubble's code executes
- **First Load Exception**: Allows normal HTML initialization without forcing user location
- **Saved Center Persistence**: Survives page reloads, navigation, category changes
- **Dual Monitoring**: Both interceptor AND periodic check for defense in depth

### Edge Cases Handled

1. **Multiple Map Instances**: Interceptor works on all instances created after installation
2. **Naver Maps Not Loaded Yet**: Retries every 500ms for 10 seconds
3. **Different Coordinate Formats**: Handles both `lat/lng` and `x/y` properties
4. **Null/Invalid Coordinates**: Skips processing if coordinates are null
5. **Tolerance for Floating Point**: Uses ±0.00001 tolerance for coordinate comparison

### Limitations

1. Only works for Naver Maps (Bubble app's map library)
2. Requires Naver Maps to be loaded before interceptor installs
3. Doesn't prevent other methods of moving map (e.g., marker drag in Bubble)
4. Category filters must trigger through `setCenter()` for this to work

## Browser DevTools Verification

Open browser console in WebView and execute:

```javascript
// Check if saved center is stored
console.log('Saved Center:', window.__savedMapCenter);

// Check first load flag
console.log('First Load?:', window.__isFirstMapLoad);

// Get current map center
const mapContainer = document.querySelector('[data-naver-map], .naver-map, #map');
if (mapContainer?.__naverMap) {
  const center = mapContainer.__naverMap.getCenter();
  console.log('Current Map Center:', {lat: center.y, lng: center.x});
}
```

## Expected Behavior Summary

| Action | Before Fix | After Fix |
|--------|-----------|-----------|
| Initial page load | Map at Seoul (37.566826, 126.9786567) | Map at Seoul (correct, initial HTML) |
| User sets location via ApplyMapCenter to (37.123, 127.456) | Map moves to (37.123, 127.456) ✓ | Map moves to (37.123, 127.456) ✓ |
| User clicks category filter | Map jumps to Seoul ✗ | Map stays at (37.123, 127.456) ✓ |
| User clicks multiple categories | Map keeps jumping to Seoul ✗ | Map stays at (37.123, 127.456) ✓ |
| User pans map to (37.654, 127.123) | Works normally ✓ | Works + saves new center ✓ |
| Browser console shows logs | No custom logs | Detailed logs of all map center changes |

## Code Location

File: `app/index.tsx`
- Lines 745-1000: Injected JavaScript containing the map center preservation system
- Function `window.__installMapInterceptor()`: Core interceptor logic
- Function `setInterval(..., 1000)`: Periodic monitoring loop
- Variables `window.__savedMapCenter`, `window.__isFirstMapLoad`: State tracking
