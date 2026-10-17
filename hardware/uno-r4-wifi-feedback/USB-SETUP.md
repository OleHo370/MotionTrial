# USB feedback (current default)

USB is now the active feedback connection. Keep the UNO R4 WiFi connected to the computer by a USB **data** cable. No network, Wi-Fi password, IP address, browser serial permission or additional Node package is needed. The Windows local server owns the serial port through its bounded .NET serial helper.

1. Upload `uno-r4-wifi-feedback.ino` with the default USB configuration. The Wi-Fi-enable definition at the top stays commented out.
2. Close Arduino IDE's Serial Monitor so it releases the port.
3. Start the local server with `node scripts/serve-dual-view.mjs`.
4. Open `http://127.0.0.1:8766/first-three.html`, choose **Settings → Arduino USB feedback → Connect USB feedback**. The server identifies the connected UNO R4 WiFi automatically.
5. Start practice normally. Green means current in-guide tracking; sustained deviation flashes red and gives short beeps five times per second (80 ms on, 120 ms silent). Missing tracking, watching, setup, review and pause are silent idle.

Disconnect USB feedback in Settings before opening Serial Monitor or uploading a sketch. An unplugged or busy port gives a recoverable connection message. On command loss, the firmware's independent 900 ms lease expires to silent idle. The local server must remain running.

The circuit remains D5 green, D6 red, D8 passive buzzer, common GND. Use 1 kΩ resistors and a buzzer appropriate for the UNO R4's 8 mA GPIO limit or a suitable driver. The user confirmed these wiring changes before the USB hardware test.

## Wi-Fi code is preserved

The complete Wi-Fi firmware remains in the same sketch behind the commented enable switch. The original browser Wi-Fi client and Node Wi-Fi relay files remain available; their active imports/factories and old settings markup are commented out. The old UI initializer is also preserved as a commented block. Wi-Fi credentials and pairing configuration are retained privately outside `public/`.

To restore Wi-Fi later, enable the firmware's Wi-Fi definition, restore the commented Wi-Fi server factory/import and pairing setup, and restore the Wi-Fi UI initializer and settings markup together. Upload that firmware. Do not activate both transports against the same board simultaneously.

USB hardware smoke tests are explicitly command tests; they do not claim that a person completed a movement. Actual learner assessment continues to use fresh same-side MediaPipe observations and the existing post-clip rules.
