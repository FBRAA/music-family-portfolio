# Student practice app

The student PWA brings together practice assignments, recorded attempts and teacher feedback. The teacher can choose a type of exercise, and the student can work on it with a reference note, a tuner or audio tools as appropriate.

## Listening for a note in the browser

The [pitch tracker](../samples/student-app/usePitchTracker.ts) obtains a microphone stream with `getUserMedia` and reads time-domain frames through a Web Audio analyser. It uses a YIN-style difference function to estimate periodicity, checks signal strength and confidence, and converts the result to a MIDI note and a signed cent offset. The same hook exposes note parsing and frequency conversion helpers for a target pitch.

Pitch estimates can jump by an octave or fluctuate in noise. The hook tracks previous readings, limits the rate of visible updates and drops a stale reading after repeated misses. It cancels the animation loop, closes the audio context and stops the microphone tracks on cleanup.

The hook handles browser permission and missing-device errors. It needs a secure context and a microphone when mounted in a browser. The TypeScript sample can be read independently. A React host page is needed to try live tracking.

## Beyond the tuner

The app also implements teacher assignments and replies, submission audio playback and a lesson schedule supplied by AlfaCRM. Those flows depend on the private student app and its data stores.
