# Word Adventure Firebase backend (setup branch)

This branch adds a Firebase backend scaffold and corrects Word Match scoring. It is not ready to publish until the Firebase web config and App Check settings are added to the client.

## Firebase project
Project ID: `word-adventure-tanjb`

Create the project in Firebase Console, register the existing GitHub Pages site as a Web app, and create Firestore in Production mode in `asia-southeast1` (Singapore). GitHub Pages remains the website host.

## Before deployment
1. Install a current Node.js LTS release and Firebase CLI: `npm install -g firebase-tools`
2. Sign in: `firebase login`
3. Select the project: `firebase use --add` and choose `word-adventure-tanjb`
4. Enable Firebase Authentication's custom-token flow by deploying the functions (no Google provider is required).
5. Configure Firebase App Check for the web app using reCAPTCHA v3 or reCAPTCHA Enterprise. The callable functions enforce App Check.
6. Confirm the Firebase project is on the Blaze plan before deploying Cloud Functions. Set a budget alert.
7. Deploy rules and functions: `firebase deploy --only firestore:rules,functions`

## Create student profiles
Use a private local environment; do not commit service-account credentials.

1. In Google Cloud Console, create a service account with narrowly scoped permissions for Firebase Authentication user management and Firestore profile writes. Download its key to a private location outside this repository.
2. In your terminal, set `GOOGLE_APPLICATION_CREDENTIALS` to that key file and set `GCLOUD_PROJECT=word-adventure-tanjb`.
3. From this folder, run:
   ```sh
   cd functions
   npm install
   node create-student.js "Student Display Name" 1234
   ```
4. Repeat for each student. Names must be distinct; the PIN is never stored in plaintext. Use a different four-digit PIN per student where practical.

## Collections
- `students/{studentId}`: profile, totals, per-mode attempt counts and best scores.
- `students/{studentId}/attempts/{attemptId}`: immutable game-attempt records.
- `studentSecrets/{studentId}`: server-only salted PIN hash and lockout state.

Firestore rules deny client writes. Students can read only their own profile and attempt history. The public profile picker returns active student IDs and display names only; App Check is required for callable requests.

## Security and scoring limitations
- Five failed PIN attempts lock the profile for ten minutes.
- Duplicate result submission with the same attempt ID does not award XP twice.
- XP is capped at 100 per UTC day per profile.
- Scores are currently client-reported. Server-side storage rules protect records, but they do not prove the browser-reported score is honest. Strong anti-cheat requires server-verifiable game outcomes or signed event logs.
- Four-digit PINs are classroom convenience credentials, not high-security authentication. Keep profile names minimal and avoid sensitive personal data.

## Word Match scoring
The score scale is fixed at 100. The hinted round can award up to 50. A high enough hinted-round score unlocks the no-hints round, which can award up to 50 more. A student who does not complete the no-hints round keeps the hinted-round score out of 100 (for example, 50/100 for a perfect hinted round).
