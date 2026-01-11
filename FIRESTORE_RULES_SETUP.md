# Firestore Security Rules Setup

## Problem
External users are seeing "Missing or insufficient permissions" error because Firestore security rules are blocking read access to the `campaigns` collection.

## Solution
Update your Firestore security rules to allow authenticated users to read from the `campaigns` collection.

## How to Update Firestore Rules

### Option 1: Firebase Console (Recommended)
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Navigate to **Firestore Database** → **Rules** tab
4. Copy and paste the contents of `firestore.rules` file
5. Click **Publish**

### Option 2: Firebase CLI
If you have Firebase CLI installed:

```bash
# Install Firebase CLI (if not already installed)
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firebase (if not already done)
firebase init firestore

# Deploy rules
firebase deploy --only firestore:rules
```

## What These Rules Do

1. **Campaigns Collection** (`/campaigns/{version}`):
   - ✅ **Read**: Any authenticated user can read campaign data
   - ✅ **Write**: Only admin (aaron.g@uveye.com) can write/update campaign data

2. **Votes Collection** (`/votes/{voteId}`):
   - ✅ **Read**: Any authenticated user can read votes (for aggregation)
   - ✅ **Create**: Users can create votes with their own userId
   - ✅ **Update/Delete**: Users can only modify their own votes

## Testing
After updating the rules:
1. Have an external user refresh the page
2. They should now be able to see the inspection data after admin uploads
3. Check the browser console - the permission error should be gone

## Important Notes
- Rules are deployed immediately but may take a few seconds to propagate
- Make sure Anonymous Authentication is enabled in Firebase Console → Authentication → Sign-in method
- The admin email check is case-insensitive and trimmed
