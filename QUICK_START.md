# Quick Reference - Map Location Persistence Fix

## What Was Changed

In `app/index.tsx`, the injected JavaScript now includes:

1. **`window.__LAST_RN_POS`** - Stores latest GPS location
   ```javascript
   {
     lat: 37.4979,
     lng: 127.0276,
     heading: 45,
     timestamp: 1733545800000
   }
   ```

2. **Enhanced `__updateMapFromRN(lat, lng, heading)`** - Called every GPS update
   - Automatically saves location to `__LAST_RN_POS`
   - Logs: `📍 [Map] RN location received`

3. **`__monitorMapReset()`** - Detects map center changes
   - Runs on page load and every 5 seconds
   - If map moves to Seoul (37.566826, 126.9786567), restores to RN location
   - Logs: `⚠️ [Map] Default Seoul location detected!` + restoration

4. **API Interception** - Hooks fetch() and XMLHttpRequest
   - Detects category/marker API calls
   - After API completes, re-checks map location
   - Restores if needed after category changes

## How React Native → WebView Location Flow Works

```
React Native GPS Update
        ↓
injectJavaScript: "window.__updateMapFromRN(${lat}, ${lng}, ${heading})"
        ↓
WebView receives call
        ↓
Saves to window.__LAST_RN_POS
        ↓
Updates map display
        ↓
(User changes category)
        ↓
Bubble API call detected
        ↓
__monitorMapReset() runs
        ↓
If map at default Seoul → Restore from __LAST_RN_POS
        ↓
✅ Map stays on user location!
```

## Testing Checklist

- [ ] App builds without errors: `npx expo run:android`
- [ ] Location permission requested on app start
- [ ] GPS updates visible in Metro logs: `📍 [GPS] 위치 업데이트`
- [ ] WebView shows location received: `📍 [Map] RN location received`
- [ ] Open map page and wait for GPS fix (may take 5-10 seconds)
- [ ] Change category tab
- [ ] Verify map stays on your current location
- [ ] Check browser console for restoration logs
- [ ] Run `console.log(window.__LAST_RN_POS)` to verify location is stored

## Console Commands for Debugging

```javascript
// Check current saved location
window.__LAST_RN_POS

// Force map monitoring
window.__monitorMapReset()

// Check if Leaflet is available
typeof L !== 'undefined'

// Get current map center (if Leaflet)
L.map._leaflets[0]?.getCenter()

// Force restore to last RN position
if (window.__LAST_RN_POS) {
  const pos = window.__LAST_RN_POS;
  window.__updateMapFromRN(pos.lat, pos.lng, pos.heading);
}
```

## Key Log Messages to Look For

### ✅ Success Signs
- `📍 [Map] RN location received: lat=37.xxx, lng=126.xxx`
- `💾 [Map] Saved RN location to __LAST_RN_POS`
- `✅ [맵] 카테고리 변경 감지 및 RN 위치 복구 준비 완료`

### ⚠️ Warning Signs
- `⚠️ [Map] Default Seoul location detected!` - Good! Means restoration ran
- No `📍 [Map] RN location received` - GPS not updating

### 🐛 Debug Info
- `📡 [API] Fetch intercepted` - API call detected
- `🔄 [API] Checking if map needs restoration` - Post-API check
- `📡 [XHR] XMLHttpRequest intercepted` - Legacy AJAX detected

## Expected Behavior After Fix

1. **GPS Tracking** - Continuous location updates to WebView
2. **Map Persistence** - Map stays on your location even when:
   - Switching between category tabs
   - Reloading the page
   - API calls refresh marker data
3. **Automatic Restoration** - No user action needed, fully automatic
4. **Seamless Integration** - Works with existing Bubble map code

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Map still resets to Seoul | Leaflet not detected | Check browser console for Leaflet availability |
| No GPS updates | Permissions denied | Grant location permission in app |
| Location not persisting | API call failed | Check network tab in DevTools |
| Console errors | Script syntax error | Check for TypeScript/JSX formatting issues |

## Files Modified

- `app/index.tsx` - Added GPS persistence to injected JavaScript
- `MAP_LOCATION_FIX.md` - Full documentation

## No Breaking Changes

✅ All existing Kakao login functionality intact
✅ All existing notification system intact  
✅ All existing marker filtering/display intact
✅ Pure additive implementation - just adds storage & monitoring
