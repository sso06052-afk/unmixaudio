# Chrome Web Store Listing — UnmixAudio

## Store Name
UnmixAudio — Music Analyzer & Recorder

## Short Description (132 chars max)
Real-time BPM & Key detection (local). Track export with source separation. AUDIO IS NEVER STORED — deleted immediately.

## Full Description

UnmixAudio is a professional music analysis tool for producers, DJs, and beatmakers.

✓ **AUDIO IS NEVER STORED — ON ANY SERVER, EVER.**
Your audio is never written to disk, never logged, never retained. Whether processed locally or on our server, every byte is permanently deleted the moment processing finishes. No accounts. No tracking. No ads. No audio archive.

**REAL-TIME BPM & KEY DETECTION (100% LOCAL)**
Capture audio from any browser tab and instantly analyze tempo and musical key. All BPM and Key analysis runs entirely on your device using bundled Essentia WASM and TensorFlow.js (TempoCNN) models — no audio ever leaves your computer for tempo/key detection. No network connection required for analysis.

**HIGH-FIDELITY AUDIO CAPTURE & EXPORT**
Record browser tab audio up to 5 minutes and export to WAV. Every capture is automatically tagged with BPM and Key metadata.

**TRACK EXPORT (OPTIONAL SOURCE SEPARATION)**
Optionally separate vocals, drums, bass, and other instruments from your recordings using the Demucs ML model. Audio is sent over encrypted HTTPS, processed entirely in memory on the server, and **permanently deleted within seconds after processing — never written to disk, never logged, never retained in any form**. This feature is opt-in and only activates when you click "Extract Tracks".

**SOUND LIBRARY**
Organize your recordings in a searchable local library with BPM and Key tagging — stored only on your device via chrome.storage.local. Never transmitted anywhere.

**OUR PRIVACY GUARANTEE**
- BPM/Key analysis: 100% local, no audio leaves your device
- Track export: audio processed in server memory only, deleted immediately
- Library data: stored only on your device, never uploaded
- No accounts, no tracking, no analytics, no ads

**LEGAL NOTICE**
UnmixAudio is an audio analysis utility. Users are responsible for ensuring they have the legal right to capture, analyze, or export any audio content.

## Category
Music & Audio

## Single Purpose Description
Capture audio from a browser tab to detect BPM and musical key in real-time, and optionally export the recording (with source separation) for music production workflows.

## Permission Justifications
- **tabCapture**: Required to capture audio from the active browser tab for analysis.
- **activeTab**: Required to access the currently active tab when the user starts analysis.
- **offscreen**: Required to run Web Audio API and Essentia WASM analysis in the background (Manifest V3 requirement).
- **storage**: Required to save the user's analyzed track library locally.
- **sidePanel**: Required to display the analysis UI in Chrome's side panel.
- **notifications**: Required to notify the user when long-running track export completes.
- **host_permissions (unmixaudio-production.up.railway.app)**: Required only for the optional source separation (Demucs) feature; audio processed on this server is deleted immediately after processing.

## Screenshot Descriptions (for reviewer)
1. BPM/Key real-time analysis side panel showing live detection
2. Sound library with BPM and Key metadata tags
3. Track export workflow — Stop Recording → Extract Tracks
4. Privacy policy and first-run consent screen

## Privacy Policy URL
(host privacy-policy.html on a public URL — recommended: GitHub Pages or Notion public page — before submission)
