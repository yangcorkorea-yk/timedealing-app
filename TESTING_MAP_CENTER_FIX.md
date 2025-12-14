# Testing Guide: Map Center Preservation Fix

## Quick Test Checklist

- [ ] App builds without errors
- [ ] App launches on Android device
- [ ] WebView loads the Bubble app
- [ ] Map initializes to Seoul (default)
- [ ] "Set Current Location" works (map moves to user location)
- [ ] Switching categories does NOT reset map to Seoul
- [ ] Switching multiple categories still keeps map at user location
- [ ] Browser console shows expected log messages

## Detailed Testing Steps

### Prerequisites
- Android device connected via ADB
- App built and ready to run
- WebView inspector available (Chrome DevTools remote debugging)

### Test 1: Basic Functionality (Map Initialization)

**Steps:**
1. Connect device to computer
2. Run: `npx expo run:android`
3. Grant location permission when prompted
4. Navigate to map page in the app
5. Wait 3-5 seconds for map to fully load

**Expected Results:**
```
Browser Console:
[Platform] Native app environment
[Setup] Injected JavaScript initialized
[Map] Naver Maps constructor interceptor installed
[Map] setCenter called: lat=37.566826, lng=126.9786567, isDefault=true, isSaved=false
[Map] First map load - allowing coordinates
```

**What to Observe:**
- Map displays at Seoul (default coordinates)
- Map loads without errors
- No error messages in browser console

**Pass/Fail:**
- ✅ PASS: Map loads and shows Seoul
- ❌ FAIL: Map doesn't load or shows JavaScript errors

---

### Test 2: ApplyMapCenter Workflow

**Prerequisites:** Test 1 must pass

**Steps:**
1. In the WebView app, find "Set Current Location" button
2. Tap it (your actual GPS location will be sent from React Native)
3. Observe the map movement
4. Check browser console for logs

**Expected Results:**
```
Browser Console:
[Map] setCenter called: lat=37.123, lng=127.456, isDefault=false, isSaved=false
[Map] Updated saved center: lat=37.123, lng=127.456
```

**What to Observe:**
- Map center moves to your current location (not Seoul)
- New location shows in browser console logs
- No "BLOCKED" messages

**Pass/Fail:**
- ✅ PASS: Map moves to your location, console shows update
- ❌ FAIL: Map doesn't move or shows blocking messages

---

### Test 3: Category Switch - Single Change

**Prerequisites:** Test 2 must pass (user location saved)

**Steps:**
1. Map is showing your location from Test 2
2. Click on a category tab (e.g., "푸드/카페" if currently on "전체")
3. Observe if map center moves
4. Check browser console

**Expected Results - Console:**
```
[Map] setCenter called: lat=37.566826, lng=126.9786567, isDefault=true, isSaved=true
[Map] BLOCKED: Attempt to reset to default Seoul coordinates
[Map] RESTORING: Saved center lat=37.123, lng=127.456
```

**What to Observe:**
- Map center STAYS at your location (37.123, 127.456)
- Map does NOT move to Seoul
- Console shows BLOCKED message
- Console shows RESTORING message

**Pass/Fail:**
- ✅ PASS: Map stays at your location, console shows blocking
- ❌ FAIL: Map jumps to Seoul or console shows errors

---

### Test 4: Category Switch - Multiple Changes

**Prerequisites:** Test 3 must pass

**Steps:**
1. Starting from your saved location
2. Click category 1 (e.g., "푸드/카페")
3. Wait 1 second
4. Click category 2 (e.g., "헤어/뷰티")
5. Wait 1 second
6. Click category 3 (e.g., "운동/기타")
7. Observe map through all changes

**Expected Results:**
- Each category change triggers a blocked attempt
- Map never moves from your saved location
- Console fills with BLOCKED/RESTORING messages

```
[Map] setCenter called: lat=37.566826, lng=126.9786567, isDefault=true, isSaved=true
[Map] BLOCKED: Attempt to reset to default Seoul coordinates
[Map] RESTORING: Saved center lat=37.123, lng=127.456

[Map] setCenter called: lat=37.566826, lng=126.9786567, isDefault=true, isSaved=true
[Map] BLOCKED: Attempt to reset to default Seoul coordinates
[Map] RESTORING: Saved center lat=37.123, lng=127.456

[Map] setCenter called: lat=37.566826, lng=126.9786567, isDefault=true, isSaved=true
[Map] BLOCKED: Attempt to reset to default Seoul coordinates
[Map] RESTORING: Saved center lat=37.123, lng=127.456
```

**What to Observe:**
- Map position never changes
- Each category click triggers the pattern above
- No errors in console

**Pass/Fail:**
- ✅ PASS: Map stable through multiple category changes
- ❌ FAIL: Map moves on any category change

---

### Test 5: Manual Pan/Zoom

**Prerequisites:** Test 4 must pass

**Steps:**
1. Map is at your saved location
2. Manually pan the map to a different location
3. Release and observe the map
4. Check console logs

**Expected Results:**
```
[Map] setCenter called: lat=37.654, lng=127.123, isDefault=false, isSaved=false
[Map] Updated saved center: lat=37.654, lng=127.123
```

**What to Observe:**
- Map moves to your new location
- Console logs show the new coordinates
- New location becomes the saved center

**Pass/Fail:**
- ✅ PASS: Manual pans work and new location is saved
- ❌ FAIL: Manual pan doesn't work or console shows errors

---

### Test 6: Filter/Sorting Changes

**Prerequisites:** Test 5 must pass

**Steps:**
1. Map is at a saved location
2. Open filters/sorting menu
3. Change filter options (price, rating, etc.)
4. Apply filters
5. Observe if map moves

**Expected Results:**
- If filters trigger category changes internally:
  - BLOCKED messages appear in console
  - Map stays at saved location
  
- If filters don't move map:
  - Nothing happens (correct behavior)

**What to Observe:**
- Map center remains stable
- No unexpected movement

**Pass/Fail:**
- ✅ PASS: Map stays stable through filter changes
- ❌ FAIL: Map jumps to Seoul

---

### Test 7: Long-Duration Stability

**Prerequisites:** All previous tests pass

**Steps:**
1. Set a location using ApplyMapCenter
2. Perform various interactions for 5 minutes:
   - Switch categories repeatedly
   - Apply different filters
   - Pan and zoom
   - Return to map page (navigate away and back)
3. Check final map position

**Expected Results:**
- Map center matches the saved location
- Console shows repeated BLOCKED messages only for category changes
- No crashes or errors

**What to Observe:**
- System is stable over extended use
- No memory leaks or performance degradation

**Pass/Fail:**
- ✅ PASS: System stable for 5+ minutes
- ❌ FAIL: Crashes, errors, or performance issues

---

## Browser Console Debugging

### Open Browser Console

**Android + Chrome:**
1. In Chrome: `chrome://inspect/#devices`
2. Find your app in the list
3. Click "Inspect"
4. Go to Console tab

### Useful Console Commands

```javascript
// Check if interceptor is installed
console.log('Saved Center:', window.__savedMapCenter);
console.log('First Load:', window.__isFirstMapLoad);

// Get current map center
const container = document.querySelector('[data-naver-map], .naver-map, #map');
const center = container.__naverMap.getCenter();
console.log('Map Center:', {lat: center.y, lng: center.x});

// Manually test setCenter
const mapInst = container.__naverMap;
mapInst.setCenter(new naver.maps.LatLng(37.123, 127.456));

// Test default coordinate blocking
mapInst.setCenter(new naver.maps.LatLng(37.566826, 126.9786567));
// Should show BLOCKED message and stay at (37.123, 127.456)
```

---

## Troubleshooting

### Problem: Map not visible on first load

**Diagnosis:**
- Check if Naver Maps JavaScript library loaded
- Check browser console for JavaScript errors

**Solution:**
- Verify internet connection
- Refresh page (Ctrl+R in Chrome DevTools)
- Check if Bubble's map container exists:
  ```javascript
  document.querySelector('[data-naver-map], .naver-map, #map')
  ```

### Problem: BLOCKED message never appears when switching categories

**Diagnosis:**
- Category changes might not be calling `setCenter()` with default coordinates
- Interceptor might not be installed

**Solution:**
- Check console for: `[Map] Naver Maps constructor interceptor installed`
- If not present, wait 10 seconds and check again (it retries)
- Manually trigger category change and check console

### Problem: Map jumps to Seoul even though BLOCKED message appears

**Diagnosis:**
- Interceptor installed but not working as expected
- Multiple map instances might exist

**Solution:**
- Check number of map containers:
  ```javascript
  document.querySelectorAll('[data-naver-map], .naver-map, #map').length
  ```
- Check if `__naverMap` property exists:
  ```javascript
  document.querySelector('[data-naver-map]').__naverMap !== undefined
  ```

### Problem: Console fills with error messages

**Diagnosis:**
- Interceptor might have a bug
- Naver Maps API might be different than expected

**Solution:**
- Look for patterns in error messages
- Check file: `app/index.tsx` lines 800-900 for interceptor logic
- May need to update coordinate extraction logic

---

## Success Indicators

You'll know the fix is working when:

1. **Browser console shows:**
   - `[Map] Naver Maps constructor interceptor installed`
   - `[Map] Updated saved center:` after ApplyMapCenter
   - `[Map] BLOCKED: Attempt to reset to default Seoul coordinates` on category changes

2. **Map behavior shows:**
   - No jump to Seoul on category changes
   - Stable position after ApplyMapCenter
   - Manual pans update the saved center

3. **Performance shows:**
   - No lag or stuttering when changing categories
   - Smooth animations
   - No console errors

---

## Reporting Issues

If tests fail, collect:
1. Screenshot of browser console during failure
2. Steps to reproduce
3. Expected vs actual behavior
4. Browser console logs (copy-paste full output)
5. Device info (Android version, device model)
